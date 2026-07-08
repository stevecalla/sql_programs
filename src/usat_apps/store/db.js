'use strict';
// Read-only MySQL access for the usat_apps platform. Reuses the repo's shared local DB config
// (utilities/config -> local_usat_sales_db_config) so it points at the same usat_sales_db the
// rest of the pipeline uses. One lazily-created pool. Copied from src/reporting/store/db.js.
const mysql = require('mysql2/promise');

let pool = null;

async function get_pool() {
  if (pool) return pool;
  // Required lazily (only on the first DB call) so loading this module can never block server
  // startup or the auth/login/status paths, which don't touch the database.
  const { local_usat_sales_db_config } = require('../../../utilities/config');
  const cfg = await local_usat_sales_db_config();
  pool = mysql.createPool(cfg);
  return pool;
}

async function query(sql, params) {
  const p = await get_pool();
  const [rows] = await p.query(sql, params || []);
  return rows;
}

async function end() {
  if (!pool) return;
  const p = pool; pool = null;
  try { await p.end(); } catch (e) { /* already closing/closed */ }
}

module.exports = { get_pool, query, end };
