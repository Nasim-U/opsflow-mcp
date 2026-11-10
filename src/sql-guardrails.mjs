import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const DEFAULT_MAX_ROWS = 50;
export const HARD_MAX_ROWS_CAP = 500;
export const MAX_SQL_LENGTH = 8192;

const FORBIDDEN_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'REPLACE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'REINDEX',
  'LOAD_EXTENSION',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE'
]);

const SYSTEM_CATALOGS = new Set([
  'SQLITE_MASTER',
  'SQLITE_SCHEMA',
  'SQLITE_TEMP_MASTER',
  'SQLITE_TEMP_SCHEMA'
]);

const KNOWN_WAREHOUSE_TABLES = [
  'accounts',
  'revenue_events',
  'weekly_kpi_snapshots',
  'pipeline_runs',
  'support_escalations'
];

/**
 * Lexically sanitizes SQL by stripping comments and replacing string literals with placeholders,
 * allowing accurate multi-statement and forbidden-token detection without false positives on strings.
 */
export function inspectSqlQuery(rawSql) {
  if (typeof rawSql !== 'string' || rawSql.trim().length === 0) {
    return {
      allowed: false,
      code: 'EMPTY_SQL_QUERY',
      reason: 'SQL query must be a non-empty string.'
    };
  }

  if (rawSql.length > MAX_SQL_LENGTH) {
    return {
      allowed: false,
      code: 'SQL_LENGTH_EXCEEDED',
      reason: `SQL query length (${rawSql.length}) exceeds maximum limit of ${MAX_SQL_LENGTH} characters.`
    };
  }

  let stripped = '';
  let executable = '';
  let i = 0;
  const len = rawSql.length;

  while (i < len) {
    const ch = rawSql[i];
    const next = rawSql[i + 1];

    // Line comment: -- ... \n
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < len && rawSql[i] !== '\n') {
        i += 1;
      }
      stripped += ' ';
      executable += ' ';
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      const closeIdx = rawSql.indexOf('*/', i + 2);
      if (closeIdx === -1) {
        return {
          allowed: false,
          code: 'MALFORMED_SQL_COMMENT',
          reason: 'Unclosed block comment detected in SQL query.'
        };
      }
      i = closeIdx + 2;
      stripped += ' ';
      executable += ' ';
      continue;
    }

    // Single-quoted string literal: '...' (handles escaped '')
    if (ch === "'") {
      const startIdx = i;
      i += 1;
      let closed = false;
      while (i < len) {
        if (rawSql[i] === "'" && rawSql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (rawSql[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        return {
          allowed: false,
          code: 'UNTERMINATED_STRING_LITERAL',
          reason: 'Unterminated single-quoted string literal in SQL query.'
        };
      }
      stripped += " '__STR__' ";
      executable += rawSql.slice(startIdx, i);
      continue;
    }

    // Double-quoted identifier: "..."
    if (ch === '"') {
      const startIdx = i;
      i += 1;
      let ident = '';
      let closed = false;
      while (i < len) {
        if (rawSql[i] === '"' && rawSql[i + 1] === '"') {
          ident += '"';
          i += 2;
          continue;
        }
        if (rawSql[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        ident += rawSql[i];
        i += 1;
      }
      if (!closed) {
        return {
          allowed: false,
          code: 'UNTERMINATED_IDENTIFIER',
          reason: 'Unterminated double-quoted identifier in SQL query.'
        };
      }
      stripped += ` ${ident} `;
      executable += rawSql.slice(startIdx, i);
      continue;
    }

    stripped += ch;
    executable += ch;
    i += 1;
  }

  const normalized = stripped.trim();
  const normalizedExec = executable.trim();
  if (!normalized) {
    return {
      allowed: false,
      code: 'EMPTY_SQL_QUERY',
      reason: 'SQL query contains only comments or whitespace.'
    };
  }

  // Allow at most one trailing semicolon; block any interior semicolon (multi-statement injection)
  const withoutTrailingSemicolon = normalized.endsWith(';')
    ? normalized.slice(0, -1).trim()
    : normalized;
  const executableWithoutSemicolon = normalizedExec.endsWith(';')
    ? normalizedExec.slice(0, -1).trim()
    : normalizedExec;

  if (withoutTrailingSemicolon.includes(';')) {
    return {
      allowed: false,
      code: 'MULTI_STATEMENT_BLOCKED',
      reason: 'Multi-statement SQL queries are prohibited by OpsFlow guardrails.'
    };
  }

  const tokens = withoutTrailingSemicolon
    .toUpperCase()
    .split(/[^A-Z0-9_]+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      allowed: false,
      code: 'EMPTY_SQL_QUERY',
      reason: 'No executable SQL tokens found.'
    };
  }

  const rootKeyword = tokens[0];
  if (rootKeyword !== 'SELECT' && rootKeyword !== 'WITH') {
    return {
      allowed: false,
      code: 'NON_SELECT_ROOT_BLOCKED',
      reason: `Only read-only SELECT or WITH ... SELECT queries are permitted (found root keyword: ${rootKeyword}).`
    };
  }

  if (rootKeyword === 'WITH' && !tokens.includes('SELECT')) {
    return {
      allowed: false,
      code: 'CTE_WITHOUT_SELECT_BLOCKED',
      reason: 'WITH clause must terminate in a read-only SELECT statement.'
    };
  }

  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.has(token)) {
      return {
        allowed: false,
        code: 'FORBIDDEN_SQL_KEYWORD',
        blockedKeyword: token,
        reason: `Mutating or administrative SQL keyword '${token}' is blocked by read-only warehouse guardrails.`
      };
    }
    if (SYSTEM_CATALOGS.has(token)) {
      return {
        allowed: false,
        code: 'SYSTEM_CATALOG_BLOCKED',
        blockedCatalog: token.toLowerCase(),
        reason: `Direct introspection of SQLite internal catalog '${token.toLowerCase()}' is restricted; read MCP resource 'opsflow://schema/catalog' instead.`
      };
    }
  }

  const lowerTokens = new Set(tokens.map((t) => t.toLowerCase()));
  const referencedTables = KNOWN_WAREHOUSE_TABLES.filter((tbl) => lowerTokens.has(tbl));

  return {
    allowed: true,
    code: 'GUARDRAIL_PASSED',
    sanitizedSql: executableWithoutSemicolon,
    referencedTables
  };
}

