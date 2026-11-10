import http from 'node:http';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import {
  createOpsWarehouse,
  SCHEMA_CATALOG,
  SLA_CONTRACTS,
  WAREHOUSE_REFERENCE_TIME
} from './warehouse.mjs';
import {
  executeGuardrailedQuery,
  DEFAULT_MAX_ROWS,
  HARD_MAX_ROWS_CAP
} from './sql-guardrails.mjs';
import { auditDatasetHealth } from './health-audit.mjs';
import { compileWeeklyExecDigest } from './exec-digest.mjs';
import { runAutomationPlaybook, PLAYBOOK_CATALOG } from './playbooks.mjs';
import { runEvalSuite } from './evals.mjs';
import { renderWorkbenchHtml } from './ui/workbench.mjs';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const TOOL_DEFINITIONS = [
  {
    name: 'query_analytics_readonly',
    description:
      'Execute a guardrailed read-only analytical SQL (SELECT / WITH...SELECT) query against the OpsFlow SaaS operations warehouse. Blocks DDL/DML, multi-statement injection, and internal SQLite catalogs while enforcing row caps and returning execution telemetry.',
    annotations: {
      title: 'Guardrailed Read-Only Warehouse SQL',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    },
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'Single read-only SELECT or WITH ... SELECT SQL query.'
        },
        maxRows: {
          type: 'integer',
          minimum: 1,
          maximum: HARD_MAX_ROWS_CAP,
          default: DEFAULT_MAX_ROWS,
          description: `Maximum rows to return (default ${DEFAULT_MAX_ROWS}, hard cap ${HARD_MAX_ROWS_CAP}).`
        }
      },
      required: ['sql'],
      additionalProperties: false
    }
  },
  {
    name: 'audit_dataset_health',
    description:
      'Run automated freshness SLA, null-rate threshold, duplicate business-key, and z-score statistical outlier checks across operational warehouse datasets, returning structured remediation actions.',
    annotations: {
      title: 'Automated Dataset Health & SLA Auditor',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    },
    inputSchema: {
      type: 'object',
      properties: {
        dataset: {
          type: 'string',
          enum: [
            'all',
            'accounts',
            'revenue_events',
            'pipeline_runs',
            'weekly_kpi_snapshots',
            'support_escalations'
          ],
          default: 'all',
          description: 'Target warehouse table or "all" for full warehouse audit.'
        },
        nullThresholdPct: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          default: SLA_CONTRACTS.thresholds.maxNullRatePct,
          description: 'Maximum tolerated NULL percentage before flagging schema drift.'
        },
        outlierZThreshold: {
          type: 'number',
          minimum: 1.0,
          maximum: 10.0,
          default: SLA_CONTRACTS.thresholds.outlierZScoreThreshold,
          description: 'Absolute z-score threshold for statistical anomaly detection.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'compile_weekly_exec_digest',
    description:
      'Compute week-over-week SaaS KPI deltas (Net New ARR, Expansion, Contraction/Churn, Pipeline Coverage, p95 Latency, Support SLA Breaches), rank segment variance drivers, and format Markdown + Slack Block Kit executive briefs.',
    annotations: {
      title: 'Weekly Executive KPI Digest Compiler',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    },
    inputSchema: {
      type: 'object',
      properties: {
        targetWeek: {
          type: 'string',
          default: '2026-04-06',
          description: 'ISO Monday date (YYYY-MM-DD) for the target reporting week.'
        },
        format: {
          type: 'string',
          enum: ['both', 'markdown', 'slack_blocks'],
          default: 'both',
          description: 'Desired output rendering format.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_automation_playbook',
    description:
      'Execute a declarative multi-step operational workflow playbook (churn-rescue-sync, monday-kpi-brief, pipeline-sla-triage) with bounded exponential-backoff retries, dry-run safety isolation, and an immutable step audit trail.',
    annotations: {
      title: 'Declarative Ops Playbook Runner',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        playbook: {
          type: 'string',
          description:
            'Playbook identifier: churn-rescue-sync | monday-kpi-brief | pipeline-sla-triage'
        },
        dryRun: {
          type: 'boolean',
          default: true,
          description: 'When true, simulates external CRM/Slack/PagerDuty side effects safely.'
        },
        maxRetries: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          default: 2,
          description: 'Maximum retry attempts per step on transient failure.'
        },
        params: {
          type: 'object',
          description: 'Optional playbook parameters (e.g. minArrUsd, targetWeek).'
        },
        simulateTransientFailures: {
          type: 'object',
          description: 'Optional map of stepId -> transient failure count for resilience testing.'
        }
      },
      required: ['playbook'],
      additionalProperties: false
    }
  }
];

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'opsflow://schema/catalog',
    name: 'OpsFlow Warehouse Schema & Governance Catalog',
    description:
      'Canonical table definitions, primary/business keys, PII classifications, and column descriptions for safe SQL generation.',
    mimeType: 'application/json'
  },
  {
    uri: 'opsflow://sla/latest',
    name: 'Live Operational Data SLA Contracts & Compliance Snapshot',
    description:
      'Tier-0/1/2 freshness SLA targets, null/duplicate thresholds, and live pipeline compliance status.',
    mimeType: 'application/json'
  },
  {
    uri: 'opsflow://audit/recent',
    name: 'MCP Guardrail & Tool Execution Audit Trail',
    description:
      'Structured ring-buffer of recent JSON-RPC tool invocations, SQL guardrail verdicts, and execution latencies.',
    mimeType: 'application/json'
  }
];

