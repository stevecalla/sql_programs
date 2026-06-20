'use strict';
// G2: operator clarifications/corrections, stored in MySQL and injected into ask
// grounding so future answers honor them. Analytics is anonymous; corrections are
// human notes typed by an authenticated operator. Writable pool is injectable.
const metrics_config = require('../metrics_config');
const { fmt_in_tz } = require('../../../../utilities/analytics/event_ingest');

const TABLE = metrics_config.APP + '_ask_corrections';   // race_results_transform_ask_corrections
const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` ('
  + ' id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,'
  + ' created_at_utc DATETIME, created_at_mtn DATETIME,'
  + ' active TINYINT(1) DEFAULT 1, author VARCHAR(120),'
  + ' question VARCHAR(1000), original_answer TEXT, note TEXT,'
  + ' INDEX idx_corr_active (active, id) );';

async function append(pool, e) {
  if (!pool || !e || !e.note) return null;
  const now = new Date();
  const [r] = await pool.query(
    'INSERT INTO `' + TABLE + '` (created_at_utc, created_at_mtn, active, author, question, original_answer, note) VALUES (?,?,1,?,?,?,?)',
    [fmt_in_tz(now, 'UTC'), fmt_in_tz(now, metrics_config.REPORTING_TZ), e.author || null,
     String(e.question || '').slice(0, 1000), e.original_answer == null ? null : String(e.original_answer).slice(0, 2000),
     String(e.note).slice(0, 2000)]);
  return r && r.insertId;
}
async function read(pool, n, active_only) {
  if (!pool) return [];
  try {
    const where = active_only === false ? '' : ' WHERE active=1';
    const [rows] = await pool.query('SELECT id, created_at_mtn, active, author, question, original_answer, note FROM `'
      + TABLE + '`' + where + ' ORDER BY id DESC LIMIT ?', [Number(n) || 20]);
    return rows || [];
  } catch (e) { return []; }
}
async function set_active(pool, id, active) {
  if (!pool) return;
  try { await pool.query('UPDATE `' + TABLE + '` SET active=? WHERE id=?', [active ? 1 : 0, Number(id)]); } catch (e) { /* ignore */ }
}
// Compact recent ACTIVE corrections into a grounding string (or null if none).
async function grounding_text(pool, n) {
  const rows = await read(pool, Number(n) || 12, true);
  if (!rows.length) return null;
  return rows.map(function (r) {
    const q = r.question ? ' (re: "' + String(r.question).replace(/\s+/g, ' ').trim().slice(0, 120) + '")' : '';
    return '- ' + String(r.note).replace(/\s+/g, ' ').trim().slice(0, 300) + q;
  }).join('\n');
}
module.exports = { append, read, set_active, grounding_text, TABLE, DDL };
