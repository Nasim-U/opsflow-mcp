---
name: warehouse-analyst
description: Answer ad-hoc SaaS ARR, renewal health, seat utilization, and pipeline SLA questions through opsflow-mcp with catalog lookup and Stripe idempotency_key deduplication.
version: 1.0.0
mcp_server: opsflow-mcp
required_resources:
  - opsflow://schema/catalog
  - opsflow://sla/latest
allowed_tools:
  - query_analytics_readonly
  - audit_dataset_health
---

# Warehouse analyst (`opsflow-mcp`)

Use this skill to answer analytical questions about ARR changes, account health, seat utilization, support escalations, or data pipeline freshness.

## Procedure

### 1. Read the schema catalog first

Read `opsflow://schema/catalog` with `resources/read` before writing SQL.

- Check exact table names (`accounts`, `revenue_events`, `weekly_kpi_snapshots`, `pipeline_runs`, `support_escalations`), primary keys, and column types.
- Do not query `sqlite_master` or `sqlite_schema`. `query_analytics_readonly` blocks internal SQLite catalog tables with `SYSTEM_CATALOG_BLOCKED`.

### 2. Check upstream data health

Call `audit_dataset_health` on the target table (or `dataset: "all"` when joining across tables).

- If `audit_dataset_health` reports `duplicate_business_key` on `revenue_events.idempotency_key`, deduplicate rows in a CTE before summing `arr_delta_usd`.
- If `freshness_sla` is `critical` for a pipeline such as `revops_attribution_hourly`, read `opsflow://sla/latest` and state the exact lag minutes in the first paragraph of your answer.

### 3. Run read-only SQL

Call `query_analytics_readonly` with a single `SELECT` or `WITH ... SELECT` statement.

- Set `maxRows` between `25` and `100` for summary tables.
- Check `telemetry.truncated` before stating that a result set is complete.

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
ORDER BY a.segment, net_arr_delta_usd DESC;
```

## Output requirements

1. State the numerical answer and unit (`USD`, `%`, `minutes`, or `x`) in the first two sentences.
2. Include a compact Markdown table built from `query_analytics_readonly` rows.
3. Cite `telemetry.queryFingerprint`, `telemetry.rowCount`, and any active warnings from `audit_dataset_health`.
