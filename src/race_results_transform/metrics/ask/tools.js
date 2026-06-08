'use strict';
// MySQL tools for the ask brain. READ ONLY. Pool is injectable (opts.pool) for tests.
const { get_pool, CATALOG, ALLOWED_TABLES, is_allowed_table } = require('./db');
const { assert_safe_select, DEFAULT_MAX_LIMIT } = require('./sql_guard');

function list_tables() { return CATALOG; }

async function get_schema_text(table, opts) {
  opts = opts || {};
  table = table || ALLOWED_TABLES[0];
  if (!is_allowed_table(table)) throw new Error('Table not allowed: ' + table);
  const pool = opts.pool || await get_pool();
  const [cols] = await pool.query(
    'SELECT column_name, data_type, column_comment FROM information_schema.columns '
    + 'WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [table]);
  const lines = (cols || []).map(function (r) {
    const name = r.column_name || r.COLUMN_NAME;
    const type = r.data_type || r.DATA_TYPE;
    const cmt = r.column_comment || r.COLUMN_COMMENT;
    return '  - ' + name + ' ' + type + (cmt ? '  -- ' + cmt : '');
  });
  return 'Table `' + table + '` columns:\n' + lines.join('\n');
}

async function run_query(sql, opts) {
  opts = opts || {};
  const max_limit = opts.max_limit || DEFAULT_MAX_LIMIT;
  const safe = assert_safe_select(sql, { max_limit: max_limit });   // guards: read-only + allowlist + LIMIT
  const pool = opts.pool || await get_pool();
  const [rows] = await pool.query(safe);
  const arr = Array.isArray(rows) ? rows : [];
  return { sql: safe, rows: arr.slice(0, max_limit), row_count: arr.length, truncated: arr.length >= max_limit };
}

module.exports = { list_tables, get_schema_text, run_query };