export const PROMPT_DEFINITIONS = [
  {
    name: 'executive-variance-brief',
    description:
      'Structured workflow prompt instructing an AI agent to gate on data health, compute WoW KPI variance, and verify segment drivers via read-only SQL.',
    arguments: [
      {
        name: 'target_week',
        description: 'ISO Monday week start (e.g., 2026-04-06)',
        required: false
      },
      {
        name: 'focus_segment',
        description: 'Optional segment to drill into (Enterprise, Mid-Market, SMB)',
        required: false
      }
    ]
  },
  {
    name: 'incident-root-cause-triage',
    description:
      'Guided runbook prompt for triaging a degraded or failed warehouse ingestion pipeline and isolating downstream ARR/metric impact.',
    arguments: [
      {
        name: 'pipeline_name',
        description: 'Name of the pipeline breaching SLA (e.g., revops_attribution_hourly)',
        required: true
      }
    ]
  },
  {
    name: 'churn-save-plan',
    description:
      'Generates an evidence-backed renewal rescue plan for high-ARR at-risk accounts with open support escalations.',
    arguments: [
      {
        name: 'min_arr_usd',
        description: 'Minimum ARR filter in USD (default 50000)',
        required: false
      }
    ]
  }
];

function jsonRpcSuccess(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function jsonRpcError(id, code, message, data = undefined) {
  const errObj = { code, message };
  if (data !== undefined) {
    errObj.data = data;
  }
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: errObj
  };
}

