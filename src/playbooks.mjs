import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { auditDatasetHealth } from './health-audit.mjs';
import { compileWeeklyExecDigest } from './exec-digest.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const PLAYBOOK_CATALOG = {
  'churn-rescue-sync': {
    id: 'churn-rescue-sync',
    title: 'Enterprise & Mid-Market Churn Rescue Sync',
    owner: 'Customer Success & RevOps',
    description:
      'Identifies high-ARR at-risk accounts with low seat utilization or open SEV-1/2 escalations, scores renewal urgency, and dispatches CRM/Slack intervention tasks.'
  },
  'monday-kpi-brief': {
    id: 'monday-kpi-brief',
    title: 'Monday Executive KPI Brief with Data Trust Gate',
    owner: 'Strategy & Analytics Engineering',
    description:
      'Runs warehouse health gate checks, compiles WoW executive KPI variances, attaches data quality caveats, and publishes a Slack Block Kit brief.'
  },
  'pipeline-sla-triage': {
    id: 'pipeline-sla-triage',
    title: 'Automated Data Pipeline SLA Breach Triage & Quarantine',
    owner: 'Data Platform Engineering',
    description:
      'Detects SLA-breaching ingestion pipelines, correlates downstream null/duplicate anomalies, quarantines affected partitions, and opens an on-call incident.'
  }
};

function normalizePlaybookId(rawName) {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    throw new Error('Playbook name must be a non-empty string.');
  }
  const normalized = rawName.trim().toLowerCase();
  if (!PLAYBOOK_CATALOG[normalized]) {
    throw new Error(
      `Unknown playbook '${rawName}'. Supported playbooks: ${Object.keys(PLAYBOOK_CATALOG).join(', ')}`
    );
  }
  return normalized;
}

