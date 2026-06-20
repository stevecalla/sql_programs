'use strict';
// Hardened, READ-ONLY SQL guard for the ask brain (metrics/ASK_DESIGN.md §7).
//
// The model is instructed it is read-only; this is the ENFORCEMENT layer (defense in
// depth over a read-only DB user). A query passes ONLY if it is a single SELECT/WITH
// over allowlisted tables. Comments and string literals are stripped before scanning so
// a blocked keyword can't hide inside `-- ...`, `/* ... */`, or a quoted string.
const { ALLOWED_TABLES } = require('./db');

const DEFAULT_MAX_LIMIT = 1000;

// Statement / DDL / admin / dynamic-exec / DoS keywords that must never appear.
// (REPLACE/transaction words omitted on purpose: REPLACE() is a legit string function,
//  and a read-only SELECT can't transact anyway — avoids false positives on aliases.)
const BLOCKED = ['insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter',
  'truncate', 'grant', 'revoke', 'rename', 'call', 'do', 'load', 'set', 'handler',
  'prepare', 'execute', 'deallocate', 'lock', 'unlock', 'into', 'outfile', 'dumpfile',
  'load_file', 'sleep', 'benchmark'];

function strip_comments_and_strings(sql) {
  let s = String(sql || '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');     // /* block comments */
  s = s.replace(/--[^\n]*/g, ' ');             // -- line comments
  s = s.replace(/#[^\n]*/g, ' ');              // # line comments (MySQL)
  s = s.replace(/'(?:\\.|''|[^'])*'/g, "''");  // single-quoted literals
  s = s.replace(/"(?:\\.|""|[^"])*"/g, '""');  // double-quoted literals
  return s;
}

// base tables referenced by FROM/JOIN (subqueries and CTE names handled separately)
function referenced_tables(scan) {
  const out = [], re = /\b(?:from|join)\s+(\(|`?[A-Za-z0-9_$.]+`?)/gi;
  let m;
  while ((m = re.exec(scan)) !== null) {
    if (m[1] === '(') continue;                       // subquery, not a base table
    out.push(m[1].replace(/`/g, '').split('.').pop().toLowerCase());
  }
  return out;
}

function cte_names(scan) {
  const out = [], re = /(?:\bwith|,)\s+([A-Za-z0-9_]+)\s+as\s*\(/gi;
  let m;
  while ((m = re.exec(scan)) !== null) out.push(m[1].toLowerCase());
  return out;
}

// Returns a SAFE sql string (with a LIMIT enforced) or throws with a clear reason.
function assert_safe_select(sql, opts) {
  opts = opts || {};
  const max_limit = opts.max_limit || DEFAULT_MAX_LIMIT;
  const allow = (opts.allowed_tables || ALLOWED_TABLES).map(function (t) { return String(t).toLowerCase(); });

  let raw = String(sql || '').trim();
  if (!raw) throw new Error('Empty query.');
  raw = raw.replace(/;\s*$/, '');                      // allow one trailing semicolon
  const scan = strip_comments_and_strings(raw);
  if (scan.indexOf(';') >= 0) throw new Error('Only a single statement is allowed.');

  const lower = scan.trim().toLowerCase();
  if (lower.indexOf('select') !== 0 && lower.indexOf('with') !== 0) {
    throw new Error('Read-only: only SELECT / WITH queries are allowed.');
  }
  for (const kw of BLOCKED) {
    if (new RegExp('\\b' + kw + '\\b', 'i').test(scan)) {
      throw new Error('Read-only: blocked keyword "' + kw + '" is not permitted.');
    }
  }

  const ctes = cte_names(scan), refs = referenced_tables(scan);
  if (refs.length === 0) throw new Error('Query must read from an allowlisted table.');
  for (const t of refs) {
    if (allow.indexOf(t) < 0 && ctes.indexOf(t) < 0) {
      throw new Error('Table not allowed: "' + t + '". Allowed: ' + allow.join(', ') + '.');
    }
  }

  // ---- enforce a row cap ----
  const lim = scan.match(/\blimit\s+(\d+)\b/i);
  if (!lim) {
    raw = raw + ' LIMIT ' + max_limit;                 // inject when absent
  } else if (Number(lim[1]) > max_limit) {
    raw = raw.replace(/\blimit\s+\d+\b/i, 'LIMIT ' + max_limit);  // clamp when too large
  }
  return raw;
}

module.exports = { assert_safe_select, strip_comments_and_strings, DEFAULT_MAX_LIMIT };