import { DatabaseSync } from 'node:sqlite';

export const WAREHOUSE_REFERENCE_TIME = '2026-04-13T08:00:00Z';

export const SCHEMA_CATALOG = {
  warehouse: 'opsflow_saas_ops_v1',
  engine: 'node:sqlite (SQLite 3, query_only enforced)',
  referenceTimestamp: WAREHOUSE_REFERENCE_TIME,
  tables: [
    {
      name: 'accounts',
      grain: 'One row per B2B customer organization',
      primaryKey: 'account_id',
      rowCountEstimate: 12,
      piiClassification: 'internal_business',
      columns: [
        { name: 'account_id', type: 'TEXT', description: 'Canonical customer identifier (acc_*)' },
        { name: 'company_name', type: 'TEXT', description: 'Customer legal/display name' },
        { name: 'segment', type: 'TEXT', description: 'Commercial tier: Enterprise | Mid-Market | SMB' },
        { name: 'region', type: 'TEXT', description: 'Geo territory: NA | EMEA | APAC' },
        { name: 'mrr_usd', type: 'REAL', description: 'Contracted monthly recurring revenue in USD' },
        { name: 'arr_usd', type: 'REAL', description: 'Annualized recurring revenue (mrr_usd * 12)' },
        { name: 'seats_purchased', type: 'INTEGER', description: 'Licensed seats under active contract' },
        { name: 'seats_active_30d', type: 'INTEGER', description: 'Distinct active users in trailing 30 days' },
        { name: 'health_score', type: 'INTEGER', description: 'Composite telemetry health score (0-100)' },
        { name: 'renewal_date', type: 'TEXT', description: 'Upcoming contract renewal ISO date' },
        { name: 'csm_owner', type: 'TEXT', description: 'Assigned Customer Success Manager (nullable)' },
        { name: 'status', type: 'TEXT', description: 'Lifecycle state: active | at_risk | churned' },
        { name: 'updated_at', type: 'TEXT', description: 'Last CDC sync timestamp (UTC)' }
      ]
    },
    {
      name: 'revenue_events',
      grain: 'One row per billing ledger event (new, expansion, contraction, churn)',
      primaryKey: 'event_row_id',
      businessKey: 'idempotency_key',
      piiClassification: 'financial_confidential',
      columns: [
        { name: 'event_row_id', type: 'INTEGER', description: 'Warehouse surrogate row ID' },
        { name: 'idempotency_key', type: 'TEXT', description: 'Upstream Stripe/billing event key (must be unique)' },
        { name: 'account_id', type: 'TEXT', description: 'Foreign key to accounts.account_id' },
        { name: 'event_type', type: 'TEXT', description: 'new_logo | expansion | contraction | churn' },
        { name: 'arr_delta_usd', type: 'REAL', description: 'Signed ARR change in USD' },
        { name: 'attribution_channel', type: 'TEXT', description: 'GTM channel source (nullable on tracking drift)' },
        { name: 'occurred_at', type: 'TEXT', description: 'Event effective UTC timestamp' }
      ]
    },
    {
      name: 'weekly_kpi_snapshots',
      grain: 'One row per week_start x segment',
      primaryKey: '(week_start, segment)',
      piiClassification: 'executive_internal',
      columns: [
        { name: 'week_start', type: 'TEXT', description: 'ISO Monday date (YYYY-MM-DD)' },
        { name: 'segment', type: 'TEXT', description: 'Enterprise | Mid-Market | SMB' },
        { name: 'new_arr_usd', type: 'REAL', description: 'Gross new logo ARR closed in week' },
        { name: 'expansion_arr_usd', type: 'REAL', description: 'Upsell & seat expansion ARR in week' },
        { name: 'contraction_arr_usd', type: 'REAL', description: 'Downgrade ARR lost in week (positive magnitude)' },
        { name: 'churned_arr_usd', type: 'REAL', description: 'Gross churned ARR in week (positive magnitude)' },
        { name: 'net_new_arr_usd', type: 'REAL', description: 'new + expansion - contraction - churned' },
        { name: 'pipeline_coverage_ratio', type: 'REAL', description: 'Open qualified pipeline / remaining quota target' },
        { name: 'p95_api_latency_ms', type: 'REAL', description: 'Customer-facing API p95 latency in milliseconds' },
        { name: 'support_sla_breaches', type: 'INTEGER', description: 'Count of support tickets breaching first-response SLA' }
      ]
    },
    {
      name: 'pipeline_runs',
      grain: 'One row per scheduled data ingestion / transformation run',
      primaryKey: 'run_id',
      piiClassification: 'ops_telemetry',
      columns: [
        { name: 'run_id', type: 'TEXT', description: 'Unique orchestrator execution ID' },
        { name: 'pipeline_name', type: 'TEXT', description: 'DAG / connector identifier' },
        { name: 'domain', type: 'TEXT', description: 'finance | product | revops | support | crm' },
        { name: 'completed_at', type: 'TEXT', description: 'Run completion UTC timestamp' },
        { name: 'duration_sec', type: 'REAL', description: 'Wall-clock runtime in seconds' },
        { name: 'rows_processed', type: 'INTEGER', description: 'Rows merged in run' },
        { name: 'sla_freshness_max_min', type: 'INTEGER', description: 'Contracted maximum data staleness in minutes' },
        { name: 'freshness_lag_min', type: 'INTEGER', description: 'Observed data staleness at reference time' },
        { name: 'status', type: 'TEXT', description: 'succeeded | degraded | failed' }
      ]
    },
    {
      name: 'support_escalations',
      grain: 'One row per customer escalation ticket',
      primaryKey: 'ticket_id',
      piiClassification: 'internal_business',
      columns: [
        { name: 'ticket_id', type: 'TEXT', description: 'Support ticket key (ESC-*)' },
        { name: 'account_id', type: 'TEXT', description: 'Foreign key to accounts.account_id' },
        { name: 'severity', type: 'TEXT', description: 'SEV-1 | SEV-2 | SEV-3' },
        { name: 'category', type: 'TEXT', description: 'sso_auth | billing_sync | webhook_latency | api_quota' },
        { name: 'opened_at', type: 'TEXT', description: 'Ticket creation UTC timestamp' },
        { name: 'first_response_min', type: 'INTEGER', description: 'Minutes to first engineer response' },
        { name: 'sla_target_min', type: 'INTEGER', description: 'Contracted SLA response target in minutes' },
        { name: 'resolved', type: 'INTEGER', description: '0 = open, 1 = resolved' }
      ]
    }
  ]
};