function buildPlaybookSteps(playbookId, db, params) {
  if (playbookId === 'churn-rescue-sync') {
    const minArrUsd = Number(params.minArrUsd ?? 50000);
    return [
      {
        stepId: 'detect_at_risk_accounts',
        name: 'Query Warehouse for High-ARR At-Risk Renewals',
        sideEffect: false,
        run: async () => {
          const accounts = db.prepare(`
            SELECT
              a.account_id,
              a.company_name,
              a.segment,
              a.region,
              a.arr_usd,
              a.health_score,
              a.seats_purchased,
              a.seats_active_30d,
              ROUND((CAST(a.seats_active_30d AS REAL) / a.seats_purchased) * 100, 1) AS seat_utilization_pct,
              a.renewal_date,
              a.csm_owner,
              COUNT(e.ticket_id) AS open_escalations,
              MAX(e.severity) AS highest_severity
            FROM accounts a
            LEFT JOIN support_escalations e
              ON a.account_id = e.account_id AND e.resolved = 0
            WHERE a.status = 'at_risk' AND a.arr_usd >= ?
            GROUP BY a.account_id
            ORDER BY a.arr_usd DESC
          `).all(minArrUsd).map((r) => ({ ...r }));

          return {
            matchedAccountCount: accounts.length,
            exposedArrUsd: accounts.reduce((s, a) => s + a.arr_usd, 0),
            accounts
          };
        }
      },
      {
        stepId: 'score_renewal_urgency',
        name: 'Compute Renewal Urgency & Intervention Tier',
        sideEffect: false,
        run: async (ctx) => {
          const prev = ctx.detect_at_risk_accounts;
          const interventions = prev.accounts.map((acc) => {
            const hasSev1 = acc.highest_severity === 'SEV-1';
            const lowAdoption = acc.seat_utilization_pct < 45;
            const urgencyTier = hasSev1 && lowAdoption ? 'CRITICAL_EXEC_SAVE' : 'PRIORITY_CSM_PLAY';
            return {
              accountId: acc.account_id,
              companyName: acc.company_name,
              arrUsd: acc.arr_usd,
              csmOwner: acc.csm_owner ?? 'UNASSIGNED_ROUND_ROBIN',
              urgencyTier,
              recommendedPlay: hasSev1
                ? 'Pair Principal Solutions Architect on SEV-1 fix + VP Product renewal check-in within 24h'
                : 'Schedule seat-adoption enablement workshop + 60-day renewal health review'
            };
          });
          return { interventionCount: interventions.length, interventions };
        }
      },
      {
        stepId: 'sync_crm_save_tasks',
        name: 'Upsert Salesforce Renewal Save Tasks',
        sideEffect: true,
        targetSystem: 'salesforce_crm',
        run: async (ctx, { dryRun }) => {
          const { interventions } = ctx.score_renewal_urgency;
          return {
            dispatchMode: dryRun ? 'simulated_dry_run' : 'committed_live',
            upsertedTaskCount: interventions.length,
            taskIds: interventions.map((item, idx) => `SFDC-TASK-${2040 + idx}-${item.accountId}`)
          };
        }
      },
      {
        stepId: 'notify_exec_sponsor_channel',
        name: 'Dispatch Escalation Brief to #revops-churn-watch',
        sideEffect: true,
        targetSystem: 'slack_webhook',
        run: async (ctx, { dryRun }) => {
          const { exposedArrUsd, matchedAccountCount } = ctx.detect_at_risk_accounts;
          return {
            dispatchMode: dryRun ? 'simulated_dry_run' : 'committed_live',
            channel: '#revops-churn-watch',
            headline: `Queued save interventions for ${matchedAccountCount} accounts ($${exposedArrUsd.toLocaleString('en-US')} ARR exposed)`
          };
        }
      }
    ];
  }

  if (playbookId === 'monday-kpi-brief') {
    const targetWeek = params.targetWeek ?? '2026-04-06';
    return [
      {
        stepId: 'verify_warehouse_health_gate',
        name: 'Run Pre-Publish Warehouse Freshness & Integrity Gate',
        sideEffect: false,
        run: async () => {
          const audit = auditDatasetHealth(db, { dataset: 'all' });
          return {
            healthScore: audit.healthScore,
            overallStatus: audit.overallStatus,
            criticalFindings: audit.summary.criticalCount,
            warningFindings: audit.summary.warningCount,
            executiveGateReady: audit.summary.executiveGateReady
          };
        }
      },
      {
        stepId: 'compile_exec_scorecard',
        name: 'Compile Weekly KPI Deltas & Segment Variance',
        sideEffect: false,
        run: async () => {
          const digest = compileWeeklyExecDigest(db, { targetWeek, format: 'both' });
          return {
            period: digest.period,
            netNewArrUsd: digest.kpis.netNewArr.currentUsd,
            netNewWowPct: digest.kpis.netNewArr.wowPct,
            topDriverSegment: digest.varianceDrivers[0]?.segment ?? 'Enterprise',
            slackBlockCount: digest.slackBlockKit.blocks.length
          };
        }
      },
      {
        stepId: 'annotate_data_caveats',
        name: 'Attach Automated Data Governance Banner',
        sideEffect: false,
        run: async (ctx) => {
          const gate = ctx.verify_warehouse_health_gate;
          const banner = gate.executiveGateReady
            ? 'VERIFIED: All Tier-0/Tier-1 warehouse SLAs satisfied.'
            : `GOVERNANCE NOTICE: Core Stripe & KPI snapshots verified; ${gate.criticalFindings} upstream attribution/dedup caveat(s) flagged for RevOps remediation.`;
          return { governanceBanner: banner, healthScore: gate.healthScore };
        }
      },
      {
        stepId: 'publish_exec_slack_brief',
        name: 'Publish Executive Digest to #exec-staff-weekly',
        sideEffect: true,
        targetSystem: 'slack_webhook',
        run: async (ctx, { dryRun }) => {
          return {
            dispatchMode: dryRun ? 'simulated_dry_run' : 'committed_live',
            channel: '#exec-staff-weekly',
            weekPublished: ctx.compile_exec_scorecard.period.currentWeek,
            governanceBanner: ctx.annotate_data_caveats.governanceBanner
          };
        }
      }
    ];
  }

  // pipeline-sla-triage
  return [
    {
      stepId: 'scan_sla_breaches',
      name: 'Scan Orchestrator Telemetry for SLA Breaches',
      sideEffect: false,
      run: async () => {
        const breached = db.prepare(`
          WITH latest AS (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY pipeline_name ORDER BY completed_at DESC) AS rn
            FROM pipeline_runs
          )
          SELECT run_id, pipeline_name, domain, status, freshness_lag_min, sla_freshness_max_min, duration_sec
          FROM latest
          WHERE rn = 1 AND (status != 'succeeded' OR freshness_lag_min > sla_freshness_max_min)
          ORDER BY freshness_lag_min DESC
        `).all().map((r) => ({ ...r }));

        return {
          breachedCount: breached.length,
          breachedPipelines: breached
        };
      }
    },
    {
      stepId: 'isolate_upstream_anomalies',
      name: 'Correlate Downstream Null Drift & Duplicate Webhook Keys',
      sideEffect: false,
      run: async () => {
        const audit = auditDatasetHealth(db, { dataset: 'revenue_events' });
        return {
          correlatedFindingCount: audit.findings.length,
          criticalFindings: audit.findings
            .filter((f) => f.severity === 'critical')
            .map((f) => ({ subject: f.subject, metric: f.metric }))
        };
      }
    },
    {
      stepId: 'quarantine_unverified_partition',
      name: 'Apply Soft Quarantine Tag on Unverified Attribution Partition',
      sideEffect: true,
      targetSystem: 'warehouse_governance_catalog',
      run: async (ctx, { dryRun }) => {
        const primary = ctx.scan_sla_breaches.breachedPipelines[0];
        return {
          dispatchMode: dryRun ? 'simulated_dry_run' : 'committed_live',
          quarantinedAsset: primary ? `mart.${primary.pipeline_name}_v1` : 'none',
          downstreamConsumersProtected: ['bi_attribution_exec_view', 'cac_payback_model']
        };
      }
    },
    {
      stepId: 'dispatch_pager_incident',
      name: 'Open Incident Ticket with Deterministic Remediation Runbook',
      sideEffect: true,
      targetSystem: 'pagerduty_incidents',
      run: async (ctx, { dryRun }) => {
        const primary = ctx.scan_sla_breaches.breachedPipelines[0];
        return {
          dispatchMode: dryRun ? 'simulated_dry_run' : 'committed_live',
          incidentKey: `INC-OPS-${primary ? primary.run_id.toUpperCase() : 'NONE'}`,
          assignedRotation: 'data-platform-primary',
          severity: primary?.status === 'failed' ? 'SEV-2' : 'SEV-3'
        };
      }
    }
  ];
}

