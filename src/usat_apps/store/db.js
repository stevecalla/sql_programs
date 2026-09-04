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

// Stream rows one at a time instead of buffering the whole result set — used by the large CSV
// exports so memory stays flat regardless of row count (a full ~700k dump never lands in a Node
// array). Grabs a dedicated pooled connection, runs the query in streaming mode, and invokes
// onRow(row) for each row (onRow may return a promise — awaited, so callers can apply HTTP
// backpressure). On clean completion the connection is released back to the pool; on any error or
// early abort it is destroyed (a half-drained connection must not go back into rotation).
async function stream_rows(sql, params, onRow) {
  const p = await get_pool();
  const conn = await p.getConnection();
  let clean = false;
  try {
    const q = conn.connection.query(sql, params || []);
    const s = q.stream();
    for await (const row of s) { await onRow(row); }
    clean = true;
  } finally {
    if (clean) conn.release(); else conn.destroy();
  }
}

async function end() {
  if (!pool) return;
  const p = pool; pool = null;
  try { await p.end(); } catch (e) { /* already closing/closed */ }
}

module.exports = { get_pool, query, stream_rows, end };
