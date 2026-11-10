function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

function fmtUsd(value) {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

function fmtSignedUsd(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

export function compileWeeklyExecDigest(
  db,
  { targetWeek = '2026-04-06', format = 'both' } = {}
) {
  const validFormats = new Set(['both', 'markdown', 'slack_blocks']);
  if (!validFormats.has(format)) {
    throw new Error(`Invalid format '${format}'. Expected one of: both, markdown, slack_blocks`);
  }

  const weeks = db.prepare(`
    SELECT DISTINCT week_start
    FROM weekly_kpi_snapshots
    WHERE week_start <= ?
    ORDER BY week_start DESC
    LIMIT 2
  `).all(targetWeek).map((r) => r.week_start);

  if (weeks.length < 2 || weeks[0] !== targetWeek) {
    const available = db.prepare(
      `SELECT DISTINCT week_start FROM weekly_kpi_snapshots ORDER BY week_start ASC`
    ).all().map((r) => r.week_start);
    throw new Error(
      `Insufficient prior-week baseline for targetWeek='${targetWeek}'. Available weeks: ${available.join(', ')}`
    );
  }

  const [currentWeek, priorWeek] = weeks;

  const aggregateWeek = db.prepare(`
    SELECT
      week_start,
      SUM(new_arr_usd) AS new_arr_usd,
      SUM(expansion_arr_usd) AS expansion_arr_usd,
      SUM(contraction_arr_usd) AS contraction_arr_usd,
      SUM(churned_arr_usd) AS churned_arr_usd,
      SUM(net_new_arr_usd) AS net_new_arr_usd,
      ROUND(AVG(pipeline_coverage_ratio), 2) AS avg_pipeline_coverage,
      ROUND(AVG(p95_api_latency_ms), 1) AS avg_p95_latency_ms,
      MAX(p95_api_latency_ms) AS max_p95_latency_ms,
      SUM(support_sla_breaches) AS support_sla_breaches
    FROM weekly_kpi_snapshots
    WHERE week_start = ?
    GROUP BY week_start
  `);

  const cur = { ...aggregateWeek.get(currentWeek) };
  const prev = { ...aggregateWeek.get(priorWeek) };

  const netNewDeltaUsd = cur.net_new_arr_usd - prev.net_new_arr_usd;

  const kpis = {
    netNewArr: {
      currentUsd: cur.net_new_arr_usd,
      priorUsd: prev.net_new_arr_usd,
      deltaUsd: netNewDeltaUsd,
      wowPct: pctChange(cur.net_new_arr_usd, prev.net_new_arr_usd)
    },
    expansionArr: {
      currentUsd: cur.expansion_arr_usd,
      priorUsd: prev.expansion_arr_usd,
      deltaUsd: cur.expansion_arr_usd - prev.expansion_arr_usd,
      wowPct: pctChange(cur.expansion_arr_usd, prev.expansion_arr_usd)
    },
    grossChurnAndContractionArr: {
      currentUsd: cur.contraction_arr_usd + cur.churned_arr_usd,
      priorUsd: prev.contraction_arr_usd + prev.churned_arr_usd,
      deltaUsd:
        cur.contraction_arr_usd +
        cur.churned_arr_usd -
        (prev.contraction_arr_usd + prev.churned_arr_usd),
      wowPct: pctChange(
        cur.contraction_arr_usd + cur.churned_arr_usd,
        prev.contraction_arr_usd + prev.churned_arr_usd
      )
    },
    pipelineCoverageRatio: {
      current: cur.avg_pipeline_coverage,
      prior: prev.avg_pipeline_coverage,
      delta: Number((cur.avg_pipeline_coverage - prev.avg_pipeline_coverage).toFixed(2))
    },
    p95ApiLatencyMs: {
      currentAvgMs: cur.avg_p95_latency_ms,
      priorAvgMs: prev.avg_p95_latency_ms,
      peakSegmentMs: cur.max_p95_latency_ms,
      wowPct: pctChange(cur.avg_p95_latency_ms, prev.avg_p95_latency_ms)
    },
    supportSlaBreaches: {
      current: cur.support_sla_breaches,
      prior: prev.support_sla_breaches,
      delta: cur.support_sla_breaches - prev.support_sla_breaches
    }
  };

  const segmentRows = db.prepare(`
    SELECT
      c.segment,
      c.net_new_arr_usd AS current_net_new_arr,
      p.net_new_arr_usd AS prior_net_new_arr,
      (c.net_new_arr_usd - p.net_new_arr_usd) AS wow_delta_usd,
      c.expansion_arr_usd AS current_expansion_arr,
      c.contraction_arr_usd AS current_contraction_arr,
      c.pipeline_coverage_ratio,
      c.p95_api_latency_ms,
      c.support_sla_breaches
    FROM weekly_kpi_snapshots c
    JOIN weekly_kpi_snapshots p
      ON c.segment = p.segment AND p.week_start = ?
    WHERE c.week_start = ?
    ORDER BY ABS(c.net_new_arr_usd - p.net_new_arr_usd) DESC
  `).all(priorWeek, currentWeek).map((row) => ({
    ...row,
    wowPct: pctChange(row.current_net_new_arr, row.prior_net_new_arr),
    shareOfTotalDeltaPct:
      netNewDeltaUsd !== 0
        ? Number(((row.wow_delta_usd / netNewDeltaUsd) * 100).toFixed(1))
        : 0
  }));

  const riskWatchlist = db.prepare(`
    SELECT
      a.account_id,
      a.company_name,
      a.segment,
      a.region,
      a.arr_usd,
      a.health_score,
      ROUND((CAST(a.seats_active_30d AS REAL) / a.seats_purchased) * 100, 1) AS seat_utilization_pct,
      a.renewal_date,
      a.csm_owner,
      COUNT(e.ticket_id) AS open_escalations,
      MAX(e.severity) AS highest_open_severity
    FROM accounts a
    LEFT JOIN support_escalations e
      ON a.account_id = e.account_id AND e.resolved = 0
    WHERE a.status = 'at_risk'
    GROUP BY a.account_id
    ORDER BY a.arr_usd DESC
  `).all().map((r) => ({ ...r }));

  const totalAtRiskArrUsd = riskWatchlist.reduce((sum, r) => sum + r.arr_usd, 0);

  const markdownLines = [
    `# Weekly Executive Operations Digest (${currentWeek})`,
    `*Baseline comparison: ${priorWeek}, Source: OpsFlow Warehouse*`,
    '',
    '## 1. Headline WoW KPI scorecard',
    `- **Net New ARR:** ${fmtUsd(kpis.netNewArr.currentUsd)} (${fmtSignedUsd(kpis.netNewArr.deltaUsd)}, ${kpis.netNewArr.wowPct > 0 ? '+' : ''}${kpis.netNewArr.wowPct}% WoW)`,
    `- **Expansion ARR:** ${fmtUsd(kpis.expansionArr.currentUsd)} (${fmtSignedUsd(kpis.expansionArr.deltaUsd)}, ${kpis.expansionArr.wowPct > 0 ? '+' : ''}${kpis.expansionArr.wowPct}% WoW)`,
    `- **Contraction and Churn ARR:** ${fmtUsd(kpis.grossChurnAndContractionArr.currentUsd)} (${fmtSignedUsd(kpis.grossChurnAndContractionArr.deltaUsd)} WoW)`,
    `- **Pipeline Coverage:** ${kpis.pipelineCoverageRatio.current}x (${kpis.pipelineCoverageRatio.delta >= 0 ? '+' : ''}${kpis.pipelineCoverageRatio.delta}x WoW)`,
    `- **API Reliability and Support:** Avg p95 latency ${kpis.p95ApiLatencyMs.currentAvgMs}ms (Enterprise peak ${kpis.p95ApiLatencyMs.peakSegmentMs}ms), ${kpis.supportSlaBreaches.current} SLA breaches`,
    '',
    '## 2. Top variance drivers by segment',
    ...segmentRows.map(
      (s) =>
        `- **${s.segment}:** ${fmtUsd(s.current_net_new_arr)} Net New ARR (${fmtSignedUsd(s.wow_delta_usd)} WoW, ${s.shareOfTotalDeltaPct}% of net variance, coverage ${s.pipeline_coverage_ratio}x)`
    ),
    '',
    `## 3. Renewal risk watchlist (${fmtUsd(totalAtRiskArrUsd)} ARR exposed)`,
    ...riskWatchlist.map(
      (r) =>
        `- **${r.company_name}** (${r.segment}, ${r.region}): ${fmtUsd(r.arr_usd)} ARR, Health ${r.health_score}/100, Seat util ${r.seat_utilization_pct}%, Renewal ${r.renewal_date}, Open escalations: ${r.open_escalations}${r.highest_open_severity ? ` (${r.highest_open_severity})` : ''}`
    )
  ];

  const markdown = markdownLines.join('\n');

  const slackBlocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `OpsFlow Executive Brief (${currentWeek})`
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Net New ARR*\n${fmtUsd(kpis.netNewArr.currentUsd)} (${fmtSignedUsd(kpis.netNewArr.deltaUsd)}, +${kpis.netNewArr.wowPct}% WoW)`
        },
        {
          type: 'mrkdwn',
          text: `*Expansion ARR*\n${fmtUsd(kpis.expansionArr.currentUsd)} (+${kpis.expansionArr.wowPct}% WoW)`
        },
        {
          type: 'mrkdwn',
          text: `*Pipeline Coverage*\n${kpis.pipelineCoverageRatio.current}x (${kpis.pipelineCoverageRatio.delta >= 0 ? '+' : ''}${kpis.pipelineCoverageRatio.delta}x WoW)`
        },
        {
          type: 'mrkdwn',
          text: `*At-Risk Renewal Pool*\n${fmtUsd(totalAtRiskArrUsd)} across ${riskWatchlist.length} accounts`
        }
      ]
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Top Segment Variance Drivers*\n` +
          segmentRows
            .map(
              (s) =>
                `- *${s.segment}:* ${fmtUsd(s.current_net_new_arr)} (${fmtSignedUsd(s.wow_delta_usd)} WoW, ${s.shareOfTotalDeltaPct}% of gain)`
            )
            .join('\n')
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Baseline week: ${priorWeek}, Peak Enterprise p95 latency: ${kpis.p95ApiLatencyMs.peakSegmentMs}ms, Source: OpsFlow MCP`
        }
      ]
    }
  ];

  const result = {
    period: { currentWeek, priorWeek },
    kpis,
    varianceDrivers: segmentRows,
    renewalRiskWatchlist: {
      totalAtRiskArrUsd,
      accountCount: riskWatchlist.length,
      accounts: riskWatchlist
    }
  };

  if (format === 'both' || format === 'markdown') {
    result.markdown = markdown;
  }
  if (format === 'both' || format === 'slack_blocks') {
    result.slackBlockKit = { blocks: slackBlocks };
  }

  return result;
}