/**
 * Executes a guardrailed read-only analytical query with row-streaming limit enforcement and telemetry.
 */
export function executeGuardrailedQuery(db, { sql, maxRows = DEFAULT_MAX_ROWS }) {
  const queryFingerprint = createHash('sha256')
    .update(String(sql ?? ''))
    .digest('hex')
    .slice(0, 12);

  const inspection = inspectSqlQuery(sql);
  if (!inspection.allowed) {
    return {
      ok: false,
      error: {
        code: inspection.code,
        message: inspection.reason,
        blockedKeyword: inspection.blockedKeyword ?? null,
        blockedCatalog: inspection.blockedCatalog ?? null
      },
      telemetry: {
        queryFingerprint,
        guardrailVerdict: 'BLOCKED',
        executionMs: 0,
        rowCount: 0,
        truncated: false
      }
    };
  }

  const numericMax = Number.isFinite(Number(maxRows)) ? Math.trunc(Number(maxRows)) : DEFAULT_MAX_ROWS;
  const effectiveMaxRows = Math.min(Math.max(numericMax, 1), HARD_MAX_ROWS_CAP);

  const t0 = performance.now();
  try {
    const stmt = db.prepare(inspection.sanitizedSql);
    const iterator = stmt.iterate();
    const rows = [];
    let truncated = false;

    for (const rawRow of iterator) {
      if (rows.length >= effectiveMaxRows) {
        truncated = true;
        break;
      }
      rows.push({ ...rawRow });
    }

    const executionMs = Number((performance.now() - t0).toFixed(3));
    const columns = rows.length > 0
      ? Object.keys(rows[0])
      : stmt.columns().map((c) => c.name);

    return {
      ok: true,
      columns,
      rows,
      telemetry: {
        queryFingerprint,
        guardrailVerdict: 'ALLOWED_READONLY',
        referencedTables: inspection.referencedTables,
        effectiveMaxRows,
        rowCount: rows.length,
        truncated,
        executionMs
      }
    };
  } catch (err) {
    const executionMs = Number((performance.now() - t0).toFixed(3));
    return {
      ok: false,
      error: {
        code: 'SQL_EXECUTION_ERROR',
        message: err instanceof Error ? err.message : String(err)
      },
      telemetry: {
        queryFingerprint,
        guardrailVerdict: 'ENGINE_REJECTED',
        executionMs,
        rowCount: 0,
        truncated: false
      }
    };
  }
}
