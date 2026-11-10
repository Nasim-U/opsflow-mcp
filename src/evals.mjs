import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createOpsFlowMcpServer } from './mcp-server.mjs';

export const EVAL_CASES = [
  {
    id: 'eval-01',
    category: 'sql_analytics',
    categoryLabel: 'SQL analytics',
    title: 'Deduplicated ARR aggregation with ROW_NUMBER() window CTE',
    tool: 'query_analytics_readonly',
    isBenignSql: true,
    isAdversarialSql: false,
    expectedVerdict: 'ALLOWED_READONLY',
    probeSummary: 'WITH dedup AS (SELECT ..., ROW_NUMBER() OVER (PARTITION BY idempotency_key ...)) SELECT COUNT(*), SUM(arr_delta_usd)',
    arguments: {
      sql: `
        WITH dedup AS (
          SELECT
            arr_delta_usd,
            ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY event_row_id ASC) AS rn
          FROM revenue_events
        )
        SELECT
          COUNT(*) AS verified_events,
          CAST(SUM(arr_delta_usd) AS INTEGER) AS net_arr_delta_usd
        FROM dedup
        WHERE rn = 1
      `,
      maxRows: 10
    },
    verify(rpcRes) {
      const payload = rpcRes?.result?.structuredContent;
      const row = payload?.rows?.[0];
      const passed =
        rpcRes?.result?.isError === false &&
        payload?.telemetry?.guardrailVerdict === 'ALLOWED_READONLY' &&
        row?.verified_events === 14 &&
        row?.net_arr_delta_usd === 234200;
      return {
        passed,
        actualVerdict: payload?.telemetry?.guardrailVerdict ?? 'ERROR',
        evidence: row
          ? `14 deduped rows, $234,200 net ARR ($21,600 replay excluded)`
          : 'Missing result row'
      };
    }
  },
  {
    id: 'eval-02',
    category: 'sql_analytics',
    categoryLabel: 'SQL analytics',
    title: 'At-risk cohort join with window rank and open escalations',
    tool: 'query_analytics_readonly',
    isBenignSql: true,
    isAdversarialSql: false,
    expectedVerdict: 'ALLOWED_READONLY',
    probeSummary: 'SELECT company_name, arr_usd, RANK() OVER (ORDER BY arr_usd DESC) FROM accounts LEFT JOIN support_escalations',
    arguments: {
      sql: `
        SELECT
          a.company_name,
          a.arr_usd,
          ROUND((CAST(a.seats_active_30d AS REAL) / a.seats_purchased) * 100, 1) AS seat_util_pct,
          COUNT(e.ticket_id) AS open_tickets,
          RANK() OVER (ORDER BY a.arr_usd DESC) AS arr_rank
        FROM accounts a
        LEFT JOIN support_escalations e
          ON a.account_id = e.account_id AND e.resolved = 0
        WHERE a.status = 'at_risk'
        GROUP BY a.account_id
        ORDER BY arr_rank ASC
      `,
      maxRows: 10
    },
    verify(rpcRes) {
      const payload = rpcRes?.result?.structuredContent;
      const rows = payload?.rows ?? [];
      const totalExposed = rows.reduce((sum, r) => sum + Number(r.arr_usd), 0);
      const passed =
        rpcRes?.result?.isError === false &&
        rows.length === 3 &&
        rows[0]?.company_name === 'Helios Cloud Logistics' &&
        rows[0]?.seat_util_pct === 41 &&
        totalExposed === 490800;
      return {
        passed,
        actualVerdict: payload?.telemetry?.guardrailVerdict ?? 'ERROR',
        evidence: `${rows.length} at-risk accounts, $490,800 exposed ARR, rank 1 Helios ($228k)`
      };
    }
  },
  {
    id: 'eval-03',
    category: 'sql_analytics',
    categoryLabel: 'SQL analytics',
    title: 'Week-over-week segment snapshot join and variance sum',
    tool: 'query_analytics_readonly',
    isBenignSql: true,
    isAdversarialSql: false,
    expectedVerdict: 'ALLOWED_READONLY',
    probeSummary: "SELECT c.segment, c.net_new_arr_usd - p.net_new_arr_usd FROM weekly_kpi_snapshots WHERE week_start = '2026-04-06'",
    arguments: {
      sql: `
        SELECT
          c.segment,
          CAST(c.net_new_arr_usd AS INTEGER) AS cur_net_new,
          CAST(c.net_new_arr_usd - p.net_new_arr_usd AS INTEGER) AS wow_delta
        FROM weekly_kpi_snapshots c
        JOIN weekly_kpi_snapshots p
          ON c.segment = p.segment AND p.week_start = '2026-03-30'
        WHERE c.week_start = '2026-04-06'
        ORDER BY wow_delta DESC
      `,
      maxRows: 10
    },
    verify(rpcRes) {
      const payload = rpcRes?.result?.structuredContent;
      const rows = payload?.rows ?? [];
      const totalCur = rows.reduce((s, r) => s + r.cur_net_new, 0);
      const totalDelta = rows.reduce((s, r) => s + r.wow_delta, 0);
      const passed =
        rpcRes?.result?.isError === false &&
        rows.length === 3 &&
        rows[0]?.segment === 'Enterprise' &&
        rows[0]?.wow_delta === 43000 &&
        totalCur === 290400 &&
        totalDelta === 62900;
      return {
        passed,
        actualVerdict: payload?.telemetry?.guardrailVerdict ?? 'ERROR',
        evidence: `Net new ARR $290,400 (+$62,900 WoW), Enterprise +$43,000`
      };
    }
  },
  {
    id: 'eval-04',
    category: 'sql_analytics',
    categoryLabel: 'SQL analytics',
    title: 'String literal metacharacter false-positive check and row cap',
    tool: 'query_analytics_readonly',
    isBenignSql: true,
    isAdversarialSql: false,
    expectedVerdict: 'ALLOWED_READONLY',
    probeSummary: "SELECT company_name, 'DROP TABLE; PRAGMA; sqlite_master --' AS note FROM accounts (maxRows: 3)",
    arguments: {
      sql: `
        SELECT
          company_name,
          arr_usd,
          'DROP TABLE accounts; PRAGMA query_only = OFF; sqlite_master --' AS literal_probe
        FROM accounts
        ORDER BY arr_usd DESC;
      `,
      maxRows: 3
    },
    verify(rpcRes) {
      const payload = rpcRes?.result?.structuredContent;
      const passed =
        rpcRes?.result?.isError === false &&
        payload?.telemetry?.guardrailVerdict === 'ALLOWED_READONLY' &&
        payload?.telemetry?.rowCount === 3 &&
        payload?.telemetry?.truncated === true &&
        payload?.rows?.[0]?.company_name === 'Aegis BioSystems';
      return {
        passed,
        actualVerdict: payload?.telemetry?.guardrailVerdict ?? 'ERROR',
        evidence: `Allowed quoted keywords without false positive, capped at 3 rows`
      };
    }
  },
  {
    id: 'eval-05',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'Stacked query injection with piggybacked DROP TABLE',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'MULTI_STATEMENT_BLOCKED',
    probeSummary: "SELECT account_id FROM accounts WHERE segment = 'Enterprise'; DROP TABLE accounts; --",
    arguments: {
      sql: "SELECT account_id FROM accounts WHERE segment = 'Enterprise'; DROP TABLE accounts; --"
    },
    verify(rpcRes) {
      const code = rpcRes?.result?.structuredContent?.error?.code ?? 'NONE';
      const passed = rpcRes?.result?.isError === true && code === 'MULTI_STATEMENT_BLOCKED';
      return {
        passed,
        actualVerdict: code,
        evidence: 'Interior semicolon rejected before SQLite prepare()'
      };
    }
  },
  {
    id: 'eval-06',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'Comment-split keyword obfuscation (DR/**/OP TABLE)',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'FORBIDDEN_SQL_KEYWORD',
    probeSummary: 'WITH probe AS (SELECT 1) DR/**/OP TABLE accounts',
    arguments: {
      sql: 'WITH probe AS (SELECT 1) DR/**/OP TABLE accounts'
    },
    verify(rpcRes) {
      const err = rpcRes?.result?.structuredContent?.error;
      const code = err?.code ?? 'NONE';
      const passed =
        rpcRes?.result?.isError === true &&
        code === 'FORBIDDEN_SQL_KEYWORD' &&
        err?.blockedKeyword === 'DROP';
      return {
        passed,
        actualVerdict: code,
        evidence: `Collapsed inline block comment and blocked keyword '${err?.blockedKeyword ?? 'none'}'`
      };
    }
  },
  {
    id: 'eval-07',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'Direct PRAGMA query_only override attempt',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'NON_SELECT_ROOT_BLOCKED',
    probeSummary: 'PRAGMA query_only = OFF',
    arguments: {
      sql: 'PRAGMA query_only = OFF'
    },
    verify(rpcRes) {
      const code = rpcRes?.result?.structuredContent?.error?.code ?? 'NONE';
      const passed = rpcRes?.result?.isError === true && code === 'NON_SELECT_ROOT_BLOCKED';
      return {
        passed,
        actualVerdict: code,
        evidence: 'Non-SELECT root keyword PRAGMA rejected'
      };
    }
  },
  {
    id: 'eval-08',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'CTE-wrapped ATTACH DATABASE administrative escape',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'FORBIDDEN_SQL_KEYWORD',
    probeSummary: "WITH c AS (SELECT 1) SELECT * FROM accounts WHERE EXISTS (ATTACH DATABASE ':memory:' AS aux)",
    arguments: {
      sql: "WITH c AS (SELECT 1) SELECT * FROM accounts WHERE EXISTS (ATTACH DATABASE ':memory:' AS aux)"
    },
    verify(rpcRes) {
      const err = rpcRes?.result?.structuredContent?.error;
      const code = err?.code ?? 'NONE';
      const passed =
        rpcRes?.result?.isError === true &&
        code === 'FORBIDDEN_SQL_KEYWORD' &&
        err?.blockedKeyword === 'ATTACH';
      return {
        passed,
        actualVerdict: code,
        evidence: `Blocked administrative token '${err?.blockedKeyword ?? 'none'}' inside CTE`
      };
    }
  },
  {
    id: 'eval-09',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'SQLite internal catalog reconnaissance (sqlite_master)',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'SYSTEM_CATALOG_BLOCKED',
    probeSummary: "SELECT name, sql FROM sqlite_master WHERE type = 'table'",
    arguments: {
      sql: "SELECT name, sql FROM sqlite_master WHERE type = 'table'"
    },
    verify(rpcRes) {
      const err = rpcRes?.result?.structuredContent?.error;
      const code = err?.code ?? 'NONE';
      const passed =
        rpcRes?.result?.isError === true &&
        code === 'SYSTEM_CATALOG_BLOCKED' &&
        err?.blockedCatalog === 'sqlite_master';
      return {
        passed,
        actualVerdict: code,
        evidence: 'Blocked sqlite_master probe, redirected to opsflow://schema/catalog'
      };
    }
  },
  {
    id: 'eval-10',
    category: 'sql_guardrails',
    categoryLabel: 'SQL guardrails',
    title: 'Malformed unclosed SQL block comment',
    tool: 'query_analytics_readonly',
    isBenignSql: false,
    isAdversarialSql: true,
    expectedVerdict: 'MALFORMED_SQL_COMMENT',
    probeSummary: 'SELECT account_id /* unclosed block comment FROM accounts',
    arguments: {
      sql: 'SELECT account_id /* unclosed block comment FROM accounts'
    },
    verify(rpcRes) {
      const code = rpcRes?.result?.structuredContent?.error?.code ?? 'NONE';
      const passed = rpcRes?.result?.isError === true && code === 'MALFORMED_SQL_COMMENT';
      return {
        passed,
        actualVerdict: code,
        evidence: 'Scanner rejected unclosed /* block comment'
      };
    }
  },
  {
    id: 'eval-11',
    category: 'data_trust_gates',
    categoryLabel: 'Data trust gates',
    title: 'Stale upstream pipeline detection gates executive reporting',
    tool: 'audit_dataset_health',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'SLA_GATE_BLOCKED',
    probeSummary: '{ "dataset": "pipeline_runs" }',
    arguments: {
      dataset: 'pipeline_runs'
    },
    verify(rpcRes) {
      const audit = rpcRes?.result?.structuredContent;
      const crit = audit?.findings?.find(
        (f) => f.checkType === 'freshness_sla' && f.severity === 'critical'
      );
      const passed =
        rpcRes?.result?.isError === false &&
        audit?.summary?.executiveGateReady === false &&
        crit?.subject === 'revops_attribution_hourly' &&
        crit?.details?.freshnessLagMin === 142;
      return {
        passed,
        actualVerdict: passed ? 'SLA_GATE_BLOCKED' : 'UNEXPECTED_AUDIT',
        evidence: crit
          ? `revops_attribution_hourly flagged at 142m lag (SLA <= 30m)`
          : 'Missed stale pipeline'
      };
    }
  },
  {
    id: 'eval-12',
    category: 'data_trust_gates',
    categoryLabel: 'Data trust gates',
    title: 'Duplicate Stripe idempotency_key replay detection',
    tool: 'audit_dataset_health',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'DUP_KEY_DETECTED',
    probeSummary: '{ "dataset": "revenue_events" }',
    arguments: {
      dataset: 'revenue_events'
    },
    verify(rpcRes) {
      const audit = rpcRes?.result?.structuredContent;
      const dup = audit?.findings?.find((f) => f.checkType === 'duplicate_business_key');
      const passed =
        rpcRes?.result?.isError === false &&
        dup?.severity === 'critical' &&
        dup?.details?.duplicateKeyCount === 2 &&
        dup?.details?.overstatedArrUsd === 21600;
      return {
        passed,
        actualVerdict: passed ? 'DUP_KEY_DETECTED' : 'MISSED_DUPLICATES',
        evidence: dup
          ? `Caught 2 duplicate Stripe keys overstating ARR by $21,600`
          : 'Missed duplicate keys'
      };
    }
  },
  {
    id: 'eval-13',
    category: 'data_trust_gates',
    categoryLabel: 'Data trust gates',
    title: 'Schema NULL drift and runtime z-score anomaly detection',
    tool: 'audit_dataset_health',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'DRIFT_OUTLIER_DETECTED',
    probeSummary: '{ "dataset": "all", "nullThresholdPct": 5, "outlierZThreshold": 2.4 }',
    arguments: {
      dataset: 'all',
      nullThresholdPct: 5,
      outlierZThreshold: 2.4
    },
    verify(rpcRes) {
      const audit = rpcRes?.result?.structuredContent;
      const nullDrift = audit?.findings?.find(
        (f) => f.subject === 'revenue_events.attribution_channel'
      );
      const runtimeOutlier = audit?.findings?.find(
        (f) => f.checkType === 'statistical_outlier' && f.dataset === 'pipeline_runs'
      );
      const passed =
        rpcRes?.result?.isError === false &&
        nullDrift?.details?.nullRatePct === 18.75 &&
        runtimeOutlier?.details?.runId === 'run_revops_905' &&
        runtimeOutlier?.details?.zScore >= 2.4;
      return {
        passed,
        actualVerdict: passed ? 'DRIFT_OUTLIER_DETECTED' : 'MISSED_DRIFT',
        evidence: `NULL drift 18.75% (>5%) and runtime z=${runtimeOutlier?.details?.zScore ?? 'n/a'} on run_revops_905`
      };
    }
  },
  {
    id: 'eval-14',
    category: 'data_trust_gates',
    categoryLabel: 'Data trust gates',
    title: 'Weekly executive KPI variance and Slack Block Kit reconciliation',
    tool: 'compile_weekly_exec_digest',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'KPI_RECONCILED',
    probeSummary: '{ "targetWeek": "2026-04-06", "format": "both" }',
    arguments: {
      targetWeek: '2026-04-06',
      format: 'both'
    },
    verify(rpcRes) {
      const digest = rpcRes?.result?.structuredContent;
      const passed =
        rpcRes?.result?.isError === false &&
        digest?.kpis?.netNewArr?.currentUsd === 290400 &&
        digest?.kpis?.netNewArr?.wowPct === 27.65 &&
        digest?.varianceDrivers?.[0]?.shareOfTotalDeltaPct === 68.4 &&
        digest?.slackBlockKit?.blocks?.length === 5;
      return {
        passed,
        actualVerdict: passed ? 'KPI_RECONCILED' : 'KPI_MISMATCH',
        evidence: `$290,400 Net New ARR (+27.65% WoW), Enterprise 68.4% share, 5 Slack blocks`
      };
    }
  },
  {
    id: 'eval-15',
    category: 'workflow_playbooks',
    categoryLabel: 'Workflow playbooks',
    title: 'Playbook dryRun isolation prevents live CRM and Slack writes',
    tool: 'run_automation_playbook',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'DRY_RUN_ISOLATED',
    probeSummary: '{ "playbook": "churn-rescue-sync", "dryRun": true, "params": { "minArrUsd": 50000 } }',
    arguments: {
      playbook: 'churn-rescue-sync',
      dryRun: true,
      params: { minArrUsd: 50000 }
    },
    verify(rpcRes) {
      const pb = rpcRes?.result?.structuredContent;
      const crmStep = pb?.steps?.find((s) => s.stepId === 'sync_crm_save_tasks');
      const passed =
        rpcRes?.result?.isError === false &&
        pb?.status === 'succeeded' &&
        pb?.summary?.sideEffectsCommitted === 0 &&
        crmStep?.executionMode === 'simulated_dry_run' &&
        crmStep?.output?.upsertedTaskCount === 3;
      return {
        passed,
        actualVerdict: passed ? 'DRY_RUN_ISOLATED' : 'SIDE_EFFECT_LEAK',
        evidence: `0 live side effects committed, 3 Salesforce tasks staged in dryRun`
      };
    }
  },
  {
    id: 'eval-16',
    category: 'workflow_playbooks',
    categoryLabel: 'Workflow playbooks',
    title: 'Exponential-backoff retry recovery after 2 transient 503 failures',
    tool: 'run_automation_playbook',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'RETRY_RECOVERED',
    probeSummary: '{ "playbook": "churn-rescue-sync", "maxRetries": 2, "simulateTransientFailures": { "sync_crm_save_tasks": 2 } }',
    arguments: {
      playbook: 'churn-rescue-sync',
      dryRun: true,
      maxRetries: 2,
      retryBaseDelayMs: 2,
      simulateTransientFailures: { sync_crm_save_tasks: 2 }
    },
    verify(rpcRes) {
      const pb = rpcRes?.result?.structuredContent;
      const crmStep = pb?.steps?.find((s) => s.stepId === 'sync_crm_save_tasks');
      const passed =
        rpcRes?.result?.isError === false &&
        pb?.status === 'succeeded' &&
        pb?.summary?.totalRetriesUsed === 2 &&
        crmStep?.status === 'recovered_after_retry' &&
        crmStep?.attempts === 3;
      return {
        passed,
        actualVerdict: passed ? 'RETRY_RECOVERED' : 'RETRY_FAILED',
        evidence: `sync_crm_save_tasks recovered on attempt 3 after 2 simulated 503 timeouts`
      };
    }
  },
  {
    id: 'eval-17',
    category: 'workflow_playbooks',
    categoryLabel: 'Workflow playbooks',
    title: 'Bounded retry exhaustion halts downstream PagerDuty step',
    tool: 'run_automation_playbook',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'RETRY_HALTED',
    probeSummary: '{ "playbook": "pipeline-sla-triage", "maxRetries": 1, "simulateTransientFailures": { "quarantine_unverified_partition": 3 } }',
    arguments: {
      playbook: 'pipeline-sla-triage',
      dryRun: true,
      maxRetries: 1,
      retryBaseDelayMs: 2,
      simulateTransientFailures: { quarantine_unverified_partition: 3 }
    },
    verify(rpcRes) {
      const pb = rpcRes?.result?.structuredContent;
      const pagerRan = pb?.steps?.some((s) => s.stepId === 'dispatch_pager_incident');
      const passed =
        rpcRes?.result?.isError === true &&
        pb?.status === 'failed' &&
        pb?.failedStepId === 'quarantine_unverified_partition' &&
        pagerRan === false;
      return {
        passed,
        actualVerdict: passed ? 'RETRY_HALTED' : 'UNEXPECTED_CONTINUATION',
        evidence: `Halted at quarantine_unverified_partition (2 attempts), skipped PagerDuty step`
      };
    }
  },
  {
    id: 'eval-18',
    category: 'workflow_playbooks',
    categoryLabel: 'Workflow playbooks',
    title: 'Monday brief playbook attaches governance notice on critical SLA breach',
    tool: 'run_automation_playbook',
    isBenignSql: false,
    isAdversarialSql: false,
    expectedVerdict: 'CAVEAT_ATTACHED',
    probeSummary: '{ "playbook": "monday-kpi-brief", "dryRun": true, "params": { "targetWeek": "2026-04-06" } }',
    arguments: {
      playbook: 'monday-kpi-brief',
      dryRun: true,
      params: { targetWeek: '2026-04-06' }
    },
    verify(rpcRes) {
      const pb = rpcRes?.result?.structuredContent;
      const bannerStep = pb?.steps?.find((s) => s.stepId === 'annotate_data_caveats');
      const banner = bannerStep?.output?.governanceBanner ?? '';
      const passed =
        rpcRes?.result?.isError === false &&
        pb?.status === 'succeeded' &&
        banner.startsWith('GOVERNANCE NOTICE:') &&
        banner.includes('2 upstream attribution/dedup caveat(s)');
      return {
        passed,
        actualVerdict: passed ? 'CAVEAT_ATTACHED' : 'MISSING_CAVEAT',
        evidence: 'Attached GOVERNANCE NOTICE banner for 2 critical upstream caveats'
      };
    }
  }
];

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx];
}

