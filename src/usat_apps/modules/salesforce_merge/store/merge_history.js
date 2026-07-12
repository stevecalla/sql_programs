'use strict';
// Merge history — one row per processed queue entry (audit + the link from a queue entry to what
// actually happened). Records the environment + org id the run targeted, whether a snapshot was
// saved, and the result (simulated / done / failed / skipped). `query` injectable for tests.
const { query: real_query } = require('../../../store/db');

const TABLE = 'salesforce_merge_history';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' run_id VARCHAR(64) NOT NULL,' +
  ' queue_id INT,' +
  ' created_by VARCHAR(120),' +
  ' source_type VARCHAR(24),' +
  ' source_key TEXT,' +
  ' survivor_account VARCHAR(32),' +
  ' survivor_name VARCHAR(255),' +
  ' loser_count INT,' +
  ' child_total INT,' +
  ' environment VARCHAR(20),' +
  ' org_id VARCHAR(32),' +
  ' snapshot_saved TINYINT NOT NULL DEFAULT 0,' +
  ' result VARCHAR(20) NOT NULL,' +
  ' mode VARCHAR(16),' +
  ' reason TEXT,' +
  ' master_rule VARCHAR(60)' +
  ')';

const COLS = 'id, created_at, run_id, queue_id, created_by, source_type, source_key, survivor_account, ' +
  'survivor_name, loser_count, child_total, environment, org_id, snapshot_saved, result, mode, reason, master_rule';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN mode VARCHAR(16)', []); } catch (e) { /* exists */ }
  _ensured = true;
}

async function write(row, query = real_query) {
  await ensure_table(query);
  const res = await query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, created_by, source_type, source_key, survivor_account, ' +
    'survivor_name, loser_count, child_total, environment, org_id, snapshot_saved, result, mode, reason, master_rule) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(row.run_id || ''), row.queue_id != null ? Number(row.queue_id) : null, row.created_by || null,
     row.source_type || null, String(row.source_key || ''), row.survivor_account || null, row.survivor_name || null,
     row.loser_count != null ? Number(row.loser_count) : null, row.child_total != null ? Number(row.child_total) : null,
     row.environment || null, row.org_id || null, row.snapshot_saved ? 1 : 0,
     String(row.result || 'simulated'), row.mode || null, row.reason || null, row.master_rule || null]);
  return { id: (res && res.insertId) || null };
}

async function list(opts = {}, query = real_query) {
  await ensure_table(query);
  const n = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 1000);
  const rows = await query('SELECT ' + COLS + ' FROM `' + TABLE + '` ORDER BY id DESC LIMIT ' + n, []);
  return rows || [];
}

// Keep only the latest simulate row per entry: clear prior 'simulated' rows for a queue entry.
async function clear_simulated(queueId, query = real_query) {
  await ensure_table(query);
  if (queueId == null) return { cleared: 0 };
  const res = await query('DELETE FROM `' + TABLE + "` WHERE queue_id = ? AND result = 'simulated'", [Number(queueId)]);
  return { cleared: (res && (res.affectedRows != null ? res.affectedRows : 0)) || 0 };
}

module.exports = { write, list, clear_simulated, ensure_table, TABLE, DDL };
