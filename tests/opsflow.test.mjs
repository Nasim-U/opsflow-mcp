import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOpsWarehouse } from '../src/warehouse.mjs';
import {
  createOpsFlowMcpServer,
  startHttpServer,
  startStdioServer
} from '../src/mcp-server.mjs';
import { runEvalSuite } from '../src/evals.mjs';
import { runDemo } from '../src/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

describe('OpsFlow MCP Server: protocol, guardrails, workbench, and evals', () => {
  const openServers = [];

  afterEach(async () => {
    while (openServers.length > 0) {
      const srv = openServers.pop();
      await srv.close();
    }
  });

  it('completes MCP initialize handshake, ping, and capability discovery', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const init = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'node-test-runner', version: '1.0.0' }
      }
    });

    assert.equal(init.jsonrpc, '2.0');
    assert.equal(init.id, 1);
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.equal(init.result.serverInfo.name, 'opsflow-mcp');
    assert.ok(init.result.capabilities.tools);
    assert.ok(init.result.capabilities.resources);
    assert.ok(init.result.capabilities.prompts);

    const notif = await mcp.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    assert.equal(notif, null);

    const ping = await mcp.handleRequest({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.deepEqual(ping.result, {});

    const tools = await mcp.handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    assert.equal(tools.result.tools.length, 4);
    assert.deepEqual(
      tools.result.tools.map((t) => t.name),
      [
        'query_analytics_readonly',
        'audit_dataset_health',
        'compile_weekly_exec_digest',
        'run_automation_playbook'
      ]
    );
  });

  it('handles JSON-RPC parse errors, invalid requests, unknown methods, and batch arrays', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const parseErr = await mcp.handleRawPayload('{not valid json');
    assert.equal(parseErr.error.code, -32700);

    const emptyBatch = await mcp.handleRawPayload('[]');
    assert.equal(emptyBatch.error.code, -32600);

    const unknownMethod = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'unknown/endpoint'
    });
    assert.equal(unknownMethod.error.code, -32601);

    const batchRes = await mcp.handleRawPayload(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'resources/list' }
      ])
    );
    assert.equal(batchRes.length, 2);
    assert.equal(batchRes[0].id, 'a');
    assert.equal(batchRes[1].id, 'b');
    assert.equal(batchRes[1].result.resources.length, 3);
  });

  it('enforces sliding-window rate limits across tool invocations', async () => {
    const mcp = createOpsFlowMcpServer({ maxCallsPerMinute: 2 });
    openServers.push(mcp);

    const callTool = (id) =>
      mcp.handleRequest({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: 'query_analytics_readonly',
          arguments: { sql: 'SELECT COUNT(*) AS cnt FROM accounts' }
        }
      });

    const first = await callTool(1);
    const second = await callTool(2);
    const third = await callTool(3);

    assert.equal(first.result.isError, false);
    assert.equal(second.result.isError, false);
    assert.equal(third.error.code, -32029);
    assert.match(third.error.message, /Rate limit exceeded/);
  });

  it('executes valid SELECT and CTE queries while preserving string literals with semicolons and keywords', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const res = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'query_analytics_readonly',
        arguments: {
          sql: `
            WITH enterprise_pool AS (
              SELECT account_id, company_name, arr_usd
              FROM accounts
              WHERE segment = 'Enterprise'
            )
            SELECT
              company_name,
              arr_usd,
              'DROP TABLE; -- safe literal' AS note
            FROM enterprise_pool
            ORDER BY arr_usd DESC;
          `,
          maxRows: 10
        }
      }
    });

    assert.equal(res.result.isError, false);
    const payload = res.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.rows.length, 4);
    assert.equal(payload.rows[0].company_name, 'Aegis BioSystems');
    assert.equal(payload.rows[0].note, 'DROP TABLE; -- safe literal');
    assert.equal(payload.telemetry.truncated, false);
    assert.equal(payload.telemetry.guardrailVerdict, 'ALLOWED_READONLY');
    assert.ok(payload.telemetry.referencedTables.includes('accounts'));
  });

  it('enforces row limit truncation deterministically via iterator stepping', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const res = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'query_analytics_readonly',
        arguments: {
          sql: 'SELECT account_id, company_name FROM accounts ORDER BY account_id ASC',
          maxRows: 3
        }
      }
    });

    const payload = res.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.rows.length, 3);
    assert.equal(payload.telemetry.effectiveMaxRows, 3);
    assert.equal(payload.telemetry.truncated, true);
  });

  it('blocks SQL injection, comment-split keywords, DDL/DML mutations, system catalogs, and engine writes', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const attackVectors = [
      {
        sql: 'SELECT * FROM accounts; DROP TABLE accounts; --',
        expectedCode: 'MULTI_STATEMENT_BLOCKED'
      },
      {
        sql: "DELETE FROM accounts WHERE status = 'churned'",
        expectedCode: 'NON_SELECT_ROOT_BLOCKED'
      },
      {
        sql: 'WITH evil AS (SELECT 1) DROP TABLE accounts',
        expectedCode: 'FORBIDDEN_SQL_KEYWORD'
      },
      {
        sql: 'WITH evil AS (SELECT 1) DR/**/OP TABLE accounts',
        expectedCode: 'FORBIDDEN_SQL_KEYWORD'
      },
      {
        sql: 'WITH evil AS (VALUES (1)) VALUES (2)',
        expectedCode: 'CTE_WITHOUT_SELECT_BLOCKED'
      },
      {
        sql: 'SELECT * FROM accounts WHERE 1=1 UNION SELECT 1,2,3,4,5,6,7,8,9,10,11,12,13 FROM sqlite_master',
        expectedCode: 'SYSTEM_CATALOG_BLOCKED'
      },
      {
        sql: 'SELECT name FROM sqlite_/**/master',
        expectedCode: 'SYSTEM_CATALOG_BLOCKED'
      },
      {
        sql: 'PRAGMA query_only = OFF',
        expectedCode: 'NON_SELECT_ROOT_BLOCKED'
      },
      {
        sql: 'SELECT /* unclosed comment * FROM accounts',
        expectedCode: 'MALFORMED_SQL_COMMENT'
      }
    ];

    for (const vector of attackVectors) {
      const res = await mcp.handleRequest({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'query_analytics_readonly',
          arguments: { sql: vector.sql }
        }
      });
      assert.equal(res.result.isError, true, `Expected vector to fail: ${vector.sql}`);
      assert.equal(res.result.structuredContent.error.code, vector.expectedCode);
    }

    const db = createOpsWarehouse({ lockReadOnly: true });
    assert.throws(() => {
      db.exec("INSERT INTO accounts VALUES ('x','x','SMB','NA',1,12,1,1,50,'2026-12-01','x','active','2026-04-13')");
    }, /readonly database/i);
    db.close();
  });

  it('audits dataset health across freshness SLAs, NULL drift, duplicate keys, and z-score outliers', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const res = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'audit_dataset_health',
        arguments: { dataset: 'all' }
      }
    });

    assert.equal(res.result.isError, false);
    const audit = res.result.structuredContent;
    assert.equal(audit.overallStatus, 'critical');
    assert.equal(audit.summary.criticalCount, 2);
    assert.equal(audit.summary.executiveGateReady, false);

    const dupFinding = audit.findings.find((f) => f.checkType === 'duplicate_business_key');
    assert.ok(dupFinding);
    assert.equal(dupFinding.details.duplicateKeyCount, 2);
    assert.equal(dupFinding.details.overstatedArrUsd, 21600);

    const freshnessFinding = audit.findings.find(
      (f) => f.checkType === 'freshness_sla' && f.severity === 'critical'
    );
    assert.equal(freshnessFinding.subject, 'revops_attribution_hourly');
    assert.ok(audit.remediationActions.some((a) => a.priority === 'P0'));
  });

  it('compiles weekly executive KPI digest in Markdown and Slack Block Kit formats', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const res = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'compile_weekly_exec_digest',
        arguments: { targetWeek: '2026-04-06', format: 'both' }
      }
    });

    assert.equal(res.result.isError, false);
    const digest = res.result.structuredContent;
    assert.equal(digest.period.currentWeek, '2026-04-06');
    assert.equal(digest.period.priorWeek, '2026-03-30');
    assert.equal(digest.kpis.netNewArr.currentUsd, 290400);
    assert.equal(digest.kpis.netNewArr.priorUsd, 227500);
    assert.equal(digest.kpis.netNewArr.deltaUsd, 62900);
    assert.equal(digest.kpis.netNewArr.wowPct, 27.65);
    assert.equal(digest.varianceDrivers[0].segment, 'Enterprise');
    assert.equal(digest.renewalRiskWatchlist.accountCount, 3);
    assert.equal(digest.renewalRiskWatchlist.totalAtRiskArrUsd, 490800);
    assert.match(digest.markdown, /Weekly Executive Operations Digest/);
    assert.equal(digest.slackBlockKit.blocks[0].type, 'header');
  });

  it('executes automation playbooks with dry-run isolation, retry recovery, and retry exhaustion', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const recovered = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: {
        name: 'run_automation_playbook',
        arguments: {
          playbook: 'churn-rescue-sync',
          dryRun: true,
          maxRetries: 2,
          simulateTransientFailures: { sync_crm_save_tasks: 2 }
        }
      }
    });

    assert.equal(recovered.result.isError, false);
    const recData = recovered.result.structuredContent;
    assert.equal(recData.status, 'succeeded');
    assert.equal(recData.summary.totalRetriesUsed, 2);
    assert.equal(recData.summary.sideEffectsCommitted, 0);
    const crmStep = recData.steps.find((s) => s.stepId === 'sync_crm_save_tasks');
    assert.equal(crmStep.status, 'recovered_after_retry');
    assert.equal(crmStep.attempts, 3);

    const liveBrief = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'run_automation_playbook',
        arguments: {
          playbook: 'Monday-kpi-brief',
          dryRun: false
        }
      }
    });
    assert.equal(liveBrief.result.isError, false);
    assert.equal(liveBrief.result.structuredContent.playbook, 'monday-kpi-brief');
    assert.equal(liveBrief.result.structuredContent.summary.sideEffectsCommitted, 1);

    const exhausted = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 52,
      method: 'tools/call',
      params: {
        name: 'run_automation_playbook',
        arguments: {
          playbook: 'pipeline-sla-triage',
          dryRun: true,
          maxRetries: 1,
          simulateTransientFailures: { dispatch_pager_incident: 3 }
        }
      }
    });
    assert.equal(exhausted.result.isError, true);
    assert.equal(exhausted.result.structuredContent.status, 'failed');
    assert.equal(exhausted.result.structuredContent.failedStepId, 'dispatch_pager_incident');
  });

  it('reads MCP resources and resolves parameterized prompt templates', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const catalogRes = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 60,
      method: 'resources/read',
      params: { uri: 'opsflow://schema/catalog' }
    });
    const catalog = JSON.parse(catalogRes.result.contents[0].text);
    assert.equal(catalog.tables.length, 5);

    const slaRes = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 61,
      method: 'resources/read',
      params: { uri: 'opsflow://sla/latest' }
    });
    const sla = JSON.parse(slaRes.result.contents[0].text);
    assert.equal(sla.liveCompliance.totalPipelines, 5);
    assert.equal(sla.liveCompliance.breachedPipelines, 2);

    const promptOk = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 62,
      method: 'prompts/get',
      params: {
        name: 'incident-root-cause-triage',
        arguments: { pipeline_name: 'revops_attribution_hourly' }
      }
    });
    assert.match(promptOk.result.messages[0].content.text, /revops_attribution_hourly/);

    const promptMissingArg = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 63,
      method: 'prompts/get',
      params: { name: 'incident-root-cause-triage', arguments: {} }
    });
    assert.equal(promptMissingArg.error.code, -32602);
  });

  it('passes all 18 deterministic evaluation benchmark cases with 0% false positives', async () => {
    const report = await runEvalSuite();
    assert.equal(report.summary.totalCases, 18);
    assert.equal(report.summary.passedCases, 18);
    assert.equal(report.summary.failedCases, 0);
    assert.equal(report.summary.scoreLabel, '18/18');
    assert.equal(report.summary.falsePositiveRatePct, 0);
    assert.equal(report.summary.attackBlockRatePct, 100);
    assert.equal(report.categories.length, 4);
  });

  it('serves workbench HTML (GET /), evals JSON (GET /evals), MCP RPC (POST /mcp) on port 8762, and stdio cleanly', async () => {
    const httpSrv = await startHttpServer({ host: '127.0.0.1', port: 8762 });
    openServers.push(httpSrv);

    const uiResp = await fetch(httpSrv.workbenchUrl);
    assert.equal(uiResp.status, 200);
    assert.match(uiResp.headers.get('content-type') ?? '', /text\/html/);
    const uiHtml = await uiResp.text();
    assert.match(uiHtml, /opsflow-mcp/);
    assert.match(uiHtml, /query_analytics_readonly/);
    assert.match(uiHtml, /Evaluation benchmark/);
    assert.equal(uiHtml.includes('\u2014'), false, 'Workbench HTML must not contain em dashes');
    assert.equal(uiHtml.includes('\u00b7'), false, 'Workbench HTML must not contain middle dots');
    assert.equal(uiHtml.includes('\u2192'), false, 'Workbench HTML must not contain right arrows');

    const evalsResp = await fetch(httpSrv.evalsUrl);
    assert.equal(evalsResp.status, 200);
    const evalsJson = await evalsResp.json();
    assert.equal(evalsJson.summary.totalCases, 18);
    assert.equal(evalsJson.summary.passedCases, 18);
    assert.equal(evalsJson.summary.falsePositiveRatePct, 0);

    const healthResp = await fetch(httpSrv.healthUrl);
    assert.equal(healthResp.status, 200);
    const healthJson = await healthResp.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.tools, 4);

    const rpcResp = await fetch(httpSrv.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 701,
        method: 'tools/call',
        params: {
          name: 'query_analytics_readonly',
          arguments: { sql: 'SELECT COUNT(*) AS account_count FROM accounts' }
        }
      })
    });
    assert.equal(rpcResp.status, 200);
    const rpcJson = await rpcResp.json();
    assert.equal(rpcJson.result.structuredContent.rows[0].account_count, 12);

    await httpSrv.close();
    openServers.pop();

    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();

    const stdoutChunks = [];
    const stderrChunks = [];
    output.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
    errorOutput.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));

    const stdio = startStdioServer({ input, output, errorOutput });
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 801,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' }
      })}\n`
    );

    await new Promise((r) => setTimeout(r, 40));
    stdio.rl.close();
    stdio.mcp.close();

    const stdoutLine = stdoutChunks.join('').trim();
    const parsedOut = JSON.parse(stdoutLine);
    assert.equal(parsedOut.id, 801);
    assert.equal(parsedOut.result.serverInfo.name, 'opsflow-mcp');
    assert.match(stderrChunks.join(''), /\[opsflow-audit\]/);
  });

  it('ships valid Agent Skill definitions, clean prose without em dashes, and real PNG screenshots', async () => {
    const readme = await fs.readFile(path.join(repoRoot, 'README.md'), 'utf8');
    const analystSkill = await fs.readFile(
      path.join(repoRoot, 'skills', 'warehouse-analyst', 'SKILL.md'),
      'utf8'
    );
    const digestSkill = await fs.readFile(
      path.join(repoRoot, 'skills', 'weekly-ops-digest', 'SKILL.md'),
      'utf8'
    );

    assert.match(readme, /^# opsflow-mcp/m);
    assert.match(readme, /docs\/mcp-inspector\.png/);
    assert.match(readme, /docs\/eval-suite\.png/);
    assert.equal(readme.includes('\u2014'), false, 'README.md must not contain em dashes');
    assert.equal(analystSkill.includes('\u2014'), false, 'warehouse-analyst SKILL.md must not contain em dashes');
    assert.equal(digestSkill.includes('\u2014'), false, 'weekly-ops-digest SKILL.md must not contain em dashes');

    assert.match(analystSkill, /^---\r?\nname: warehouse-analyst/m);
    assert.match(analystSkill, /query_analytics_readonly/);
    assert.match(digestSkill, /^---\r?\nname: weekly-ops-digest/m);
    assert.match(digestSkill, /run_automation_playbook/);

    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const fileName of ['mcp-inspector.png', 'eval-suite.png']) {
      const buf = await fs.readFile(path.join(repoRoot, 'docs', fileName));
      assert.ok(buf.length > 50_000, `${fileName} should be a full Retina screenshot (>50KB)`);
      assert.deepEqual(buf.subarray(0, 8), pngSignature, `${fileName} must have valid PNG header`);
    }
  });

  it('supports scoped single-table dataset audits and rejects unknown datasets cleanly', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const scoped = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 90,
      method: 'tools/call',
      params: {
        name: 'audit_dataset_health',
        arguments: { dataset: 'accounts', nullThresholdPct: 5 }
      }
    });
    assert.equal(scoped.result.isError, false);
    assert.deepEqual(scoped.result.structuredContent.inspectedDatasets, ['accounts']);
    assert.equal(scoped.result.structuredContent.overallStatus, 'degraded');

    const badDataset = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 91,
      method: 'tools/call',
      params: {
        name: 'audit_dataset_health',
        arguments: { dataset: 'nonexistent_table' }
      }
    });
    assert.equal(badDataset.result.isError, true);
    assert.match(badDataset.result.structuredContent.error, /Unsupported dataset/);
  });

  it('supports format-specific executive digest rendering (markdown-only and slack_blocks-only)', async () => {
    const mcp = createOpsFlowMcpServer();
    openServers.push(mcp);

    const mdOnly = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 92,
      method: 'tools/call',
      params: {
        name: 'compile_weekly_exec_digest',
        arguments: { targetWeek: '2026-04-06', format: 'markdown' }
      }
    });
    assert.equal(mdOnly.result.isError, false);
    assert.equal(typeof mdOnly.result.structuredContent.markdown, 'string');
    assert.equal(mdOnly.result.structuredContent.slackBlockKit, undefined);

    const blocksOnly = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 93,
      method: 'tools/call',
      params: {
        name: 'compile_weekly_exec_digest',
        arguments: { targetWeek: '2026-03-30', format: 'slack_blocks' }
      }
    });
    assert.equal(blocksOnly.result.isError, false);
    assert.equal(blocksOnly.result.structuredContent.markdown, undefined);
    assert.ok(Array.isArray(blocksOnly.result.structuredContent.slackBlockKit.blocks));
  });

  it('runs the end-to-end CLI protocol trace without errors', async () => {
    const originalLog = console.log;
    const captured = [];
    console.log = (...args) => captured.push(args.join(' '));
    try {
      await runDemo();
    } finally {
      console.log = originalLog;
    }
    const fullOutput = captured.join('\n');
    assert.match(fullOutput, /OpsFlow MCP v1\.0\.0/);
    assert.match(fullOutput, /MULTI_STATEMENT_BLOCKED/);
    assert.match(fullOutput, /Demo complete:/);
  });
});