export async function runEvalSuite({ mcp: externalMcp = null } = {}) {
  const ownsServer = externalMcp === null;
  const mcp = externalMcp ?? createOpsFlowMcpServer({ maxCallsPerMinute: 500 });

  const suiteStart = performance.now();
  const results = [];

  try {
    let reqId = 1000;
    for (const evalCase of EVAL_CASES) {
      const t0 = performance.now();
      const rpcResponse = await mcp.handleRequest({
        jsonrpc: '2.0',
        id: reqId++,
        method: 'tools/call',
        params: {
          name: evalCase.tool,
          arguments: evalCase.arguments
        }
      });
      const latencyMs = Number((performance.now() - t0).toFixed(2));
      const outcome = evalCase.verify(rpcResponse);

      results.push({
        id: evalCase.id,
        category: evalCase.category,
        categoryLabel: evalCase.categoryLabel,
        title: evalCase.title,
        tool: evalCase.tool,
        probeSummary: evalCase.probeSummary,
        isBenignSql: evalCase.isBenignSql,
        isAdversarialSql: evalCase.isAdversarialSql,
        expectedVerdict: evalCase.expectedVerdict,
        actualVerdict: outcome.actualVerdict,
        passed: Boolean(outcome.passed),
        evidence: outcome.evidence,
        latencyMs
      });
    }
  } finally {
    if (ownsServer) {
      mcp.close();
    }
  }

  const totalLatencyMs = Number((performance.now() - suiteStart).toFixed(2));
  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = results.length - passedCases;

  const benignSqlResults = results.filter((r) => r.isBenignSql);
  const falsePositives = benignSqlResults.filter((r) => r.actualVerdict !== 'ALLOWED_READONLY').length;
  const falsePositiveRatePct =
    benignSqlResults.length > 0
      ? Number(((falsePositives / benignSqlResults.length) * 100).toFixed(2))
      : 0;

  const adversarialSqlResults = results.filter((r) => r.isAdversarialSql);
  const blockedAttacks = adversarialSqlResults.filter((r) => r.passed).length;
  const attackBlockRatePct =
    adversarialSqlResults.length > 0
      ? Number(((blockedAttacks / adversarialSqlResults.length) * 100).toFixed(2))
      : 0;

  const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const meanLatencyMs = Number(
    (results.reduce((s, r) => s + r.latencyMs, 0) / results.length).toFixed(2)
  );
  const p95LatencyMs = percentile(sortedLatencies, 95);

  const categories = ['sql_analytics', 'sql_guardrails', 'data_trust_gates', 'workflow_playbooks'].map(
    (cat) => {
      const subset = results.filter((r) => r.category === cat);
      return {
        category: cat,
        label: subset[0]?.categoryLabel ?? cat,
        total: subset.length,
        passed: subset.filter((r) => r.passed).length
      };
    }
  );

  return {
    suite: 'opsflow-mcp-deterministic-evals',
    protocolVersion: '2024-11-05',
    generatedAt: new Date().toISOString(),
    summary: {
      totalCases: results.length,
      passedCases,
      failedCases,
      scoreLabel: `${passedCases}/${results.length}`,
      passRatePct: Number(((passedCases / results.length) * 100).toFixed(2)),
      benignSqlCases: benignSqlResults.length,
      falsePositives,
      falsePositiveRatePct,
      adversarialSqlCases: adversarialSqlResults.length,
      blockedAttacks,
      attackBlockRatePct,
      totalLatencyMs,
      meanLatencyMs,
      p95LatencyMs
    },
    categories,
    cases: results
  };
}

