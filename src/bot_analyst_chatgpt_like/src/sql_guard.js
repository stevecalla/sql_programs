/**
 * sql_guard.js
 */

const { CATALOG } = require("./catalog");

function strip_sql_comments_and_strings(sql) {
  let s = String(sql || "");

  // Remove block comments /* ... */
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");

  // Remove line comments -- ...
  s = s.replace(/--.*$/gm, " ");

  // Replace single-quoted strings '...'
  s = s.replace(/'(?:\\'|''|[^'])*'/g, "''");

  // Replace double-quoted strings "..." (rare in BQ, but safe)
  s = s.replace(/"(?:\\"|""|[^"])*"/g, '""');

  return s;
}

function escape_regex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * assert_safe_select(sql, catalog?)
 * - Enforces SELECT/WITH only
 * - Blocks write keywords
 * - Restricts CAST/SAFE_CAST targets
 * - Requires referencing at least one allowlisted table from catalog
 *
 * Returns matched fully-qualified table name: project.dataset.table
 */
function assert_safe_select(sql, catalog = CATALOG) {
  const raw = String(sql || "");
  const trimmed = raw.trim();

  // Must start with SELECT or WITH
  const lower = trimmed.toLowerCase();
  const ok = lower.startsWith("select") || lower.startsWith("with");
  if (!ok) throw new Error("Only SELECT queries are allowed.");

  // Scan on sanitized SQL to avoid matching inside comments/strings
  const sanitized = strip_sql_comments_and_strings(raw);
  const s = sanitized.toLowerCase();

  // Block common write keywords (token-based)
  const blocked = ["insert", "update", "delete", "merge", "create", "drop", "alter", "truncate"];

  for (const kw of blocked) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(s)) {
      throw new Error(`Blocked keyword detected: ${kw}`);
    }
  }

  // Type safety enforcement:
  // allow CAST/SAFE_CAST only to DATE/TIMESTAMP/DATETIME
  const bannedCastTargets = [
    "float64",
    "float32",
    "numeric",
    "bignumeric",
    "int64",
    "int32",
    "uint64",
    "uint32",
    "bool",
    "boolean",
    "string",
    "bytes",
  ];

  for (const t of bannedCastTargets) {
    const re = new RegExp(`\\b(safe_cast|cast)\\s*\\([\\s\\S]*?\\bas\\s+${t}\\b`, "i");
    if (re.test(sanitized)) {
      throw new Error(
        `Type coercion is not allowed (found CAST/SAFE_CAST to ${t.toUpperCase()}). ` +
          `Only DATE/TIMESTAMP/DATETIME casts are permitted.`
      );
    }
  }

  const anyCast = /\b(safe_cast|cast)\s*\(/i.test(sanitized);
  if (anyCast) {
    const targetRe = /\b(?:safe_cast|cast)\s*\([\s\S]*?\bas\s+([a-z0-9_]+)\b/gi;
    let m;
    while ((m = targetRe.exec(sanitized)) !== null) {
      const target = String(m[1] || "").toLowerCase();
      const allowed = ["date", "timestamp", "datetime"].includes(target);
      if (!allowed) {
        throw new Error(
          `Type coercion is not allowed (found CAST/SAFE_CAST to ${target.toUpperCase()}). ` +
            `Only DATE/TIMESTAMP/DATETIME casts are permitted.`
        );
      }
    }
  }

  // Require queries to reference allowlisted catalog tables
  // Robust to missing backticks.
  const allowed = (catalog || []).map((t) => {
    const fqn = `${t.project}.${t.dataset}.${t.table}`;
    return {
      fqn,
      fqn_backticked: `\`${fqn}\``,
    };
  });

  // Find the specific allowlisted table used (and return it)
  const matched = allowed.find(({ fqn, fqn_backticked }) => {
    const plain = new RegExp(`\\b${escape_regex(fqn)}\\b`, "i");
    const backticked = new RegExp(escape_regex(fqn_backticked), "i");
    return plain.test(sanitized) || backticked.test(sanitized);
  });

  if (!matched) {
    throw new Error("Query must reference an allowlisted table (from the catalog).");
  }

  return matched.fqn;
}

module.exports = { assert_safe_select };