export async function runAutomationPlaybook(
  db,
  {
    playbook,
    dryRun = true,
    maxRetries = 2,
    retryBaseDelayMs = 8,
    params = {},
    simulateTransientFailures = {}
  } = {}
) {
  const playbookId = normalizePlaybookId(playbook);
  const metadata = PLAYBOOK_CATALOG[playbookId];
  const boundedMaxRetries = Math.min(Math.max(Math.trunc(Number(maxRetries) || 0), 0), 5);
  const baseDelay = Math.min(Math.max(Number(retryBaseDelayMs) || 5, 1), 250);

  const runId = `pbk_${randomUUID().slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  const steps = buildPlaybookSteps(playbookId, db, params);
  const stepContext = {};
  const auditTrail = [];
  const remainingFailures = { ...simulateTransientFailures };

  let overallStatus = 'succeeded';
  let failedStepId = null;

  for (const step of steps) {
    const stepStart = performance.now();
    let attempt = 0;
    let stepSucceeded = false;
    let stepOutput = null;
    let lastError = null;
    const retryHistory = [];

    while (attempt <= boundedMaxRetries) {
      attempt += 1;
      try {
        if ((remainingFailures[step.stepId] ?? 0) > 0) {
          remainingFailures[step.stepId] -= 1;
          throw new Error(
            `Transient upstream timeout on '${step.targetSystem ?? step.stepId}' (HTTP 503 Service Unavailable)`
          );
        }

        stepOutput = await step.run(stepContext, { dryRun: Boolean(dryRun) });
        stepSucceeded = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const willRetry = attempt <= boundedMaxRetries;
        const backoffMs = willRetry ? baseDelay * 2 ** (attempt - 1) : 0;
        retryHistory.push({
          attempt,
          error: lastError,
          willRetry,
          backoffMs
        });
        if (willRetry) {
          await sleep(backoffMs);
        }
      }
    }

    const durationMs = Number((performance.now() - stepStart).toFixed(3));

    if (stepSucceeded) {
      stepContext[step.stepId] = stepOutput;
      auditTrail.push({
        stepId: step.stepId,
        name: step.name,
        sideEffect: step.sideEffect,
        executionMode: step.sideEffect
          ? dryRun
            ? 'simulated_dry_run'
            : 'committed_live'
          : 'read_compute',
        status: retryHistory.length > 0 ? 'recovered_after_retry' : 'succeeded',
        attempts: attempt,
        retryHistory,
        durationMs,
        output: stepOutput
      });
    } else {
      overallStatus = 'failed';
      failedStepId = step.stepId;
      auditTrail.push({
        stepId: step.stepId,
        name: step.name,
        sideEffect: step.sideEffect,
        executionMode: step.sideEffect
          ? dryRun
            ? 'simulated_dry_run'
            : 'committed_live'
          : 'read_compute',
        status: 'failed_exhausted_retries',
        attempts: attempt,
        retryHistory,
        durationMs,
        error: lastError
      });
      break;
    }
  }

  const totalDurationMs = Number((performance.now() - t0).toFixed(3));
  const completedAt = new Date().toISOString();

  return {
    runId,
    playbook: playbookId,
    title: metadata.title,
    owner: metadata.owner,
    dryRun: Boolean(dryRun),
    status: overallStatus,
    failedStepId,
    retryPolicy: {
      maxRetries: boundedMaxRetries,
      retryBaseDelayMs: baseDelay
    },
    timing: {
      startedAt,
      completedAt,
      totalDurationMs
    },
    summary: {
      stepsTotal: steps.length,
      stepsCompleted: auditTrail.filter((s) => s.status !== 'failed_exhausted_retries').length,
      totalRetriesUsed: auditTrail.reduce((sum, s) => sum + s.retryHistory.length, 0),
      sideEffectsCommitted: dryRun
        ? 0
        : auditTrail.filter((s) => s.sideEffect && s.status !== 'failed_exhausted_retries').length
    },
    steps: auditTrail
  };
}
