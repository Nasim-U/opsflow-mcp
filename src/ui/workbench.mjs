export function renderWorkbenchHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>opsflow-mcp | Protocol Inspector and Evaluation Workbench</title>
  <style>
    :root {
      --bg-frame: #F3F2EE;
      --bg-panel: #FFFFFF;
      --bg-subtle: #FAF9F6;
      --bg-hover: #F5F4F0;
      --border: #D8D5CE;
      --border-strong: #BEB9AF;
      --ink: #191816;
      --ink-secondary: #5C5952;
      --pass-ink: #166534;
      --pass-bg: #EFFAF3;
      --pass-border: #B8DEC5;
      --block-ink: #9A3412;
      --block-bg: #FDF4EE;
      --block-border: #F2C6A8;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'SFMono-Regular', monospace;
      --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
      background: var(--bg-frame);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.42;
      -webkit-font-smoothing: antialiased;
    }

    .app-shell {
      height: 100vh;
      max-width: 1560px;
      margin: 0 auto;
      padding: 10px 12px;
      display: grid;
      grid-template-rows: 40px 1fr;
      gap: 10px;
    }

    .topbar {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .brand-name {
      font-family: var(--font-mono);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--ink);
      letter-spacing: -0.01em;
    }

    .v-rule {
      width: 1px;
      height: 15px;
      background: var(--border);
      flex-shrink: 0;
    }

    .topbar-subtitle {
      color: var(--ink-secondary);
      font-size: 12.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .mono-tag {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--ink-secondary);
    }

    .status-pill {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 500;
      padding: 1.5px 7px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
    }

    .status-pill.pass {
      color: var(--pass-ink);
      background: var(--pass-bg);
      border: 1px solid var(--pass-border);
    }

    .status-pill.block {
      color: var(--block-ink);
      background: var(--block-bg);
      border: 1px solid var(--block-border);
    }

    .workbench-grid {
      display: grid;
      grid-template-columns: 368px 1fr;
      gap: 10px;
      min-height: 0;
    }

    .panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 5px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .pane-header {
      height: 36px;
      padding: 0 13px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .pane-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--ink);
    }

    .pane-meta {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--ink-secondary);
    }

    .composer-body {
      padding: 11px 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .field-group.grow {
      flex: 1;
      min-height: 180px;
    }

    .field-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    label {
      font-size: 12px;
      font-weight: 500;
      color: var(--ink);
    }

    .field-hint {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--ink-secondary);
    }

    select, input[type="number"], textarea {
      width: 100%;
      background: var(--bg-panel);
      color: var(--ink);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11.5px;
      transition: border-color 140ms var(--ease-out);
    }

    select {
      height: 32px;
      padding: 0 9px;
      cursor: pointer;
    }

    input[type="number"] {
      height: 26px;
      width: 70px;
      padding: 0 7px;
    }

    textarea {
      flex: 1;
      min-height: 180px;
      padding: 9px 10px;
      line-height: 1.44;
      resize: none;
    }

    select:focus-visible,
    input:focus-visible,
    textarea:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--ink);
      outline-offset: 1px;
      border-color: var(--ink);
    }

    .preset-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    button {
      font-family: var(--font-sans);
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      transition:
        transform 140ms var(--ease-out),
        background-color 140ms var(--ease-out),
        border-color 140ms var(--ease-out),
        color 140ms var(--ease-out);
    }

    button:active {
      transform: scale(0.98);
    }

    .preset-btn {
      background: var(--bg-subtle);
      color: var(--ink);
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
      line-height: 1.25;
    }

    .preset-btn.active {
      background: var(--bg-panel);
      border-color: var(--ink);
      font-weight: 600;
    }

    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .run-btn {
      background: var(--ink);
      color: #FFFFFF;
      border: 1px solid var(--ink);
      height: 32px;
      padding: 0 15px;
      font-size: 12px;
      font-weight: 600;
    }

    .secondary-btn {
      background: var(--bg-panel);
      color: var(--ink);
      border: 1px solid var(--border);
      height: 25px;
      padding: 0 9px;
      font-size: 11px;
    }

    @media (hover: hover) and (pointer: fine) {
      .preset-btn:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }
      .run-btn:hover {
        background: #2E2C28;
      }
      .secondary-btn:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }
      .tab-btn:hover {
        color: var(--ink);
      }
      .filter-btn:hover {
        border-color: var(--border-strong);
      }
      .eval-row:hover {
        background: var(--bg-subtle);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      button, select, input, textarea {
        transition: none;
      }
      button:active {
        transform: none;
      }
    }

    .schema-strip {
      border-top: 1px solid var(--border);
      padding-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .schema-list {
      display: flex;
      flex-direction: column;
      gap: 2.5px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--ink-secondary);
    }

    .schema-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .schema-item strong {
      color: var(--ink);
      font-weight: 500;
    }

    .tab-bar {
      height: 36px;
      padding: 0 14px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-subtle);
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .tab-group {
      display: flex;
      align-items: stretch;
      gap: 16px;
    }

    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 0 2px;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--ink-secondary);
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .tab-btn:active {
      transform: none;
    }

    .tab-btn.active {
      color: var(--ink);
      font-weight: 600;
      border-bottom-color: var(--ink);
    }

    .tab-count {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 10.5px;
      padding: 1px 5px;
      border-radius: 3px;
      border: 1px solid var(--pass-border);
      background: var(--pass-bg);
      color: var(--pass-ink);
    }

    .tab-panel {
      display: none;
      flex: 1;
      min-height: 0;
      flex-direction: column;
    }

    .tab-panel.active {
      display: flex;
    }

    .telemetry-bar {
      padding: 7px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    .telemetry-metrics {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--ink-secondary);
    }

    .telemetry-metrics span strong {
      color: var(--ink);
      font-weight: 600;
    }

    .result-preview {
      border-bottom: 1px solid var(--border);
      max-height: 190px;
      overflow: auto;
      flex-shrink: 0;
      background: var(--bg-panel);
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11.5px;
    }

    .data-table th {
      position: sticky;
      top: 0;
      background: var(--bg-subtle);
      color: var(--ink-secondary);
      font-weight: 600;
      text-align: left;
      padding: 5.5px 11px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .data-table td {
      padding: 5.5px 11px;
      border-bottom: 1px solid var(--border);
      color: var(--ink);
      white-space: nowrap;
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    .guardrail-callout {
      padding: 11px 14px;
      background: var(--block-bg);
      color: var(--block-ink);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .guardrail-callout strong {
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
    }

    .summary-cell {
      padding: 9px 14px;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .summary-cell:last-child {
      border-right: none;
    }

    .summary-cell-label {
      font-size: 11.5px;
      color: var(--ink-secondary);
    }

    .summary-cell-val {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
    }

    .wire-split {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 40% 60%;
    }

    .wire-col {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--border);
    }

    .wire-col:last-child {
      border-right: none;
    }

    .wire-col-header {
      height: 28px;
      padding: 0 12px;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 500;
      color: var(--ink-secondary);
      flex-shrink: 0;
    }

    .wire-pre {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 9px 12px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      line-height: 1.44;
      color: var(--ink);
      background: var(--bg-panel);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .eval-summary-strip {
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
    }

    .eval-stats {
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--ink-secondary);
    }

    .eval-filter-strip {
      padding: 5px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .filter-btn {
      background: var(--bg-panel);
      color: var(--ink-secondary);
      border: 1px solid var(--border);
      height: 24px;
      padding: 0 8px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .filter-btn.active {
      background: var(--ink);
      color: #FFFFFF;
      border-color: var(--ink);
    }

    .eval-table-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .eval-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 11.5px;
    }

    .eval-table col.col-id { width: 72px; }
    .eval-table col.col-cat { width: 122px; }
    .eval-table col.col-title { width: auto; }
    .eval-table col.col-exp { width: 162px; }
    .eval-table col.col-act { width: 176px; }
    .eval-table col.col-res { width: 66px; }
    .eval-table col.col-ms { width: 80px; }

    .eval-table th {
      position: sticky;
      top: 0;
      background: var(--bg-subtle);
      color: var(--ink-secondary);
      font-weight: 600;
      text-align: left;
      padding: 5px 8px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .eval-table th.num,
    .eval-table td.num {
      text-align: right;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }

    .eval-table td {
      padding: 4.5px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .eval-table tr:last-child td {
      border-bottom: none;
    }

    .eval-row {
      cursor: pointer;
    }

    .eval-id {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--ink-secondary);
    }

    .eval-cat {
      color: var(--ink-secondary);
    }

    .eval-scenario-title {
      font-weight: 500;
      color: var(--ink);
    }

    .expected-code {
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--ink-secondary);
    }

    .verdict-code {
      font-family: var(--font-mono);
      font-size: 10.5px;
      padding: 1px 6px;
      border-radius: 3px;
      display: inline-block;
      white-space: nowrap;
    }

    .verdict-code.allowed {
      color: var(--pass-ink);
      background: var(--pass-bg);
      border: 1px solid var(--pass-border);
    }

    .verdict-code.blocked {
      color: var(--block-ink);
      background: var(--block-bg);
      border: 1px solid var(--block-border);
    }

    @media (max-width: 1080px) {
      .app-shell {
        height: auto;
        min-height: 100vh;
      }
      .workbench-grid {
        grid-template-columns: 1fr;
      }
      .wire-split {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar-left">
        <span class="brand-name">opsflow-mcp</span>
        <span class="v-rule"></span>
        <span class="topbar-subtitle">JSON-RPC 2.0 protocol inspector and SQL guardrail evaluation workbench</span>
      </div>
      <div class="topbar-right">
        <span class="mono-tag">MCP 2024-11-05</span>
        <span class="mono-tag">node:sqlite query_only=ON</span>
        <span class="status-pill pass" id="server-health-pill">POST /mcp 200</span>
        <span class="status-pill pass" id="header-eval-pill">18/18 evals pass</span>
      </div>
    </header>

    <main class="workbench-grid">
      <section class="panel" aria-label="Tool invocation composer">
        <div class="pane-header">
          <span class="pane-title">Tool invocation</span>
          <span class="pane-meta" id="request-counter">id: 1</span>
        </div>

        <div class="composer-body">
          <div class="field-group">
            <label for="tool-select">MCP tool</label>
            <select id="tool-select">
              <option value="query_analytics_readonly">query_analytics_readonly</option>
              <option value="audit_dataset_health">audit_dataset_health</option>
              <option value="compile_weekly_exec_digest">compile_weekly_exec_digest</option>
              <option value="run_automation_playbook">run_automation_playbook</option>
            </select>
          </div>

          <div class="field-group">
            <div class="field-label-row">
              <label>Presets</label>
              <span class="field-hint">4 scenarios</span>
            </div>
            <div class="preset-grid">
              <button type="button" class="preset-btn active" data-preset="arr_cohort">Run ARR cohort query</button>
              <button type="button" class="preset-btn" data-preset="stacked_drop">Test stacked DROP injection</button>
              <button type="button" class="preset-btn" data-preset="audit_slas">Audit warehouse SLAs</button>
              <button type="button" class="preset-btn" data-preset="weekly_digest">Compile weekly digest</button>
            </div>
          </div>

          <div class="field-group grow">
            <div class="field-label-row">
              <label for="editor-input" id="editor-label">SQL query (arguments.sql)</label>
              <div id="max-rows-wrap" style="display:flex;align-items:center;gap:6px;">
                <span class="field-hint">maxRows</span>
                <input type="number" id="max-rows-input" min="1" max="500" value="10" />
              </div>
            </div>
            <textarea id="editor-input" spellcheck="false"></textarea>
          </div>

          <div class="action-row">
            <button type="button" class="run-btn" id="run-tool-btn">Run tool</button>
            <span class="field-hint">Ctrl+Enter to send</span>
          </div>

          <div class="schema-strip">
            <div class="field-label-row">
              <label>Warehouse schema</label>
              <span class="field-hint">opsflow://schema/catalog</span>
            </div>
            <div class="schema-list">
              <div class="schema-item"><strong>accounts</strong><span>12 rows, pk: account_id</span></div>
              <div class="schema-item"><strong>revenue_events</strong><span>16 rows, key: idempotency_key</span></div>
              <div class="schema-item"><strong>weekly_kpi_snapshots</strong><span>9 rows, 3 segments</span></div>
              <div class="schema-item"><strong>pipeline_runs</strong><span>8 runs, Tier 0 to Tier 2</span></div>
              <div class="schema-item"><strong>support_escalations</strong><span>5 tickets, SEV-1 to SEV-3</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" aria-label="Protocol wire trace and evaluation suite">
        <div class="tab-bar">
          <div class="tab-group" role="tablist">
            <button type="button" role="tab" aria-selected="true" class="tab-btn active" id="tab-btn-wire" data-tab="wire">
              JSON-RPC 2.0 wire trace
            </button>
            <button type="button" role="tab" aria-selected="false" class="tab-btn" id="tab-btn-evals" data-tab="evals">
              Evaluation benchmark
              <span class="tab-count" id="tab-eval-badge">18/18</span>
            </button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="pane-meta" id="active-endpoint-label">POST http://127.0.0.1:8762/mcp</span>
          </div>
        </div>

        <div class="tab-panel active" id="panel-wire" role="tabpanel">
          <div class="telemetry-bar">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="status-pill pass" id="wire-http-pill">200 OK</span>
              <span class="status-pill pass" id="wire-verdict-pill">ALLOWED_READONLY</span>
            </div>
            <div class="telemetry-metrics">
              <span>Tool: <strong id="meta-tool">query_analytics_readonly</strong></span>
              <span>Engine: <strong id="meta-exec-ms">0.00 ms</strong></span>
              <span>Round-trip: <strong id="meta-rtt-ms">0.00 ms</strong></span>
              <span id="meta-extra-wrap">Rows: <strong id="meta-extra">0</strong></span>
              <span id="meta-hash-wrap">SHA-256: <strong id="meta-hash">n/a</strong></span>
            </div>
          </div>

          <div class="result-preview" id="result-preview"></div>

          <div class="wire-split">
            <div class="wire-col">
              <div class="wire-col-header">
                <span>Request payload</span>
                <span style="font-family:var(--font-mono);">POST /mcp</span>
              </div>
              <pre class="wire-pre" id="wire-request-pre"></pre>
            </div>
            <div class="wire-col">
              <div class="wire-col-header">
                <span>Response payload</span>
                <span style="font-family:var(--font-mono);" id="wire-response-bytes">application/json</span>
              </div>
              <pre class="wire-pre" id="wire-response-pre"></pre>
            </div>
          </div>
        </div>

        <div class="tab-panel" id="panel-evals" role="tabpanel">
          <div class="eval-summary-strip">
            <div class="eval-stats">
              <span class="status-pill pass" id="eval-score-pill">18/18 PASS (100%)</span>
              <span>False-positive rate: <strong style="color:var(--ink);" id="eval-fp-rate">0% (0/4)</strong></span>
              <span>SQL attacks blocked: <strong style="color:var(--ink);" id="eval-blocked-count">6/6 (100%)</strong></span>
              <span>Total: <strong style="color:var(--ink);" id="eval-total-ms">0.0 ms</strong></span>
              <span>Mean: <strong style="color:var(--ink);" id="eval-mean-ms">0.00 ms</strong></span>
            </div>
            <button type="button" class="secondary-btn" id="rerun-evals-btn">Re-run suite</button>
          </div>

          <div class="eval-filter-strip">
            <div class="filter-row">
              <button type="button" class="filter-btn active" data-cat="all">All (18)</button>
              <button type="button" class="filter-btn" data-cat="sql_analytics">SQL analytics (4)</button>
              <button type="button" class="filter-btn" data-cat="sql_guardrails">SQL guardrails (6)</button>
              <button type="button" class="filter-btn" data-cat="data_trust_gates">Data trust gates (4)</button>
              <button type="button" class="filter-btn" data-cat="workflow_playbooks">Workflow playbooks (4)</button>
            </div>
            <span class="field-hint">Click any row to load probe</span>
          </div>

          <div class="eval-table-wrap">
            <table class="eval-table">
              <colgroup>
                <col class="col-id" />
                <col class="col-cat" />
                <col class="col-title" />
                <col class="col-exp" />
                <col class="col-act" />
                <col class="col-res" />
                <col class="col-ms" />
              </colgroup>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Test scenario</th>
                  <th>Expected verdict</th>
                  <th>Actual verdict</th>
                  <th>Status</th>
                  <th class="num">Latency</th>
                </tr>
              </thead>
              <tbody id="eval-tbody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script>
    const PRESETS = {
      arr_cohort: {
        tool: 'query_analytics_readonly',
        maxRows: 10,
        sql: [
          'WITH open_sev AS (',
          '  SELECT account_id, COUNT(*) AS open_tickets, MAX(severity) AS top_sev',
          '  FROM support_escalations WHERE resolved = 0 GROUP BY account_id',
          ')',
          'SELECT a.company_name, a.segment, a.region, a.arr_usd,',
          '  ROUND((CAST(a.seats_active_30d AS REAL) / a.seats_purchased) * 100, 1) AS seat_util_pct,',
          '  a.health_score, COALESCE(o.open_tickets, 0) AS open_tickets,',
          "  COALESCE(o.top_sev, 'NONE') AS top_sev, a.renewal_date",
          'FROM accounts a',
          'LEFT JOIN open_sev o ON a.account_id = o.account_id',
          "WHERE a.status = 'at_risk'",
          'ORDER BY a.arr_usd DESC;'
        ].join('\\n')
      },
      stacked_drop: {
        tool: 'query_analytics_readonly',
        maxRows: 10,
        sql: [
          'SELECT account_id, company_name, segment, arr_usd',
          'FROM accounts',
          "WHERE segment = 'Enterprise';",
          'DROP TABLE accounts; --'
        ].join('\\n')
      },
      audit_slas: {
        tool: 'audit_dataset_health',
        args: {
          dataset: 'all',
          nullThresholdPct: 5,
          outlierZThreshold: 2.4
        }
      },
      weekly_digest: {
        tool: 'compile_weekly_exec_digest',
        args: {
          targetWeek: '2026-04-06',
          format: 'both'
        }
      }
    };

    const DEFAULT_TOOL_ARGS = {
      query_analytics_readonly: PRESETS.arr_cohort.sql,
      audit_dataset_health: JSON.stringify(PRESETS.audit_slas.args, null, 2),
      compile_weekly_exec_digest: JSON.stringify(PRESETS.weekly_digest.args, null, 2),
      run_automation_playbook: JSON.stringify(
        {
          playbook: 'churn-rescue-sync',
          dryRun: true,
          maxRetries: 2,
          simulateTransientFailures: { sync_crm_save_tasks: 1 },
          params: { minArrUsd: 50000 }
        },
        null,
        2
      )
    };

    let nextRpcId = 1;
    let evalReport = null;
    let activeEvalCategory = 'all';

    const toolSelect = document.getElementById('tool-select');
    const editorLabel = document.getElementById('editor-label');
    const editorInput = document.getElementById('editor-input');
    const maxRowsWrap = document.getElementById('max-rows-wrap');
    const maxRowsInput = document.getElementById('max-rows-input');
    const runToolBtn = document.getElementById('run-tool-btn');
    const requestCounter = document.getElementById('request-counter');

    function escapeHtml(val) {
      return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function syncEditorMode(toolName, customValue) {
      if (toolName === 'query_analytics_readonly') {
        editorLabel.textContent = 'SQL query (arguments.sql)';
        maxRowsWrap.style.display = 'flex';
        editorInput.value = customValue !== undefined ? customValue : DEFAULT_TOOL_ARGS.query_analytics_readonly;
      } else {
        editorLabel.textContent = 'Tool arguments (JSON)';
        maxRowsWrap.style.display = 'none';
        editorInput.value = customValue !== undefined ? customValue : DEFAULT_TOOL_ARGS[toolName];
      }
    }

    function setActiveTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      });
      document.getElementById('panel-wire').classList.toggle('active', tabName === 'wire');
      document.getElementById('panel-evals').classList.toggle('active', tabName === 'evals');
      document.getElementById('active-endpoint-label').textContent =
        tabName === 'wire'
          ? 'POST ' + window.location.origin + '/mcp'
          : 'GET ' + window.location.origin + '/evals';
    }

    function renderResultPreview(toolName, rpcJson) {
      const container = document.getElementById('result-preview');
      if (rpcJson.error) {
        container.innerHTML =
          '<div class="guardrail-callout">' +
          '<strong>JSON-RPC error ' + escapeHtml(rpcJson.error.code) + '</strong>' +
          '<span>' + escapeHtml(rpcJson.error.message) + '</span>' +
          '</div>';
        return;
      }

      const result = rpcJson.result || {};
      const payload = result.structuredContent || {};

      if (toolName === 'query_analytics_readonly') {
        if (!payload.ok) {
          const err = payload.error || {};
          container.innerHTML =
            '<div class="guardrail-callout">' +
            '<strong>BLOCKED: ' + escapeHtml(err.code || 'GUARDRAIL_REJECTED') + '</strong>' +
            '<span>' + escapeHtml(err.message || 'Blocked by read-only SQL guardrails.') + '</span>' +
            '</div>';
          return;
        }
        const cols = payload.columns || [];
        const rows = payload.rows || [];
        if (rows.length === 0) {
          container.innerHTML = '<div style="padding:11px 14px;color:var(--ink-secondary);">Query returned 0 rows.</div>';
          return;
        }
        const thead = '<tr>' + cols.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';
        const tbody = rows
          .map((row) => {
            return (
              '<tr>' +
              cols
                .map((c) => {
                  const v = row[c];
                  const formatted =
                    typeof v === 'number' && c.endsWith('_usd')
                      ? '$' + v.toLocaleString('en-US')
                      : v === null
                        ? 'NULL'
                        : String(v);
                  return '<td>' + escapeHtml(formatted) + '</td>';
                })
                .join('') +
              '</tr>'
            );
          })
          .join('');
        container.innerHTML = '<table class="data-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
        return;
      }

      if (toolName === 'audit_dataset_health') {
        const s = payload.summary || {};
        container.innerHTML =
          '<div class="summary-cards">' +
          '<div class="summary-cell"><span class="summary-cell-label">Warehouse status</span><span class="summary-cell-val">' + escapeHtml(payload.overallStatus) + ' (' + escapeHtml(payload.healthScore) + '/100)</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Critical findings</span><span class="summary-cell-val">' + escapeHtml(s.criticalCount) + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Warnings</span><span class="summary-cell-val">' + escapeHtml(s.warningCount) + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Executive gate ready</span><span class="summary-cell-val">' + escapeHtml(String(s.executiveGateReady)) + '</span></div>' +
          '</div>';
        return;
      }

      if (toolName === 'compile_weekly_exec_digest') {
        const k = payload.kpis || {};
        container.innerHTML =
          '<div class="summary-cards">' +
          '<div class="summary-cell"><span class="summary-cell-label">Net new ARR (' + escapeHtml(payload.period?.currentWeek) + ')</span><span class="summary-cell-val">$' + Number(k.netNewArr?.currentUsd || 0).toLocaleString('en-US') + ' (+' + escapeHtml(k.netNewArr?.wowPct) + '%)</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Expansion ARR</span><span class="summary-cell-val">$' + Number(k.expansionArr?.currentUsd || 0).toLocaleString('en-US') + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Pipeline coverage</span><span class="summary-cell-val">' + escapeHtml(k.pipelineCoverageRatio?.current) + 'x</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Exposed renewal ARR</span><span class="summary-cell-val">$' + Number(payload.renewalRiskWatchlist?.totalAtRiskArrUsd || 0).toLocaleString('en-US') + '</span></div>' +
          '</div>';
        return;
      }

      if (toolName === 'run_automation_playbook') {
        const sum = payload.summary || {};
        container.innerHTML =
          '<div class="summary-cards">' +
          '<div class="summary-cell"><span class="summary-cell-label">Playbook status</span><span class="summary-cell-val">' + escapeHtml(payload.status) + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Steps completed</span><span class="summary-cell-val">' + escapeHtml(sum.stepsCompleted) + '/' + escapeHtml(sum.stepsTotal) + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Retries used</span><span class="summary-cell-val">' + escapeHtml(sum.totalRetriesUsed) + '</span></div>' +
          '<div class="summary-cell"><span class="summary-cell-label">Live side effects</span><span class="summary-cell-val">' + escapeHtml(sum.sideEffectsCommitted) + ' (dryRun=' + escapeHtml(String(payload.dryRun)) + ')</span></div>' +
          '</div>';
      }
    }

    async function executeCurrentTool() {
      const toolName = toolSelect.value;
      let parsedArgs = {};

      if (toolName === 'query_analytics_readonly') {
        parsedArgs = {
          sql: editorInput.value,
          maxRows: Number(maxRowsInput.value) || 10
        };
      } else {
        try {
          parsedArgs = JSON.parse(editorInput.value);
        } catch (err) {
          document.getElementById('result-preview').innerHTML =
            '<div class="guardrail-callout"><strong>CLIENT_JSON_PARSE_ERROR</strong><span>Arguments must be valid JSON: ' +
            escapeHtml(err.message) +
            '</span></div>';
          return;
        }
      }

      const rpcId = nextRpcId++;
      requestCounter.textContent = 'id: ' + rpcId;

      const reqEnvelope = {
        jsonrpc: '2.0',
        id: rpcId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: parsedArgs
        }
      };

      const reqText = JSON.stringify(reqEnvelope, null, 2);
      document.getElementById('wire-request-pre').textContent = reqText;

      const t0 = performance.now();
      const resp = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqEnvelope)
      });
      const rttMs = (performance.now() - t0).toFixed(2);
      const rawRespText = await resp.text();
      let rpcJson;
      try {
        rpcJson = JSON.parse(rawRespText);
      } catch {
        rpcJson = { error: { code: -32700, message: rawRespText } };
      }

      document.getElementById('wire-response-pre').textContent = JSON.stringify(rpcJson, null, 2);
      document.getElementById('wire-response-bytes').textContent =
        new Blob([rawRespText]).size.toLocaleString('en-US') + ' bytes';

      const httpPill = document.getElementById('wire-http-pill');
      httpPill.textContent = resp.status + ' ' + (resp.ok ? 'OK' : 'ERR');
      httpPill.className = 'status-pill ' + (resp.ok ? 'pass' : 'block');

      const isErr = Boolean(rpcJson.error || rpcJson.result?.isError);
      const payload = rpcJson.result?.structuredContent || {};
      const verdictPill = document.getElementById('wire-verdict-pill');

      let verdictText = 'OK';
      let execMs = rttMs;
      let extraLabel = 'Items';
      let extraVal = '1';
      let hashVal = 'n/a';

      if (toolName === 'query_analytics_readonly') {
        verdictText = payload.ok
          ? payload.telemetry?.guardrailVerdict || 'ALLOWED_READONLY'
          : payload.error?.code || 'BLOCKED';
        execMs = payload.telemetry?.executionMs ?? 0;
        extraLabel = 'Rows';
        extraVal = String(payload.telemetry?.rowCount ?? 0);
        hashVal = payload.telemetry?.queryFingerprint ? '#' + payload.telemetry.queryFingerprint : 'n/a';
      } else if (toolName === 'audit_dataset_health') {
        verdictText = payload.overallStatus === 'critical' ? 'SLA_BREACH_DETECTED' : 'AUDIT_OK';
        extraLabel = 'Findings';
        extraVal = String(payload.summary?.totalFindings ?? 0);
      } else if (toolName === 'compile_weekly_exec_digest') {
        verdictText = 'DIGEST_COMPILED';
        extraLabel = 'Slack blocks';
        extraVal = String(payload.slackBlockKit?.blocks?.length ?? 0);
      } else if (toolName === 'run_automation_playbook') {
        verdictText = payload.status === 'succeeded' ? 'PLAYBOOK_SUCCEEDED' : 'PLAYBOOK_FAILED';
        execMs = payload.timing?.totalDurationMs ?? rttMs;
        extraLabel = 'Steps';
        extraVal = (payload.summary?.stepsCompleted ?? 0) + '/' + (payload.summary?.stepsTotal ?? 0);
      }

      const isBlockedStyle =
        isErr ||
        verdictText.includes('BLOCKED') ||
        verdictText.includes('FORBIDDEN') ||
        verdictText.includes('BREACH') ||
        verdictText.includes('FAILED');

      verdictPill.textContent = verdictText;
      verdictPill.className = 'status-pill ' + (isBlockedStyle ? 'block' : 'pass');

      document.getElementById('meta-tool').textContent = toolName;
      document.getElementById('meta-exec-ms').textContent = Number(execMs).toFixed(2) + ' ms';
      document.getElementById('meta-rtt-ms').textContent = rttMs + ' ms';
      document.getElementById('meta-extra-wrap').innerHTML =
        escapeHtml(extraLabel) + ': <strong>' + escapeHtml(extraVal) + '</strong>';
      document.getElementById('meta-hash').textContent = hashVal;

      renderResultPreview(toolName, rpcJson);
    }

    function isGuardrailBlockCode(verdict, isAdversarial) {
      if (isAdversarial) return true;
      return (
        verdict.includes('BLOCKED') ||
        verdict.includes('FORBIDDEN') ||
        verdict.includes('DETECTED') ||
        verdict.includes('HALTED') ||
        verdict.includes('CAVEAT') ||
        verdict.includes('COMMENT')
      );
    }

    function renderEvalTable() {
      if (!evalReport) return;
      const tbody = document.getElementById('eval-tbody');
      const rows = evalReport.cases.filter(
        (c) => activeEvalCategory === 'all' || c.category === activeEvalCategory
      );

      tbody.innerHTML = rows
        .map((row) => {
          const verdictClass = isGuardrailBlockCode(row.actualVerdict, row.isAdversarialSql)
            ? 'blocked'
            : 'allowed';
          const resultPillClass = row.passed ? 'pass' : 'block';
          const resultText = row.passed ? 'PASS' : 'FAIL';
          return (
            '<tr class="eval-row" data-eval-id="' + escapeHtml(row.id) + '" title="' + escapeHtml(row.evidence) + '">' +
            '<td class="eval-id">' + escapeHtml(row.id) + '</td>' +
            '<td class="eval-cat">' + escapeHtml(row.categoryLabel) + '</td>' +
            '<td class="eval-scenario-title">' + escapeHtml(row.title) + '</td>' +
            '<td class="expected-code">' + escapeHtml(row.expectedVerdict) + '</td>' +
            '<td><span class="verdict-code ' + verdictClass + '">' + escapeHtml(row.actualVerdict) + '</span></td>' +
            '<td><span class="status-pill ' + resultPillClass + '">' + resultText + '</span></td>' +
            '<td class="num">' + Number(row.latencyMs).toFixed(2) + ' ms</td>' +
            '</tr>'
          );
        })
        .join('');

      tbody.querySelectorAll('.eval-row').forEach((tr) => {
        tr.addEventListener('click', () => {
          const item = evalReport.cases.find((c) => c.id === tr.dataset.evalId);
          if (!item) return;
          document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
          toolSelect.value = item.tool;
          syncEditorMode(item.tool, item.probeSummary);
        });
      });
    }

    async function loadEvalSuite() {
      const resp = await fetch('/evals');
      evalReport = await resp.json();
      const s = evalReport.summary;

      const scorePill = document.getElementById('eval-score-pill');
      scorePill.textContent = s.scoreLabel + ' PASS (' + s.passRatePct + '%)';
      scorePill.className = 'status-pill ' + (s.failedCases === 0 ? 'pass' : 'block');

      document.getElementById('tab-eval-badge').textContent = s.scoreLabel;
      document.getElementById('header-eval-pill').textContent = s.scoreLabel + ' evals pass';
      document.getElementById('eval-fp-rate').textContent =
        s.falsePositiveRatePct + '% (' + s.falsePositives + '/' + s.benignSqlCases + ')';
      document.getElementById('eval-blocked-count').textContent =
        s.blockedAttacks + '/' + s.adversarialSqlCases + ' (' + s.attackBlockRatePct + '%)';
      document.getElementById('eval-total-ms').textContent = s.totalLatencyMs.toFixed(1) + ' ms';
      document.getElementById('eval-mean-ms').textContent = s.meanLatencyMs.toFixed(2) + ' ms';

      renderEvalTable();
    }

    toolSelect.addEventListener('change', () => {
      document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
      syncEditorMode(toolSelect.value);
    });

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = PRESETS[btn.dataset.preset];
        toolSelect.value = preset.tool;
        if (preset.tool === 'query_analytics_readonly') {
          maxRowsInput.value = String(preset.maxRows || 10);
          syncEditorMode(preset.tool, preset.sql);
        } else {
          syncEditorMode(preset.tool, JSON.stringify(preset.args, null, 2));
        }
        setActiveTab('wire');
        await executeCurrentTool();
      });
    });

    runToolBtn.addEventListener('click', async () => {
      setActiveTab('wire');
      await executeCurrentTool();
    });

    editorInput.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        setActiveTab('wire');
        await executeCurrentTool();
      }
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveTab(btn.dataset.tab);
      });
    });

    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeEvalCategory = btn.dataset.cat;
        renderEvalTable();
      });
    });

    document.getElementById('rerun-evals-btn').addEventListener('click', loadEvalSuite);

    syncEditorMode('query_analytics_readonly', PRESETS.arr_cohort.sql);
    Promise.all([executeCurrentTool(), loadEvalSuite()]);
  </script>
</body>
</html>`;
}