export function createOpsFlowMcpServer({
  db = createOpsWarehouse(),
  maxCallsPerMinute = 60,
  maxAuditEntries = 200,
  onAuditLog = null
} = {}) {
  const auditLog = [];
  const callTimestamps = [];

  function recordAudit(entry) {
    const enriched = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    auditLog.push(enriched);
    if (auditLog.length > maxAuditEntries) {
      auditLog.shift();
    }
    if (typeof onAuditLog === 'function') {
      onAuditLog(enriched);
    }
    return enriched;
  }

  function checkRateLimit() {
    const now = Date.now();
    const windowStart = now - 60_000;
    while (callTimestamps.length > 0 && callTimestamps[0] < windowStart) {
      callTimestamps.shift();
    }
    if (callTimestamps.length >= maxCallsPerMinute) {
      return false;
    }
    callTimestamps.push(now);
    return true;
  }

  function readResourcePayload(uri) {
    if (uri === 'opsflow://schema/catalog') {
      return SCHEMA_CATALOG;
    }
    if (uri === 'opsflow://sla/latest') {
      const latestPipelines = db.prepare(`
        WITH ranked AS (
          SELECT
            pipeline_name,
            domain,
            run_id,
            completed_at,
            freshness_lag_min,
            sla_freshness_max_min,
            status,
            ROW_NUMBER() OVER (PARTITION BY pipeline_name ORDER BY completed_at DESC) AS rn
          FROM pipeline_runs
        )
        SELECT
          pipeline_name,
          domain,
          run_id,
          completed_at,
          freshness_lag_min,
          sla_freshness_max_min,
          status,
          CASE
            WHEN status = 'succeeded' AND freshness_lag_min <= sla_freshness_max_min THEN 1
            ELSE 0
          END AS within_sla
        FROM ranked
        WHERE rn = 1
        ORDER BY freshness_lag_min DESC
      `).all().map((r) => ({ ...r, within_sla: Boolean(r.within_sla) }));

      return {
        referenceTimestamp: WAREHOUSE_REFERENCE_TIME,
        contracts: SLA_CONTRACTS,
        liveCompliance: {
          totalPipelines: latestPipelines.length,
          compliantPipelines: latestPipelines.filter((p) => p.within_sla).length,
          breachedPipelines: latestPipelines.filter((p) => !p.within_sla).length,
          pipelines: latestPipelines
        }
      };
    }
    if (uri === 'opsflow://audit/recent') {
      return {
        entryCount: auditLog.length,
        entries: auditLog.slice(-50)
      };
    }
    return null;
  }

  function buildPromptMessages(name, args = {}) {
    if (name === 'executive-variance-brief') {
      const targetWeek = args.target_week ?? '2026-04-06';
      const focusSegment = args.focus_segment ?? 'Enterprise';
      return {
        description: `Executive WoW KPI brief for week ${targetWeek} with ${focusSegment} drill-down`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Prepare the verified Monday Executive Operations Brief for week_start='${targetWeek}' with a deep-dive on '${focusSegment}'.`,
                'Follow this deterministic verification sequence:',
                '1. Read `opsflow://schema/catalog` and call `audit_dataset_health` (`dataset: "all"`) to verify warehouse SLA compliance.',
                `2. Call \`compile_weekly_exec_digest\` (\`targetWeek: "${targetWeek}", format: "both"\`).`,
                `3. Call \`query_analytics_readonly\` to cross-check account-level revenue events and open support escalations in '${focusSegment}'.`,
                '4. Explicitly surface any critical data caveats (duplicate keys or stale pipelines) before presenting headline ARR metrics.'
              ].join('\n')
            }
          }
        ]
      };
    }

    if (name === 'incident-root-cause-triage') {
      if (!args.pipeline_name) {
        return { error: "Missing required prompt argument: 'pipeline_name'" };
      }
      return {
        description: `Root-cause triage workflow for pipeline '${args.pipeline_name}'`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Investigate SLA degradation on pipeline '${args.pipeline_name}'.`,
                '1. Read `opsflow://sla/latest` to confirm contracted freshness targets and tier.',
                `2. Use \`query_analytics_readonly\` to inspect trailing run durations and status history for '${args.pipeline_name}' in \`pipeline_runs\`.`,
                '3. Run `audit_dataset_health` to identify correlated null-rate spikes or duplicate idempotency keys.',
                '4. Execute `run_automation_playbook` with `playbook: "pipeline-sla-triage"` and `dryRun: true` to preview quarantine and paging actions.'
              ].join('\n')
            }
          }
        ]
      };
    }

    if (name === 'churn-save-plan') {
      const minArr = args.min_arr_usd ?? '50000';
      return {
        description: `Renewal rescue plan for at-risk accounts >= $${minArr} ARR`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Build an executive renewal rescue plan for at-risk accounts with ARR >= $${minArr}.`,
                '1. Call `query_analytics_readonly` joining `accounts` and `support_escalations` to quantify seat utilization and unresolved SEV-1/2 tickets.',
                `2. Run \`run_automation_playbook\` (\`playbook: "churn-rescue-sync", dryRun: true, params: { minArrUsd: ${Number(minArr) || 50000} }\`) to generate prioritized CRM interventions.`
              ].join('\n')
            }
          }
        ]
      };
    }

    return null;
  }

  async function executeToolCall(toolName, rawArgs, requestId) {
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
    const t0 = performance.now();

    if (toolName === 'query_analytics_readonly') {
      if (typeof args.sql !== 'string') {
        throw { code: -32602, message: "Invalid params: 'sql' (string) is required." };
      }
      const res = executeGuardrailedQuery(db, {
        sql: args.sql,
        maxRows: args.maxRows
      });
      const durationMs = Number((performance.now() - t0).toFixed(3));
      recordAudit({
        requestId,
        method: 'tools/call',
        tool: toolName,
        verdict: res.telemetry.guardrailVerdict,
        queryFingerprint: res.telemetry.queryFingerprint,
        rowCount: res.telemetry.rowCount,
        durationMs
      });
      return {
        isError: !res.ok,
        payload: res
      };
    }

    if (toolName === 'audit_dataset_health') {
      const res = auditDatasetHealth(db, args);
      const durationMs = Number((performance.now() - t0).toFixed(3));
      recordAudit({
        requestId,
        method: 'tools/call',
        tool: toolName,
        verdict: `AUDIT_${res.overallStatus.toUpperCase()}`,
        healthScore: res.healthScore,
        durationMs
      });
      return {
        isError: false,
        payload: res
      };
    }

    if (toolName === 'compile_weekly_exec_digest') {
      const res = compileWeeklyExecDigest(db, args);
      const durationMs = Number((performance.now() - t0).toFixed(3));
      recordAudit({
        requestId,
        method: 'tools/call',
        tool: toolName,
        verdict: 'DIGEST_COMPILED',
        targetWeek: res.period.currentWeek,
        durationMs
      });
      return {
        isError: false,
        payload: res
      };
    }

    if (toolName === 'run_automation_playbook') {
      if (typeof args.playbook !== 'string') {
        throw {
          code: -32602,
          message: `Invalid params: 'playbook' is required (${Object.keys(PLAYBOOK_CATALOG).join(', ')}).`
        };
      }
      const res = await runAutomationPlaybook(db, args);
      const durationMs = Number((performance.now() - t0).toFixed(3));
      recordAudit({
        requestId,
        method: 'tools/call',
        tool: toolName,
        verdict: res.status === 'succeeded' ? 'PLAYBOOK_SUCCEEDED' : 'PLAYBOOK_FAILED',
        playbook: res.playbook,
        dryRun: res.dryRun,
        retriesUsed: res.summary.totalRetriesUsed,
        durationMs
      });
      return {
        isError: res.status !== 'succeeded',
        payload: res
      };
    }

    throw {
      code: -32602,
      message: `Unknown tool '${toolName}'. Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`
    };
  }

  async function handleRequest(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return jsonRpcError(null, -32600, 'Invalid Request: expected JSON-RPC 2.0 object.');
    }

    const { jsonrpc, id, method, params } = message;
    const isNotification = id === undefined;

    if (jsonrpc !== '2.0' || typeof method !== 'string' || !method.trim()) {
      return jsonRpcError(id ?? null, -32600, 'Invalid Request: jsonrpc="2.0" and string method are required.');
    }

    // Notifications produce no response in JSON-RPC 2.0
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      recordAudit({ requestId: null, method, verdict: 'NOTIFICATION_ACK', durationMs: 0 });
      return null;
    }

    if (isNotification) {
      return null;
    }

    try {
      if (method === 'initialize') {
        const clientVersion = params?.protocolVersion;
        const negotiatedVersion =
          typeof clientVersion === 'string' && clientVersion.startsWith('202')
            ? clientVersion
            : MCP_PROTOCOL_VERSION;

        recordAudit({
          requestId: id,
          method: 'initialize',
          verdict: 'SESSION_INITIALIZED',
          clientName: params?.clientInfo?.name ?? 'unknown',
          durationMs: 0
        });

        return jsonRpcSuccess(id, {
          protocolVersion: negotiatedVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          },
          serverInfo: {
            name: 'opsflow-mcp',
            version: '1.0.0'
          },
          instructions:
            'OpsFlow MCP Server: Read opsflow://schema/catalog before writing SQL, gate executive reports on audit_dataset_health, and default run_automation_playbook to dryRun=true until verified.'
        });
      }

      if (method === 'ping') {
        return jsonRpcSuccess(id, {});
      }

      if (method === 'tools/list') {
        return jsonRpcSuccess(id, { tools: TOOL_DEFINITIONS });
      }

      if (method === 'tools/call') {
        if (!checkRateLimit()) {
          recordAudit({
            requestId: id,
            method: 'tools/call',
            tool: params?.name ?? 'unknown',
            verdict: 'RATE_LIMITED',
            durationMs: 0
          });
          return jsonRpcError(
            id,
            -32029,
            `Rate limit exceeded (${maxCallsPerMinute} tool calls per 60s window).`
          );
        }

        const toolName = params?.name;
        if (typeof toolName !== 'string' || !toolName.trim()) {
          return jsonRpcError(id, -32602, "Invalid params: 'name' (tool name) is required.");
        }

        try {
          const { isError, payload } = await executeToolCall(toolName, params?.arguments, id);
          return jsonRpcSuccess(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(payload)
              }
            ],
            structuredContent: payload,
            isError
          });
        } catch (toolErr) {
          if (toolErr && typeof toolErr.code === 'number') {
            return jsonRpcError(id, toolErr.code, toolErr.message);
          }
          const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          return jsonRpcSuccess(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: msg }, null, 2)
              }
            ],
            structuredContent: { error: msg },
            isError: true
          });
        }
      }

      if (method === 'resources/list') {
        return jsonRpcSuccess(id, { resources: RESOURCE_DEFINITIONS });
      }

      if (method === 'resources/read') {
        const uri = params?.uri;
        if (typeof uri !== 'string' || !uri.trim()) {
          return jsonRpcError(id, -32602, "Invalid params: 'uri' is required.");
        }
        const payload = readResourcePayload(uri);
        if (!payload) {
          return jsonRpcError(id, -32602, `Resource not found: '${uri}'`);
        }
        recordAudit({ requestId: id, method: 'resources/read', uri, verdict: 'READ_OK', durationMs: 0 });
        return jsonRpcSuccess(id, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(payload, null, 2)
            }
          ]
        });
      }

      if (method === 'prompts/list') {
        return jsonRpcSuccess(id, { prompts: PROMPT_DEFINITIONS });
      }

      if (method === 'prompts/get') {
        const name = params?.name;
        if (typeof name !== 'string' || !name.trim()) {
          return jsonRpcError(id, -32602, "Invalid params: 'name' is required.");
        }
        const built = buildPromptMessages(name, params?.arguments ?? {});
        if (!built) {
          return jsonRpcError(id, -32602, `Prompt template not found: '${name}'`);
        }
        if (built.error) {
          return jsonRpcError(id, -32602, built.error);
        }
        return jsonRpcSuccess(id, built);
      }

      return jsonRpcError(id, -32601, `Method not found: '${method}'`);
    } catch (err) {
      return jsonRpcError(
        id,
        -32603,
        `Internal MCP server error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async function handleRawPayload(rawText) {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonRpcError(null, -32700, 'Parse error: invalid JSON payload.');
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return jsonRpcError(null, -32600, 'Invalid Request: empty batch array.');
      }
      const responses = [];
      for (const item of parsed) {
        const res = await handleRequest(item);
        if (res !== null) responses.push(res);
      }
      return responses.length > 0 ? responses : null;
    }

    return handleRequest(parsed);
  }

  function close() {
    try {
      db.close();
    } catch {
      // already closed
    }
  }

  return {
    db,
    auditLog,
    handleRequest,
    handleRawPayload,
    close
  };
}

// Writes audit logs to stderr so stdout carries only newline-delimited JSON-RPC frames.
export function startStdioServer({
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  quietAudit = false
} = {}) {
  const mcp = createOpsFlowMcpServer({
    onAuditLog: (entry) => {
      if (!quietAudit) {
        errorOutput.write(`[opsflow-audit] ${JSON.stringify(entry)}\n`);
      }
    }
  });

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const response = await mcp.handleRawPayload(trimmed);
    if (response !== null) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  });

  rl.on('close', () => {
    mcp.close();
  });

  return { mcp, rl };
}

export function startHttpServer({
  host = '127.0.0.1',
  port = 8762,
  maxCallsPerMinute = 60
} = {}) {
  const mcp = createOpsFlowMcpServer({ maxCallsPerMinute });
  const workbenchHtml = renderWorkbenchHtml();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(workbenchHtml)
      });
      res.end(workbenchHtml);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/evals') {
      try {
        const report = await runEvalSuite();
        const body = JSON.stringify(report);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        });
        res.end(body);
      } catch (err) {
        const errBody = JSON.stringify({
          error: err instanceof Error ? err.message : String(err)
        });
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(errBody);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        server: 'opsflow-mcp',
        protocolVersion: MCP_PROTOCOL_VERSION,
        tools: TOOL_DEFINITIONS.length,
        resources: RESOURCE_DEFINITIONS.length,
        prompts: PROMPT_DEFINITIONS.length
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/mcp') {
      const chunks = [];
      let totalBytes = 0;
      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes <= 1_048_576) {
          chunks.push(chunk);
        }
      });

      req.on('end', async () => {
        if (totalBytes > 1_048_576) {
          const errBody = JSON.stringify(jsonRpcError(null, -32600, 'Payload too large (>1MB).'));
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(errBody);
          return;
        }

        const raw = Buffer.concat(chunks).toString('utf8');
        const rpcResponse = await mcp.handleRawPayload(raw);

        if (rpcResponse === null) {
          res.writeHead(202);
          res.end();
          return;
        }

        const out = JSON.stringify(rpcResponse);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(out)
        });
        res.end(out);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ error: 'Not Found. Use GET /, GET /evals, GET /health, or POST /mcp.' })
    );
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        mcp,
        httpServer,
        workbenchUrl: `http://${host}:${boundPort}/`,
        evalsUrl: `http://${host}:${boundPort}/evals`,
        url: `http://${host}:${boundPort}/mcp`,
        healthUrl: `http://${host}:${boundPort}/health`,
        close: () =>
          new Promise((resClose) => {
            httpServer.close(() => {
              mcp.close();
              resClose();
            });
          })
      });
    });
  });
}
