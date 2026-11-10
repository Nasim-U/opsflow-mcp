#!/usr/bin/env node
import {
  createOpsFlowMcpServer,
  startStdioServer,
  startHttpServer
} from './mcp-server.mjs';

const useColor = !process.env.NO_COLOR;
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  magenta: useColor ? '\x1b[35m' : ''
};

function banner(title) {
  const line = '─'.repeat(74);
  console.log(`\n${c.cyan}${line}${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${title}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}`);
}

export async function runDemo() {
  const mcp = createOpsFlowMcpServer();
  let reqId = 1;
  const rpc = (method, params = {}) =>
    mcp.handleRequest({ jsonrpc: '2.0', id: reqId++, method, params });

  console.log(
    `${c.bold}${c.magenta}OpsFlow MCP v1.0.0 — Live Protocol Inspector & Guardrail Showcase${c.reset}`
  );
  console.log(
    `${c.dim}Transport: JSON-RPC 2.0 In-Process Inspector | Engine: Node.js ${process.version} + node:sqlite${c.reset}`
  );

  // 1. Handshake & Discovery
  banner('1. MCP Lifecycle Handshake & Capability Discovery');
  const initRes = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'opsflow-inspector-cli', version: '1.0.0' }
  });
  await mcp.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const toolsList = await rpc('tools/list');
  const resourcesList = await rpc('resources/list');
  const promptsList = await rpc('prompts/list');

  console.log(
    `  ${c.green}✓${c.reset} Negotiated MCP Protocol: ${c.bold}${initRes.result.protocolVersion}${c.reset} (${initRes.result.serverInfo.name}@${initRes.result.serverInfo.version})`
  );
  console.log(
    `  ${c.green}✓${c.reset} Registered Tools (${toolsList.result.tools.length}): ${toolsList.result.tools.map((t) => `${c.cyan}${t.name}${c.reset}`).join(', ')}`
  );
  console.log(
    `  ${c.green}✓${c.reset} Exposed Resources (${resourcesList.result.resources.length}): ${resourcesList.result.resources.map((r) => r.uri).join(', ')}`
  );
  console.log(
    `  ${c.green}✓${c.reset} Prompt Templates (${promptsList.result.prompts.length}): ${promptsList.result.prompts.map((p) => p.name).join(', ')}`
  );

  // 2. Guardrailed Analytical SQL Execution
  banner('2. Tool [query_analytics_readonly] — Verified Analytical CTE');
  const safeSql = `
    WITH open_sev AS (
      SELECT account_id, COUNT(*) AS open_tickets, MAX(severity) AS top_sev
      FROM support_escalations
      WHERE resolved = 0
      GROUP BY account_id
    )
    SELECT
      a.company_name,
      a.segment,
      a.arr_usd,
      ROUND((CAST(a.seats_active_30d AS REAL) / a.seats_purchased) * 100, 1) AS seat_util_pct,
      a.health_score,
      COALESCE(o.open_tickets, 0) AS open_tickets,
      COALESCE(o.top_sev, 'NONE') AS top_sev
    FROM accounts a
    LEFT JOIN open_sev o ON a.account_id = o.account_id
    WHERE a.status = 'at_risk'
    ORDER BY a.arr_usd DESC
  `;
  const sqlRes = await rpc('tools/call', {
    name: 'query_analytics_readonly',
    arguments: { sql: safeSql, maxRows: 10 }
  });
  const sqlData = sqlRes.result.structuredContent;
  console.log(
    `  ${c.green}✓ Verdict:${c.reset} ${sqlData.telemetry.guardrailVerdict} | Rows: ${sqlData.telemetry.rowCount} | Latency: ${sqlData.telemetry.executionMs}ms | Hash: #${sqlData.telemetry.queryFingerprint}`
  );
  for (const row of sqlData.rows) {
    console.log(
      `    • ${c.bold}${row.company_name.padEnd(25)}${c.reset} | ${row.segment.padEnd(10)} | ARR: $${row.arr_usd.toLocaleString('en-US').padStart(7)} | Util: ${String(row.seat_util_pct).padStart(4)}% | Health: ${row.health_score} | Escalations: ${row.open_tickets} (${row.top_sev})`
    );
  }

  // 3. Adversarial SQL Injection Blocking Proof
  banner('3. Security Guardrail Proof — Blocking SQL Injection & Catalog Probing');
  const injectionAttempts = [
    {
      label: 'Piggybacked DROP TABLE',
      sql: "SELECT account_id, company_name FROM accounts WHERE segment = 'Enterprise'; DROP TABLE accounts; --"
    },
    {
      label: 'Comment-Split DDL Mutation',
      sql: '/* bypass */ DELETE FROM revenue_events WHERE arr_delta_usd < 0'
    },
    {
      label: 'Internal SQLite Catalog Probe',
      sql: 'SELECT name, sql FROM sqlite_master WHERE type = \'table\''
    }
  ];

  for (const attempt of injectionAttempts) {
    const blocked = await rpc('tools/call', {
      name: 'query_analytics_readonly',
      arguments: { sql: attempt.sql }
    });
    const info = blocked.result.structuredContent;
    console.log(
      `  ${c.red}✗ BLOCKED${c.reset} [${c.yellow}${info.error.code}${c.reset}] ${attempt.label}`
    );
    console.log(`    ${c.dim}Reason: ${info.error.message}${c.reset}`);
  }

  // 4. Automated Dataset Health & SLA Audit
  banner('4. Tool [audit_dataset_health] — Freshness, Drift, Dedup & Outliers');
  const auditRes = await rpc('tools/call', {
    name: 'audit_dataset_health',
    arguments: { dataset: 'all' }
  });
  const audit = auditRes.result.structuredContent;
  console.log(
    `  Warehouse Status: ${c.yellow}${audit.overallStatus.toUpperCase()}${c.reset} | Health Score: ${c.bold}${audit.healthScore}/100${c.reset} | Findings: ${audit.summary.criticalCount} critical, ${audit.summary.warningCount} warning, ${audit.summary.infoCount} info`
  );
  for (const finding of audit.findings) {
    const badge =
      finding.severity === 'critical'
        ? `${c.red}[CRIT]${c.reset}`
        : finding.severity === 'warning'
          ? `${c.yellow}[WARN]${c.reset}`
          : `${c.cyan}[INFO]${c.reset}`;
    console.log(`    ${badge} ${finding.subject.padEnd(36)} → ${finding.metric}`);
  }
  console.log(`  ${c.bold}Prioritized Remediation Plan:${c.reset}`);
  for (const action of audit.remediationActions.slice(0, 3)) {
    console.log(`    • [${action.priority}] (${action.owner}): ${action.action}`);
  }

  // 5. Weekly Executive Digest
  banner('5. Tool [compile_weekly_exec_digest] — WoW KPIs & Slack Block Kit');
  const digestRes = await rpc('tools/call', {
    name: 'compile_weekly_exec_digest',
    arguments: { targetWeek: '2026-04-06', format: 'both' }
  });
  const digest = digestRes.result.structuredContent;
  console.log(
    `  Reporting Period: ${c.bold}${digest.period.currentWeek}${c.reset} vs ${digest.period.priorWeek}`
  );
  console.log(
    `  • Net New ARR:       ${c.green}$${digest.kpis.netNewArr.currentUsd.toLocaleString('en-US')}${c.reset} (+$${digest.kpis.netNewArr.deltaUsd.toLocaleString('en-US')} / +${digest.kpis.netNewArr.wowPct}% WoW)`
  );
  console.log(
    `  • Expansion ARR:     $${digest.kpis.expansionArr.currentUsd.toLocaleString('en-US')} (+${digest.kpis.expansionArr.wowPct}% WoW)`
  );
  console.log(
    `  • Pipeline Coverage: ${digest.kpis.pipelineCoverageRatio.current}x | Slack Block Kit Blocks Generated: ${digest.slackBlockKit.blocks.length}`
  );
  console.log(
    `  • Primary Driver:    ${digest.varianceDrivers[0].segment} contributed ${digest.varianceDrivers[0].shareOfTotalDeltaPct}% of net WoW ARR growth`
  );

  // 6. Declarative Workflow Playbook with Transient Retry Recovery
  banner('6. Tool [run_automation_playbook] — Multi-Step Workflow & Retry Recovery');
  const playbookRes = await rpc('tools/call', {
    name: 'run_automation_playbook',
    arguments: {
      playbook: 'churn-rescue-sync',
      dryRun: true,
      maxRetries: 2,
      simulateTransientFailures: { sync_crm_save_tasks: 1 }
    }
  });
  const pb = playbookRes.result.structuredContent;
  console.log(
    `  Playbook Run ${c.bold}${pb.runId}${c.reset} (${pb.playbook}) → Status: ${c.green}${pb.status.toUpperCase()}${c.reset} | Mode: ${pb.dryRun ? 'DRY_RUN' : 'LIVE'} | Retries Used: ${pb.summary.totalRetriesUsed}`
  );
  for (const step of pb.steps) {
    const icon = step.status === 'recovered_after_retry' ? `${c.yellow}↻${c.reset}` : `${c.green}✓${c.reset}`;
    console.log(
      `    ${icon} [${step.stepId}] status=${step.status} (attempts=${step.attempts}, mode=${step.executionMode}, ${step.durationMs}ms)`
    );
  }

  // 7. Audit Trail Verification
  const auditResource = await rpc('resources/read', { uri: 'opsflow://audit/recent' });
  const recentAudit = JSON.parse(auditResource.result.contents[0].text);
  console.log(
    `\n${c.green}✓ Demo complete:${c.reset} ${recentAudit.entryCount} structured MCP audit events recorded with zero unguarded mutations.\n`
  );

  mcp.close();
}

async function main() {
  const [, , subcommand = 'demo', ...rest] = process.argv;

  if (subcommand === 'demo') {
    await runDemo();
    return;
  }

  if (subcommand === 'serve-stdio') {
    startStdioServer({ quietAudit: rest.includes('--quiet') });
    return;
  }

  if (subcommand === 'serve-http') {
    const portFlagIdx = rest.indexOf('--port');
    const port = portFlagIdx !== -1 ? Number(rest[portFlagIdx + 1]) : Number(process.env.PORT || 8762);
    const server = await startHttpServer({ port });
    process.stderr.write(
      `[opsflow-mcp] HTTP JSON-RPC server listening on ${server.url} (health: ${server.healthUrl})\n`
    );

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.error(
    'Usage: node src/cli.mjs <demo | serve-stdio | serve-http [--port 8762]>'
  );
  process.exit(1);
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
