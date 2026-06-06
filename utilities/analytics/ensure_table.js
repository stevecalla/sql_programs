'use strict';
// Generic analytics core — run a `CREATE TABLE IF NOT EXISTS` DDL once.
// Reusable by any analytics page; pass a mysql2/promise pool + the DDL string.
async function ensure_table(pool, ddl) {
  await pool.query(ddl);
}

// Idempotently add any missing columns to an already-created table. `CREATE TABLE
// IF NOT EXISTS` never alters an existing table, so new columns added to the DDL
// won't appear on tables that already exist. Pass the column defs you need; we look
// up information_schema and only ALTER for the ones that are missing.
//   defs: [{ name: 'page_path', ddl: 'page_path VARCHAR(255)', after: 'event_name' }]
async function ensure_columns(pool, table, defs) {
  if (!defs || !defs.length) return;
  const [rows] = await pool.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table]
  );
  const have = {};
  rows.forEach(function (r) { have[(r.COLUMN_NAME || r.column_name)] = true; });
  for (const d of defs) {
    if (have[d.name]) continue;
    const after = d.after ? ' AFTER `' + d.after + '`' : '';
    await pool.query('ALTER TABLE `' + table + '` ADD COLUMN ' + d.ddl + after);
  }
}

module.exports = { ensure_table, ensure_columns };
