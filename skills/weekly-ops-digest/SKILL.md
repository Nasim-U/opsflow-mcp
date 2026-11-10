---
name: weekly-ops-digest
description: Prepare the Monday executive KPI brief with warehouse SLA gating, week-over-week ARR variance attribution, renewal risk checks, and dry-run playbook staging.
version: 1.0.0
mcp_server: opsflow-mcp
required_resources:
  - opsflow://sla/latest
  - opsflow://audit/recent
allowed_tools:
  - audit_dataset_health
  - compile_weekly_exec_digest
  - query_analytics_readonly
  - run_automation_playbook
---

# Weekly executive ops digest (`opsflow-mcp`)

Use this skill to prepare or review the Monday executive operations brief and stage renewal or pipeline follow-up tasks.

## Procedure

### 1. Gate on dataset health

1. Call `audit_dataset_health` with `{ "dataset": "all" }`.
2. Check `summary.executiveGateReady` and `summary.criticalCount`.
   - If `criticalCount` is `0`, continue to step 2.
   - If `criticalCount` is greater than `0`, do not publish unverified attribution totals without a notice. Call `run_automation_playbook` with `{ "playbook": "pipeline-sla-triage", "dryRun": true }` and include the resulting governance notice at the top of the brief.

### 2. Compile week-over-week KPIs

1. Call `compile_weekly_exec_digest` with `{ "targetWeek": "2026-04-06", "format": "both" }`.
2. Confirm these four metrics before writing commentary:
   - Net New ARR (`currentUsd`, `deltaUsd`, `wowPct`) and Expansion ARR.
   - Gross Contraction and Churn ARR plus exposed ARR on `renewalRiskWatchlist`.
   - Pipeline coverage ratio compared against the prior week.
   - Peak segment p95 API latency (`ms`) and support SLA breach count.

### 3. Inspect at-risk accounts

For each Enterprise or Mid-Market account in `renewalRiskWatchlist.accounts` with `health_score < 50`:

1. Check unresolved `SEV-1` and `SEV-2` tickets with `query_analytics_readonly`:

```sql
SELECT
  a.company_name,
  a.arr_usd,
  a.renewal_date,
  e.ticket_id,
  e.severity,
  e.category,
  e.first_response_min,
  e.sla_target_min
FROM accounts a
JOIN support_escalations e ON a.account_id = e.account_id
WHERE a.status = 'at_risk' AND e.resolved = 0
ORDER BY a.arr_usd DESC;
```

2. Stage CRM tasks in dry-run mode by calling `run_automation_playbook` with `{ "playbook": "churn-rescue-sync", "dryRun": true, "params": { "minArrUsd": 50000 } }`.

### 4. Stage brief publication

1. Preview Slack publication by calling `run_automation_playbook` with `{ "playbook": "monday-kpi-brief", "dryRun": true }`.
2. Keep `dryRun: true` unless the user explicitly approves live dispatch.
3. Read `opsflow://audit/recent` to confirm that every tool call and playbook run is recorded in the session audit log.
