---
name: warehouse-analyst
description: Deterministic analytical workflow skill for answering ad-hoc SaaS revenue, renewal health, and pipeline reliability questions using the OpsFlow MCP server without schema hallucination or unverified SQL aggregations.
version: 1.0.0
mcp_server: opsflow-mcp
required_resources:
  - opsflow://schema/catalog
  - opsflow://sla/latest
allowed_tools:
  - query_analytics_readonly
  - audit_dataset_health
---

# Warehouse Analyst Skill (`opsflow-mcp`)

Use this skill whenever a stakeholder asks an ad-hoc analytical question about ARR movements, customer health, seat utilization, support escalations, or data pipeline SLAs.

## Mandatory Execution Sequence

### Step 1 — Schema & Grain Verification (Never Guess Column Names)
Before writing any SQL query, read MCP resource `opsflow://schema/catalog` via `resources/read`:
- Confirm exact table names (`accounts`, `revenue_events`, `weekly_kpi_snapshots`, `pipeline_runs`, `support_escalations`), primary keys, and column data types.
- Never query `sqlite_master` or `sqlite_schema` directly; internal catalog introspection is blocked by OpsFlow guardrails (`SYSTEM_CATALOG_BLOCKED`).

### Step 2 — Upstream Trust Check on Target Tables
Call `audit_dataset_health` scoped to the primary table you plan to aggregate (or `dataset: "all"` for cross-domain joins):
- If `duplicate_business_key` findings are active on `revenue_events.idempotency_key`, **always deduplicate inside a CTE** before summing `arr_delta_usd`.
- If `freshness_sla` is in `critical` state for a domain (for example, `revops_attribution_hourly`), disclose the exact lag minutes from `opsflow://sla/latest` in your response header.

### Step 3 — Guardrailed Read-Only SQL Construction
Execute queries exclusively through `query_analytics_readonly`:
- Emit a single `SELECT` or `WITH ... SELECT` statement (multi-statement queries and DDL/DML keywords are deterministically rejected).
- Set an explicit `maxRows` bound (`25`–`100` for executive tables) and check `telemetry.truncated` in the response before claiming completeness.

#### Canonical Deduplicated ARR Aggregation Pattern
```sql
WITH deduped_events AS (
  SELECT
    event_row_id,
    idempotency_key,
    account_id,
    event_type,
    arr_delta_usd,
    COALESCE(attribution_channel, 'unattributed_drift') AS attribution_channel,
    occurred_at,
    ROW_NUMBER() OVER (
      PARTITION BY idempotency_key
      ORDER BY event_row_id ASC
    ) AS rn
  FROM revenue_events
)
SELECT
  a.segment,
  d.event_type,
  COUNT(*) AS verified_events,
  SUM(d.arr_delta_usd) AS net_arr_delta_usd
FROM deduped_events d
JOIN accounts a ON a.account_id = d.account_id
WHERE d.rn = 1
GROUP BY a.segment, d.event_type
ORDER BY a.segment, net_arr_delta_usd DESC
```

## Response Formatting Contract
Every analytical answer produced under this skill must include:
1. **Headline Answer** — Direct numerical finding in the first two sentences with exact units (`USD`, `%`, `minutes`, `x`).
2. **Supporting Breakdown** — Compact Markdown table derived directly from `query_analytics_readonly` rows.
3. **Provenance & Caveats Footer** — Cite `telemetry.queryFingerprint`, `telemetry.rowCount`, and any active SLA/drift warnings from `audit_dataset_health`.
