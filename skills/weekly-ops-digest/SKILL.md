---
name: weekly-ops-digest
description: End-to-end Monday morning executive operations workflow combining automated warehouse SLA gating, week-over-week KPI variance attribution, renewal risk triage, and Slack Block Kit brief publication.
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

# Weekly Executive Ops Digest Skill (`opsflow-mcp`)

Use this skill when preparing, reviewing, or publishing the Monday Executive Operations Brief or running weekly renewal/pipeline triage routines.

## Deterministic 4-Stage Workflow

### Stage 1 — Pre-Publish Data Governance Gate
1. Call `audit_dataset_health` with `{ "dataset": "all" }`.
2. Inspect `summary.executiveGateReady` and `healthScore`:
   - **Gate Passed (`criticalCount === 0`):** Proceed directly to KPI compilation.
   - **Gate Degraded (`criticalCount > 0`):** Do **not** silently publish unverified attribution metrics. Run `run_automation_playbook` with `{ "playbook": "pipeline-sla-triage", "dryRun": true }` to generate the remediation ticket preview and attach a governance banner to the executive brief.

### Stage 2 — Week-over-Week KPI Compilation & Driver Attribution
1. Call `compile_weekly_exec_digest` with `{ "targetWeek": "2026-04-06", "format": "both" }`.
2. Verify that all four executive pillars are present before drafting commentary:
   - **Growth:** Net New ARR (`currentUsd`, `deltaUsd`, `wowPct`) and Expansion ARR.
   - **Retention:** Gross Contraction + Churn ARR and total exposed ARR on the Renewal Risk Watchlist.
   - **GTM Coverage:** Pipeline Coverage Ratio vs prior week.
   - **Operational Reliability:** Peak Enterprise p95 API latency (`ms`) and Support SLA breach count.

### Stage 3 — Account-Level Risk Drill-Down
For every Enterprise or Mid-Market account listed in `renewalRiskWatchlist.accounts` with `health_score < 50`:
1. Cross-check open SEV-1 / SEV-2 tickets via `query_analytics_readonly`:
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
   ORDER BY a.arr_usd DESC
   ```
2. Stage CRM intervention tasks in dry-run mode first:
   - Call `run_automation_playbook` with `{ "playbook": "churn-rescue-sync", "dryRun": true, "params": { "minArrUsd": 50000 } }`.

### Stage 4 — Controlled Brief Dispatch (`dryRun` First)
1. Preview the executive dispatch via `run_automation_playbook` (`playbook: "monday-kpi-brief"`, `dryRun: true`).
2. Only set `dryRun: false` after explicit human confirmation in chat or an approved scheduled automation trigger.
3. Read `opsflow://audit/recent` to confirm all tool executions and playbook runs are recorded in the session audit log.