function formatCliReport(report) {
  const lines = [];
  lines.push(
    `opsflow-mcp evaluation suite: ${report.summary.scoreLabel} passed (${report.summary.passRatePct}%), false-positive rate ${report.summary.falsePositiveRatePct}%, total ${report.summary.totalLatencyMs}ms`
  );
  lines.push('-'.repeat(108));
  lines.push(
    `${'ID'.padEnd(9)}${'Category'.padEnd(20)}${'Status'.padEnd(8)}${'Actual verdict'.padEnd(26)}${'Latency'.padStart(9)}  Scenario`
  );
  lines.push('-'.repeat(108));

  for (const row of report.cases) {
    const status = row.passed ? 'PASS' : 'FAIL';
    const lat = `${row.latencyMs.toFixed(2)}ms`;
    lines.push(
      `${row.id.padEnd(9)}${row.categoryLabel.padEnd(20)}${status.padEnd(8)}${row.actualVerdict.padEnd(26)}${lat.padStart(9)}  ${row.title}`
    );
  }

  lines.push('-'.repeat(108));
  lines.push(
    `SQL false-positive rate: ${report.summary.falsePositiveRatePct}% (${report.summary.falsePositives}/${report.summary.benignSqlCases}) | Adversarial SQL blocked: ${report.summary.blockedAttacks}/${report.summary.adversarialSqlCases} (${report.summary.attackBlockRatePct}%) | Mean latency: ${report.summary.meanLatencyMs}ms (p95: ${report.summary.p95LatencyMs}ms)`
  );
  return lines.join('\n');
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const report = await runEvalSuite();
  console.log(formatCliReport(report));
  if (report.summary.failedCases > 0) {
    process.exit(1);
  }
}
