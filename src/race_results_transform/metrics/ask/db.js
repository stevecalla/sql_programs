'use strict';
// Read-only MySQL access for the "ask your data" brain (metrics/ASK_DESIGN.md).
//
// READ ONLY. Nothing in the ask/ module ever writes. v1 reuses the existing local
// analytics credentials, but PREFERS a dedicated read-only user if ASK_DB_* is set
// (see ASK_DESIGN.md §16A — creating that user is the recommended hardening step).
// The model is told it is read-only; sql_guard.js enforces it; a read-only DB user
// is the third, strongest layer.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../../utilities/config');
const metrics_config = require('../metrics_config');

// Allowlist of tables the bot may read. v1 = just the usage-events table. Expand
// deliberately (ASK_DESIGN.md §16G); sql_guard.js rejects anything off this list.
const CATALOG = [
  {
    name: metrics_config.TABLE,            // race_results_transform_events
    grain: 'one row per usage event',
    description: 'Anonymous usage-analytics events for the race-results converter web app '
      + '(page views, uploads, conversions, downloads, splits, remaps, errors). '
      + 'No PII; visitor_id is an anonymous per-browser id.'
  }
];
const ALLOWED_TABLES = CATALOG.map(function (t) { return t.name; });

let _pool = null;
async function get_pool() {
  if (_pool) return _pool;
  let cfg;
  if (process.env.ASK_DB_USER) {
    // dedicated read-only credentials (recommended; see ASK_DESIGN.md §16A)
    cfg = {
      host: process.env.ASK_DB_HOST || 'localhost',
      port: Number(process.env.ASK_DB_PORT) || 3306,
      user: process.env.ASK_DB_USER,
      password: process.env.ASK_DB_PASSWORD,
      database: process.env.ASK_DB_NAME,
      connectionLimit: 4
    };
  } else {
    // fall back to the existing local analytics config (read-only stressed to the model)
    cfg = Object.assign({}, await local_usat_sales_db_config(), { connectionLimit: 4 });
  }
  _pool = mysql.createPool(cfg);
  return _pool;
}
async function close_pool() { if (_pool) { await _pool.end(); _pool = null; } }

function is_allowed_table(name) {
  return ALLOWED_TABLES.indexOf(String(name)) >= 0;
}

module.exports = { get_pool, close_pool, CATALOG, ALLOWED_TABLES, is_allowed_table };
