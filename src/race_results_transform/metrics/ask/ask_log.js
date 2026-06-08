'use strict';
// Audit log of ask questions + answers, stored in MySQL (scalable; not in the repo).
// No PII (analytics is anonymous; questions are admin-typed). Writes use the WRITABLE
// analytics pool (the ask brain's query pool stays read-only). Pool is injectable.
// thread_id groups a conversation (B1); asker_id is a stable per-dashboard-browser id.
const metrics_config = require('../metrics_config');
const { fmt_in_tz } = require('../../../../utilities/analytics/event_ingest');

const TABLE = metrics_config.APP + '_ask_log';   // race_results_transform_ask_log
const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` ('
  + ' id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,'
  + ' created_at_utc DATETIME, created_at_mtn DATETIME,'
  + ' surface VARCHAR(12), provider VARCHAR(24), model VARCHAR(60),'
  + ' thread_id VARCHAR(40), asker_id VARCHAR(40),'
  + ' ok TINYINT(1), row_count INT,'
  + ' question VARCHAR(1000), sql_text TEXT, answer TEXT,'
  + ' INDEX idx_ask_created_mtn (created_at_mtn), INDEX idx_ask_thread (thread_id, id) );';

// Columns added after the table first shipped (server runs ensure_columns with these).
const MIGRATE_COLUMNS = [
  { name: 'thread_id', ddl: 'thread_id VARCHAR(40)', after: 'model' },
  { name: 'asker_id', ddl: 'asker_id VARCHAR(40)', after: 'thread_id' }
];

async function append(pool, e) {
  if (!pool || !e) return;
  try {
    const now = new Date();
    await pool.query(
      'INSERT INTO `' + TABLE + '` (created_at_utc, created_at_mtn, surface, provider, model, thread_id, asker_id, ok, row_count, question, sql_text, answer)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fmt_in_tz(now, 'UTC'), fmt_in_tz(now, metrics_config.REPORTING_TZ),
       e.surface || 'dashboard', e.provider || null, e.model || null,
       e.thread_id ? String(e.thread_id).slice(0, 40) : null, e.asker_id ? String(e.asker_id).slice(0, 40) : null,
       e.ok ? 1 : 0, (e.row_count == null ? null : e.row_count), String(e.question || '').slice(0, 1000),
       e.sql || null, (e.answer == null ? null : String(e.answer).slice(0, 2000))]);
  } catch (err) { /* never throw from logging */ }
}
async function read(pool, n) {
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT created_at_mtn, surface, provider, model, thread_id, asker_id, ok, row_count, question, sql_text, answer FROM `'
      + TABLE + '` ORDER BY id DESC LIMIT ?', [Number(n) || 20]);
    return rows || [];
  } catch (err) { return []; }
}
// One conversation, oldest-first (for context rehydration + transcript display).
async function read_thread(pool, thread_id, n) {
  if (!pool || !thread_id) return [];
  try {
    const [rows] = await pool.query(
      'SELECT created_at_mtn, ok, provider, model, question, sql_text, answer FROM `' + TABLE + '`'
      + ' WHERE thread_id = ? ORDER BY id DESC LIMIT ?', [String(thread_id).slice(0, 40), Number(n) || 8]);
    return (rows || []).reverse();
  } catch (err) { return []; }
}
// Map thread rows -> the history shape ask() expects ([{q, sql, answer}]).
function to_history(rows) {
  return (rows || []).map(function (r) { return { q: r.question, sql: r.sql_text, answer: r.answer }; });
}
module.exports = { append, read, read_thread, to_history, TABLE, DDL, MIGRATE_COLUMNS };
