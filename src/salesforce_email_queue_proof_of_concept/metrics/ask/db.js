'use strict';
// Read-only MySQL access for the email-queue "ask your data" brain. Mirrors
// race_results_transform/metrics/ask/db.js.
//
// READ ONLY. Nothing in ask/ ever writes. Prefers a dedicated read-only user if ASK_DB_* is set
// (recommended hardening); otherwise reuses the local analytics credentials. Three layers protect
// the DB: the model is told it is read-only, sql_guard.js enforces it, and (ideally) a read-only DB user.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../../utilities/config');
const metrics_config = require('../metrics_config');

// Allowlist of tables the bot may read = just the email-queue usage-events table. sql_guard rejects others.
const CATALOG = [
  {
    name: metrics_config.TABLE,            // salesforce_email_queue_events
    grain: 'one row per usage event',
    description: 'Usage-analytics events for the Salesforce Email Queue Assistant (read-only POC): '
      + 'page views, queue/thread opens, AI calls (respond/ask/acknowledge/triage with provider, '
      + 'verdict, latency, success), attachment views, corrections, context changes, SOQL runs, errors. '
      + 'No member PII — actor is the staff operator username; queue is the Salesforce queue name.'
  }
];
const ALLOWED_TABLES = CATALOG.map(function (t) { return t.name; });

let _pool = null;
async function get_pool() {
  if (_pool) return _pool;
  let cfg;
  if (process.env.ASK_DB_USER) {
    cfg = { host: process.env.ASK_DB_HOST || 'localhost', port: Number(process.env.ASK_DB_PORT) || 3306,
      user: process.env.ASK_DB_USER, password: process.env.ASK_DB_PASSWORD, database: process.env.ASK_DB_NAME, connectionLimit: 4 };
  } else {
    cfg = Object.assign({}, await local_usat_sales_db_config(), { connectionLimit: 4 });
  }
  _pool = mysql.createPool(cfg);
  return _pool;
}
async function close_pool() { if (_pool) { await _pool.end(); _pool = null; } }
function is_allowed_table(name) { return ALLOWED_TABLES.indexOf(String(name)) >= 0; }

module.exports = { get_pool, close_pool, CATALOG, ALLOWED_TABLES, is_allowed_table };
