const { CATALOG } = require("./catalog");

function assert_safe_select(sql) {
  const raw = String(sql || "");
  const s = raw.trim().toLowerCase();

  // Only allow SELECT / WITH...SELECT
  const ok = s.startsWith("select") || s.startsWith("with");
  if (!ok) throw new Error("Only SELECT queries are allowed.");

  // Block common write keywords
  const blocked = [
    "insert",
    "update",
    "delete",
    "merge",
    "create",
    "drop",
    "alter",
    "truncate",
  ];

  for (const kw of blocked) {
    if (s.includes(` ${kw} `) || s.startsWith(`${kw} `)) {
      throw new Error(`Blocked keyword detected: ${kw}`);
    }
  }

  // -----------------------------
  // ✅ Type safety enforcement:
  // allow CAST/SAFE_CAST only to DATE/TIMESTAMP/DATETIME
  // -----------------------------
  // Disallow casts to numeric/bool/string types
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

  // If any CAST(... AS <banned>) or SAFE_CAST(... AS <banned>) appears => reject
  for (const t of bannedCastTargets) {
    const re = new RegExp(`\\b(safe_cast|cast)\\s*\\(.*?\\bas\\s+${t}\\b`, "is");
    if (re.test(raw)) {
      throw new Error(
        `Type coercion is not allowed (found CAST/SAFE_CAST to ${t.toUpperCase()}). ` +
        `Only DATE/TIMESTAMP/DATETIME casts are permitted.`
      );
    }
  }

  // If CAST/SAFE_CAST appears, ensure the target is DATE/TIMESTAMP/DATETIME
  const anyCast = /\b(safe_cast|cast)\s*\(/i.test(raw);
  if (anyCast) {
    // Find all targets used by CAST/SAFE_CAST
    const targetRe = /\b(?:safe_cast|cast)\s*\(.*?\bas\s+([a-z0-9_]+)\b/gi;
    let m;
    while ((m = targetRe.exec(raw)) !== null) {
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

  // Optional: if you want to forbid parse_* too (keeps things consistent)
  // if (/\bparse_date\s*\(|\bparse_timestamp\s*\(/i.test(raw)) {
  //   throw new Error("PARSE_DATE/PARSE_TIMESTAMP not allowed; use SAFE_CAST to DATE/TIMESTAMP instead.");
  // }

  // -----------------------------
  // Require queries to reference allowlisted catalog tables (simple POC check)
  // -----------------------------
  const allowed_fqns = CATALOG.map(
    (t) => `\`${t.project}.${t.dataset}.${t.table}\``
  );

  const found_any_allowed = allowed_fqns.some((fqn) => raw.includes(fqn));
  if (!found_any_allowed) {
    throw new Error("Query must reference an allowlisted table (from the catalog).");
  }
}

module.exports = { assert_safe_select };
