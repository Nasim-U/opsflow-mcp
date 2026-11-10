import { SLA_CONTRACTS, WAREHOUSE_REFERENCE_TIME } from './warehouse.mjs';

function computeZScoreOutliers(items, valueSelector, threshold) {
  if (items.length < 3) return [];
  const values = items.map(valueSelector);
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return [];

  const outliers = [];
  for (const item of items) {
    const val = valueSelector(item);
    const zScore = (val - mean) / stdDev;
    if (Math.abs(zScore) >= threshold) {
      outliers.push({
        item,
        observedValue: val,
        baselineMean: Number(mean.toFixed(2)),
        baselineStdDev: Number(stdDev.toFixed(2)),
        zScore: Number(zScore.toFixed(2))
      });
    }
  }
  return outliers;
}

/**
 * Runs automated freshness, null-threshold, duplicate-key, and statistical outlier checks
 * across the SaaS operations warehouse, returning findings and deterministic remediation actions.
 */
export function auditDatasetHealth(
  db,
  {
    dataset = 'all',
    nullThresholdPct = SLA_CONTRACTS.thresholds.maxNullRatePct,
    outlierZThreshold = SLA_CONTRACTS.thresholds.outlierZScoreThreshold
  } = {}
) {
  const validDatasets = new Set([
    'all',
    'accounts',
    'revenue_events',
    'pipeline_runs',
    'weekly_kpi_snapshots',
    'support_escalations'
  ]);

  if (!validDatasets.has(dataset)) {
    throw new Error(
      `Unsupported dataset '${dataset}'. Expected one of: ${Array.from(validDatasets).join(', ')}`
    );
  }

  const findings = [];
  const remediationActions = [];
  const inspectedDatasets = dataset === 'all'
    ? ['accounts', 'revenue_events', 'pipeline_runs', 'weekly_kpi_snapshots', 'support_escalations']
    : [dataset];

  // 1. Freshness & SLA check across latest run of each pipeline
  if (dataset === 'all' || dataset === 'pipeline_runs') {
    const latestRuns = db.prepare(`
      WITH ranked AS (
        SELECT
          run_id,
          pipeline_name,
          domain,
          completed_at,
          duration_sec,
          rows_processed,
          sla_freshness_max_min,
          freshness_lag_min,
          status,
          ROW_NUMBER() OVER (PARTITION BY pipeline_name ORDER BY completed_at DESC) AS rn
        FROM pipeline_runs
      )
      SELECT * FROM ranked WHERE rn = 1 ORDER BY freshness_lag_min DESC
    `).all().map((r) => ({ ...r }));

    for (const run of latestRuns) {
      const lagRatio = run.freshness_lag_min / run.sla_freshness_max_min;
      if (run.status === 'failed' || lagRatio >= SLA_CONTRACTS.thresholds.criticalFreshnessMultiplier) {
        findings.push({
          checkType: 'freshness_sla',
          severity: 'critical',
          dataset: 'pipeline_runs',
          subject: run.pipeline_name,
          metric: `${run.freshness_lag_min} min lag (SLA <= ${run.sla_freshness_max_min} min, status=${run.status})`,
          details: {
            runId: run.run_id,
            domain: run.domain,
            freshnessLagMin: run.freshness_lag_min,
            slaTargetMin: run.sla_freshness_max_min
          }
        });
        remediationActions.push({
          priority: 'P0',
          owner: 'Data Platform Oncall',
          target: run.pipeline_name,
          action: `Trigger playbook 'pipeline-sla-triage' for failed DAG '${run.pipeline_name}' (lag ${run.freshness_lag_min}m > ${run.sla_freshness_max_min}m SLA) and quarantine downstream attribution mart.`,
          suggestedTool: 'run_automation_playbook',
          suggestedArgs: { playbook: 'pipeline-sla-triage', dryRun: true }
        });
      } else if (run.status === 'degraded' || run.freshness_lag_min > run.sla_freshness_max_min) {
        findings.push({
          checkType: 'freshness_sla',
          severity: 'warning',
          dataset: 'pipeline_runs',
          subject: run.pipeline_name,
          metric: `${run.freshness_lag_min} min lag (SLA <= ${run.sla_freshness_max_min} min, status=${run.status})`,
          details: {
            runId: run.run_id,
            domain: run.domain,
            freshnessLagMin: run.freshness_lag_min,
            slaTargetMin: run.sla_freshness_max_min
          }
        });
        remediationActions.push({
          priority: 'P2',
          owner: 'Support Analytics Engineering',
          target: run.pipeline_name,
          action: `Inspect incremental cursor pagination on '${run.pipeline_name}' to bring lag (${run.freshness_lag_min}m) back under ${run.sla_freshness_max_min}m.`,
          suggestedTool: 'query_analytics_readonly'
        });
      }
    }

    // Statistical runtime outlier check across pipeline_runs
    const allRuns = db.prepare(`
      SELECT run_id, pipeline_name, duration_sec, rows_processed, status
      FROM pipeline_runs
      ORDER BY completed_at ASC
    `).all().map((r) => ({ ...r }));

    const runtimeOutliers = computeZScoreOutliers(
      allRuns,
      (r) => Number(r.duration_sec),
      Number(outlierZThreshold)
    );

    for (const out of runtimeOutliers) {
      findings.push({
        checkType: 'statistical_outlier',
        severity: 'warning',
        dataset: 'pipeline_runs',
        subject: `${out.item.pipeline_name} (${out.item.run_id})`,
        metric: `duration_sec=${out.observedValue}s (z=${out.zScore}, mean=${out.baselineMean}s)`,
        details: {
          runId: out.item.run_id,
          observedDurationSec: out.observedValue,
          zScore: out.zScore,
          baselineMeanSec: out.baselineMean
        }
      });
    }
  }

  // 2. Null-threshold & Duplicate-key & Outlier checks on revenue_events
  if (dataset === 'all' || dataset === 'revenue_events') {
    const nullStats = db.prepare(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN attribution_channel IS NULL THEN 1 ELSE 0 END) AS null_channel_rows
      FROM revenue_events
    `).get();

    const nullPct = Number(((nullStats.null_channel_rows / nullStats.total_rows) * 100).toFixed(2));
    if (nullPct > Number(nullThresholdPct)) {
      findings.push({
        checkType: 'null_threshold',
        severity: 'warning',
        dataset: 'revenue_events',
        subject: 'revenue_events.attribution_channel',
        metric: `${nullPct}% NULL (${nullStats.null_channel_rows}/${nullStats.total_rows} rows > ${nullThresholdPct}% threshold)`,
        details: {
          column: 'attribution_channel',
          nullRows: nullStats.null_channel_rows,
          totalRows: nullStats.total_rows,
          nullRatePct: nullPct,
          thresholdPct: Number(nullThresholdPct)
        }
      });
      remediationActions.push({
        priority: 'P1',
        owner: 'RevOps Data Engineering',
        target: 'revenue_events.attribution_channel',
        action: `Backfill NULL attribution_channel (${nullPct}%) from CRM campaign touchpoints and restore UTM schema contract validation.`,
        suggestedTool: 'query_analytics_readonly'
      });
    }

    const dupRows = db.prepare(`
      SELECT
        idempotency_key,
        COUNT(*) AS occurrences,
        SUM(arr_delta_usd) AS gross_reported_arr_usd,
        MIN(arr_delta_usd) AS canonical_arr_usd
      FROM revenue_events
      GROUP BY idempotency_key
      HAVING COUNT(*) > 1
      ORDER BY idempotency_key ASC
    `).all().map((r) => ({ ...r }));

    if (dupRows.length > 0) {
      const overstatedArr = dupRows.reduce(
        (sum, r) => sum + (r.gross_reported_arr_usd - r.canonical_arr_usd),
        0
      );
      findings.push({
        checkType: 'duplicate_business_key',
        severity: 'critical',
        dataset: 'revenue_events',
        subject: 'revenue_events.idempotency_key',
        metric: `${dupRows.length} duplicate webhook keys overstating ARR by $${overstatedArr.toLocaleString('en-US')}`,
        details: {
          duplicateKeyCount: dupRows.length,
          overstatedArrUsd: overstatedArr,
          duplicateKeys: dupRows.map((d) => d.idempotency_key)
        }
      });
      remediationActions.push({
        priority: 'P0',
        owner: 'Finance Analytics & Billing Infra',
        target: 'revenue_events.idempotency_key',
        action: `Enforce QUALIFY ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY event_row_id) = 1 in marts to eliminate $${overstatedArr.toLocaleString('en-US')} duplicate ARR replay.`,
        suggestedTool: 'query_analytics_readonly'
      });
    }

    const eventRows = db.prepare(`
      SELECT event_row_id, idempotency_key, account_id, event_type, arr_delta_usd
      FROM revenue_events
      ORDER BY event_row_id ASC
    `).all().map((r) => ({ ...r }));

    const arrOutliers = computeZScoreOutliers(
      eventRows,
      (r) => Math.abs(Number(r.arr_delta_usd)),
      Number(outlierZThreshold)
    );

    for (const out of arrOutliers) {
      findings.push({
        checkType: 'statistical_outlier',
        severity: 'info',
        dataset: 'revenue_events',
        subject: `${out.item.idempotency_key} (${out.item.account_id})`,
        metric: `|arr_delta_usd|=$${out.observedValue.toLocaleString('en-US')} (z=${out.zScore})`,
        details: {
          idempotencyKey: out.item.idempotency_key,
          accountId: out.item.account_id,
          eventType: out.item.event_type,
          arrDeltaUsd: out.item.arr_delta_usd,
          zScore: out.zScore
        }
      });
    }
  }

  // 3. Accounts ownership & hygiene check
  if (dataset === 'all' || dataset === 'accounts') {
    const accountChecks = db.prepare(`
      SELECT
        COUNT(*) AS total_accounts,
        SUM(CASE WHEN csm_owner IS NULL THEN 1 ELSE 0 END) AS unowned_accounts
      FROM accounts
    `).get();

    const unownedPct = Number(
      ((accountChecks.unowned_accounts / accountChecks.total_accounts) * 100).toFixed(2)
    );

    if (unownedPct > Number(nullThresholdPct)) {
      findings.push({
        checkType: 'null_threshold',
        severity: 'warning',
        dataset: 'accounts',
        subject: 'accounts.csm_owner',
        metric: `${unownedPct}% NULL (${accountChecks.unowned_accounts}/${accountChecks.total_accounts} accounts missing CSM owner)`,
        details: {
          column: 'csm_owner',
          nullRows: accountChecks.unowned_accounts,
          totalRows: accountChecks.total_accounts,
          nullRatePct: unownedPct
        }
      });
      remediationActions.push({
        priority: 'P2',
        owner: 'Customer Success Ops',
        target: 'accounts.csm_owner',
        action: `Assign regional APAC CSM owner for ${accountChecks.unowned_accounts} unowned active account(s) via round-robin routing.`,
        suggestedTool: 'query_analytics_readonly'
      });
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const rawScore = 100 - criticalCount * 22 - warningCount * 8 - infoCount * 2;
  const healthScore = Math.max(0, Math.min(100, rawScore));
  const overallStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'degraded' : 'healthy';

  return {
    referenceTimestamp: WAREHOUSE_REFERENCE_TIME,
    inspectedDatasets,
    overallStatus,
    healthScore,
    summary: {
      totalFindings: findings.length,
      criticalCount,
      warningCount,
      infoCount,
      executiveGateReady: criticalCount === 0
    },
    findings,
    remediationActions
  };
}
