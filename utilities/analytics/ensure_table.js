'use strict';
// Generic analytics core — run a `CREATE TABLE IF NOT EXISTS` DDL once.
// Reusable by any analytics page; pass a mysql2/promise pool + the DDL string.
async function ensure_table(pool, ddl) {
  await pool.query(ddl);
}
module.exports = { ensure_table };