export const SLA_CONTRACTS = {
  policyVersion: '2026.04',
  owner: 'Data & Revenue Operations Engineering',
  thresholds: {
    maxNullRatePct: 5.0,
    maxDuplicateBusinessKeys: 0,
    outlierZScoreThreshold: 2.4,
    criticalFreshnessMultiplier: 2.0,
    enterpriseAtRiskHealthCeiling: 55
  },
  pipelines: {
    billing_stripe_cdc: { tier: 'Tier-0', maxFreshnessMin: 15, errorBudgetPct: 99.95 },
    product_telemetry_rollup: { tier: 'Tier-1', maxFreshnessMin: 30, errorBudgetPct: 99.5 },
    crm_salesforce_accounts: { tier: 'Tier-1', maxFreshnessMin: 30, errorBudgetPct: 99.5 },
    revops_attribution_hourly: { tier: 'Tier-1', maxFreshnessMin: 30, errorBudgetPct: 99.0 },
    support_zendesk_sync: { tier: 'Tier-2', maxFreshnessMin: 45, errorBudgetPct: 98.5 }
  }
};

// Applies PRAGMA query_only = ON and trusted_schema = OFF after seeding as a kernel-level read-only lock.
export function createOpsWarehouse({ lockReadOnly = true } = {}) {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE accounts (
      account_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      segment TEXT NOT NULL CHECK (segment IN ('Enterprise', 'Mid-Market', 'SMB')),
      region TEXT NOT NULL CHECK (region IN ('NA', 'EMEA', 'APAC')),
      mrr_usd REAL NOT NULL,
      arr_usd REAL NOT NULL,
      seats_purchased INTEGER NOT NULL,
      seats_active_30d INTEGER NOT NULL,
      health_score INTEGER NOT NULL,
      renewal_date TEXT NOT NULL,
      csm_owner TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'at_risk', 'churned')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE revenue_events (
      event_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(account_id),
      event_type TEXT NOT NULL CHECK (event_type IN ('new_logo', 'expansion', 'contraction', 'churn')),
      arr_delta_usd REAL NOT NULL,
      attribution_channel TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE weekly_kpi_snapshots (
      week_start TEXT NOT NULL,
      segment TEXT NOT NULL,
      new_arr_usd REAL NOT NULL,
      expansion_arr_usd REAL NOT NULL,
      contraction_arr_usd REAL NOT NULL,
      churned_arr_usd REAL NOT NULL,
      net_new_arr_usd REAL NOT NULL,
      pipeline_coverage_ratio REAL NOT NULL,
      p95_api_latency_ms REAL NOT NULL,
      support_sla_breaches INTEGER NOT NULL,
      PRIMARY KEY (week_start, segment)
    );

    CREATE TABLE pipeline_runs (
      run_id TEXT PRIMARY KEY,
      pipeline_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_sec REAL NOT NULL,
      rows_processed INTEGER NOT NULL,
      sla_freshness_max_min INTEGER NOT NULL,
      freshness_lag_min INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('succeeded', 'degraded', 'failed'))
    );

    CREATE TABLE support_escalations (
      ticket_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id),
      severity TEXT NOT NULL CHECK (severity IN ('SEV-1', 'SEV-2', 'SEV-3')),
      category TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      first_response_min INTEGER NOT NULL,
      sla_target_min INTEGER NOT NULL,
      resolved INTEGER NOT NULL CHECK (resolved IN (0, 1))
    );
  `);

  const insertAccount = db.prepare(`
    INSERT INTO accounts (
      account_id, company_name, segment, region, mrr_usd, arr_usd,
      seats_purchased, seats_active_30d, health_score, renewal_date,
      csm_owner, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const accountsSeed = [
    ['acc_ent_01', 'Meridian FinTech Corp', 'Enterprise', 'NA', 24500, 294000, 250, 234, 91, '2026-09-30', 'Maya Lin', 'active', '2026-04-13T07:46:00Z'],
    ['acc_ent_02', 'Helios Cloud Logistics', 'Enterprise', 'EMEA', 19000, 228000, 200, 82, 41, '2026-05-15', 'Devon Brooks', 'at_risk', '2026-04-13T07:46:00Z'],
    ['acc_ent_03', 'Aegis BioSystems', 'Enterprise', 'NA', 31000, 372000, 320, 305, 94, '2026-11-01', 'Maya Lin', 'active', '2026-04-13T07:46:00Z'],
    ['acc_ent_04', 'Nordic Grid Analytics', 'Enterprise', 'EMEA', 16500, 198000, 180, 69, 46, '2026-05-28', 'Devon Brooks', 'at_risk', '2026-04-13T07:46:00Z'],
    ['acc_mm_01', 'Vanguard Retail Ops', 'Mid-Market', 'NA', 6800, 81600, 85, 79, 86, '2026-08-15', 'Sofia Patel', 'active', '2026-04-13T07:46:00Z'],
    ['acc_mm_02', 'Kestrel Pay APAC', 'Mid-Market', 'APAC', 5400, 64800, 70, 31, 49, '2026-06-01', 'Liam Chen', 'at_risk', '2026-04-13T07:46:00Z'],
    ['acc_mm_03', 'Cobalt Freight AI', 'Mid-Market', 'NA', 7200, 86400, 90, 84, 88, '2026-10-12', 'Sofia Patel', 'active', '2026-04-13T07:46:00Z'],
    ['acc_mm_04', 'Solstice MedTech', 'Mid-Market', 'EMEA', 4900, 58800, 60, 55, 81, '2026-07-20', 'Liam Chen', 'active', '2026-04-13T07:46:00Z'],
    ['acc_smb_01', 'PulseMetrics Studio', 'SMB', 'NA', 1400, 16800, 20, 19, 89, '2026-07-01', 'Elena Gomez', 'active', '2026-04-13T07:46:00Z'],
    ['acc_smb_02', 'Harborline Legal', 'SMB', 'NA', 1100, 13200, 15, 0, 12, '2026-04-05', 'Elena Gomez', 'churned', '2026-04-10T18:00:00Z'],
    ['acc_smb_03', 'Quarry Data Labs', 'SMB', 'APAC', 1650, 19800, 25, 23, 84, '2026-09-10', null, 'active', '2026-04-13T07:46:00Z'],
    ['acc_smb_04', 'BrightPath Robotics', 'SMB', 'EMEA', 1900, 22800, 30, 27, 87, '2026-12-01', 'Elena Gomez', 'active', '2026-04-13T07:46:00Z']
  ];

  for (const row of accountsSeed) {
    insertAccount.run(...row);
  }

  // Intentional fixture anomalies for auditDatasetHealth: 3/16 NULL channels (18.75%),
  // 2 duplicate Stripe idempotency keys, and 1 high-magnitude Enterprise expansion ($148,000).
  const insertRevEvent = db.prepare(`
    INSERT INTO revenue_events (
      idempotency_key, account_id, event_type, arr_delta_usd, attribution_channel, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const revenueEventsSeed = [
    ['evt_stripe_99101', 'acc_ent_01', 'expansion', 28000, 'enterprise_outbound', '2026-04-06T14:20:00Z'],
    ['evt_stripe_99115', 'acc_mm_01', 'expansion', 14400, 'product_led_upsell', '2026-04-07T10:05:00Z'],
    ['evt_stripe_99142', 'acc_smb_01', 'new_logo', 16800, 'organic_search', '2026-04-07T16:40:00Z'],
    ['evt_stripe_99178', 'acc_ent_02', 'contraction', -24000, 'csm_renewal', '2026-04-08T11:15:00Z'],
    ['evt_stripe_99190', 'acc_mm_03', 'new_logo', 21600, 'partner_referral', '2026-04-08T19:00:00Z'],
    ['evt_stripe_99203', 'acc_smb_02', 'churn', -13200, 'self_serve', '2026-04-09T09:30:00Z'],
    ['evt_stripe_99214_dup', 'acc_mm_04', 'expansion', 12000, null, '2026-04-09T15:12:00Z'],
    ['evt_stripe_99214_dup', 'acc_mm_04', 'expansion', 12000, null, '2026-04-09T15:12:02Z'],
    ['evt_stripe_99239', 'acc_ent_03', 'expansion', 148000, 'enterprise_outbound', '2026-04-10T17:45:00Z'],
    ['evt_stripe_99251', 'acc_smb_03', 'new_logo', 19800, null, '2026-04-11T08:22:00Z'],
    ['evt_stripe_99267', 'acc_ent_04', 'contraction', -18000, 'csm_renewal', '2026-04-11T13:50:00Z'],
    ['evt_stripe_99288_dup', 'acc_smb_04', 'expansion', 9600, 'product_led_upsell', '2026-04-12T10:10:00Z'],
    ['evt_stripe_99288_dup', 'acc_smb_04', 'expansion', 9600, 'product_led_upsell', '2026-04-12T10:10:03Z'],
    ['evt_stripe_99302', 'acc_mm_02', 'contraction', -9600, 'csm_renewal', '2026-04-12T16:05:00Z'],
    ['evt_stripe_99319', 'acc_ent_01', 'expansion', 18000, 'enterprise_outbound', '2026-04-12T21:30:00Z'],
    ['evt_stripe_99330', 'acc_mm_01', 'expansion', 10800, 'product_led_upsell', '2026-04-13T04:15:00Z']
  ];

  for (const row of revenueEventsSeed) {
    insertRevEvent.run(...row);
  }

  const insertSnapshot = db.prepare(`
    INSERT INTO weekly_kpi_snapshots (
      week_start, segment, new_arr_usd, expansion_arr_usd, contraction_arr_usd,
      churned_arr_usd, net_new_arr_usd, pipeline_coverage_ratio,
      p95_api_latency_ms, support_sla_breaches
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const kpiSeed = [
    // 2026-03-23
    ['2026-03-23', 'Enterprise', 88000, 62000, 14000, 0, 136000, 3.4, 168, 1],
    ['2026-03-23', 'Mid-Market', 42000, 29000, 8000, 12000, 51000, 3.1, 152, 1],
    ['2026-03-23', 'SMB', 24000, 11000, 4500, 9000, 21500, 2.8, 141, 2],
    // 2026-03-30 (Prior Week)
    ['2026-03-30', 'Enterprise', 95000, 74000, 18000, 0, 151000, 3.5, 174, 1],
    ['2026-03-30', 'Mid-Market', 46000, 31000, 9500, 14000, 53500, 3.0, 159, 2],
    ['2026-03-30', 'SMB', 26000, 12500, 5000, 10500, 23000, 2.7, 144, 2],
    // 2026-04-06 (Current Completed Week)
    ['2026-04-06', 'Enterprise', 112000, 124000, 42000, 0, 194000, 3.8, 212, 3],
    ['2026-04-06', 'Mid-Market', 39000, 37200, 9600, 0, 66600, 3.2, 164, 1],
    ['2026-04-06', 'SMB', 36600, 9600, 3200, 13200, 29800, 2.6, 148, 2]
  ];

  for (const row of kpiSeed) {
    insertSnapshot.run(...row);
  }

  const insertPipelineRun = db.prepare(`
    INSERT INTO pipeline_runs (
      run_id, pipeline_name, domain, completed_at, duration_sec,
      rows_processed, sla_freshness_max_min, freshness_lag_min, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pipelineSeed = [
    ['run_stripe_901', 'billing_stripe_cdc', 'finance', '2026-04-13T07:56:00Z', 41.2, 18420, 15, 4, 'succeeded'],
    ['run_prod_902', 'product_telemetry_rollup', 'product', '2026-04-13T07:51:00Z', 94.5, 412800, 30, 9, 'succeeded'],
    ['run_crm_903', 'crm_salesforce_accounts', 'crm', '2026-04-13T07:46:00Z', 63.8, 9450, 30, 14, 'succeeded'],
    ['run_zendesk_904', 'support_zendesk_sync', 'support', '2026-04-13T07:08:00Z', 118.4, 3280, 45, 52, 'degraded'],
    ['run_revops_898', 'revops_attribution_hourly', 'revops', '2026-04-13T02:30:00Z', 82.0, 24100, 30, 12, 'succeeded'],
    ['run_revops_899', 'revops_attribution_hourly', 'revops', '2026-04-13T03:30:00Z', 86.5, 25300, 30, 11, 'succeeded'],
    ['run_revops_900', 'revops_attribution_hourly', 'revops', '2026-04-13T04:30:00Z', 79.2, 23900, 30, 13, 'succeeded'],
    ['run_revops_905', 'revops_attribution_hourly', 'revops', '2026-04-13T05:38:00Z', 912.6, 26400, 30, 142, 'failed']
  ];

  for (const row of pipelineSeed) {
    insertPipelineRun.run(...row);
  }

  const insertEscalation = db.prepare(`
    INSERT INTO support_escalations (
      ticket_id, account_id, severity, category, opened_at,
      first_response_min, sla_target_min, resolved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const escalationsSeed = [
    ['ESC-4012', 'acc_ent_02', 'SEV-1', 'webhook_latency', '2026-04-11T14:10:00Z', 38, 15, 0],
    ['ESC-4019', 'acc_ent_04', 'SEV-1', 'sso_auth', '2026-04-12T09:05:00Z', 29, 15, 0],
    ['ESC-4024', 'acc_mm_02', 'SEV-2', 'billing_sync', '2026-04-12T18:20:00Z', 44, 60, 0],
    ['ESC-4028', 'acc_ent_01', 'SEV-3', 'api_quota', '2026-04-10T11:00:00Z', 22, 120, 1],
    ['ESC-4031', 'acc_smb_04', 'SEV-2', 'webhook_latency', '2026-04-09T15:30:00Z', 74, 60, 1]
  ];

  for (const row of escalationsSeed) {
    insertEscalation.run(...row);
  }

  if (lockReadOnly) {
    db.exec('PRAGMA trusted_schema = OFF;');
    db.exec('PRAGMA query_only = ON;');
  }

  return db;
}
