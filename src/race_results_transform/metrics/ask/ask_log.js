'use strict';
// Audit log of ask questions + answers, stored in MySQL (scalable; not in the repo).
// No PII (analytics is anonymous; questions are admin-typed). Writes use the WRITABLE
// analytics pool (the ask brain's query pool stays read-only). Pool is injectable.
const metrics_config = require('../metrics_config');
const { fmt_in_tz } = require('../../../../utilities/analytics/event_ingest');

const TABLE = metrics_config.APP + '_ask_log';   // race_results_transform_ask_log
const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` ('
  + ' id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,'
  + ' created_at_utc DATETIME, created_at_mtn DATETIME,'
  + ' surface VARCHAR(12), provider VARCHAR(24), model VARCHAR(60),'
  + ' ok TINYINT(1), row_count INT,'
  + ' question VARCHAR(1000), sql_text TEXT, answer TEXT,'
  + ' INDEX idx_ask_created_mtn (created_at_mtn) );';

async function append(pool, e) {
  if (!pool || !e) return;
  try {
    const now = new Date();
    await pool.query(
      'INSERT INTO `' + TABLE + '` (created_at_utc, created_at_mtn, surface, provider, model, ok, row_count, question, sql_text, answer)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fmt_in_tz(now, 'UTC'), fmt_in_tz(now, metrics_config.REPORTING_TZ),
       e.surface || 'dashboard', e.provider || null, e.model || null, e.ok ? 1 : 0,
       (e.row_count == null ? null : e.row_count), String(e.question || '').slice(0, 1000),
       e.sql || null, (e.answer == null ? null : String(e.answer).slice(0, 2000))]);
  } catch (err) { /* never throw from logging */ }
}
async function read(pool, n) {
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT created_at_mtn, surface, provider, model, ok, row_count, question, sql_text, answer FROM `'
      + TABLE + '` ORDER BY id DESC LIMIT ?', [Number(n) || 20]);
    return rows || [];
  } catch (err) { return []; }
}
module.exports = { append, read, TABLE, DDL };
