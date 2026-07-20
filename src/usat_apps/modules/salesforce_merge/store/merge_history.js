'use strict';
// Merge history — one row per processed queue entry (audit + the link from a queue entry to what
// actually happened). Records the environment + org id the run targeted, whether a snapshot was
// saved, and the result (simulated / done / failed / skipped). `query` injectable for tests.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'salesforce_merge_history';

// Self-documenting column (visible in SELECT *) so future readers know what this table is for.
const PURPOSE = 'Immutable audit trail: one row per processed set per run — the outcome '
  + '(simulated/done/failed/skipped/restored/recreated), the human-readable reason, snapshot flag, '
  + 'environment/org, and the field-level diff (diff_json: merge drift, or restore/recreate reset+kept).';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
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
  ' master_rule VARCHAR(60),' +
  ' diff_json LONGTEXT,' +                        // field-level audit: what drifted (merge) / was reset+kept (restore)
  ' dossier_id INT NULL,' +                       // FK-ish: salesforce_merge_dossier.id (the DB copy of the .xlsx)
  ' dossier_doc_id VARCHAR(32) NULL,' +           // Salesforce ContentDocumentId of the attached dossier file
  ' created_at_mtn DATETIME NULL,' +              // Denver wall-clock, written by the app (event-table convention)
  ' created_at_utc DATETIME NULL' +               // UTC wall-clock, written by the app
  ')';

const COLS = 'id, created_at, run_id, queue_id, created_by, source_type, source_key, survivor_account, ' +
  'survivor_name, loser_count, child_total, environment, org_id, snapshot_saved, result, mode, reason, master_rule, ' +
  "diff_json, dossier_id, dossier_doc_id, DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn, created_at_utc";

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query("ALTER TABLE `" + TABLE + "` ADD COLUMN purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'", []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN mode VARCHAR(16)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN diff_json LONGTEXT', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN dossier_id INT NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN dossier_doc_id VARCHAR(32) NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  _ensured = true;
}

async function write(row, query = real_query) {
  await ensure_table(query);
  const ts = now_mtn_utc();
  const diffJson = (row.diff != null) ? (() => { try { return JSON.stringify(row.diff); } catch (e) { return null; } })() : null;
  const res = await query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, created_by, source_type, source_key, survivor_account, ' +
    'survivor_name, loser_count, child_total, environment, org_id, snapshot_saved, result, mode, reason, master_rule, ' +
    'diff_json, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(row.run_id || ''), row.queue_id != null ? Number(row.queue_id) : null, row.created_by || null,
     row.source_type || null, String(row.source_key || ''), row.survivor_account || null, row.survivor_name || null,
     row.loser_count != null ? Number(row.loser_count) : null, row.child_total != null ? Number(row.child_total) : null,
     row.environment || null, row.org_id || null, row.snapshot_saved ? 1 : 0,
     String(row.result || 'simulated'), row.mode || null, row.reason || null, row.master_rule || null, diffJson, ts.mtn, ts.utc]);
  return { id: (res && res.insertId) || null };
}

const parseRow = (r) => ({ ...r, diff: (() => { try { return r.diff_json ? JSON.parse(r.diff_json) : null; } catch (e) { return null; } })() });

async function list(opts = {}, query = real_query) {
  await ensure_table(query);
  const n = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 1000);
  const where = []; const params = [];
  if (opts.result) { where.push('result = ?'); params.push(String(opts.result)); }
  if (opts.mode) { where.push('mode = ?'); params.push(String(opts.mode)); }
  if (opts.q && String(opts.q).trim()) {
    const like = '%' + String(opts.q).trim() + '%';
    where.push('(survivor_name LIKE ? OR survivor_account LIKE ? OR source_key LIKE ?)');
    params.push(like, like, like);
  }
  const sql = 'SELECT ' + COLS
    + ', (SELECT IF(COUNT(*) >= 2, MAX(u.api_used) - MIN(u.api_used), NULL) FROM `salesforce_merge_api_usage` u WHERE u.run_id = `' + TABLE + '`.run_id) AS api_cost'
    + ', (SELECT IF(COUNT(*) >= 2, MAX(u.apex_used) - MIN(u.apex_used), NULL) FROM `salesforce_merge_api_usage` u WHERE u.run_id = `' + TABLE + '`.run_id) AS apex_cost'
    // job_id links each per-account row to its run-level Job history row (the run table carries it; this
    // table doesn't). Null for single, non-fanned runs (those group under their run_id in Job history).
    + ', (SELECT r.job_id FROM `salesforce_merge_run` r WHERE r.run_id = `' + TABLE + '`.run_id LIMIT 1) AS job_id'
    + ' FROM `' + TABLE + '`' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + n;
  const rows = await query(sql, params);
  return (rows || []).map(parseRow);
}

// Link a generated dossier (DB copy id + Salesforce ContentDocumentId) onto a history row. Best-effort.
async function set_dossier(historyId, dossierId, docId, query = real_query) {
  await ensure_table(query);
  if (historyId == null) return { updated: 0 };
  const res = await query('UPDATE `' + TABLE + '` SET dossier_id = ?, dossier_doc_id = ? WHERE id = ?',
    [dossierId != null ? Number(dossierId) : null, docId || null, Number(historyId)]);
  return { updated: (res && (res.affectedRows != null ? res.affectedRows : 0)) || 0 };
}

// Every history row for one queue entry, oldest first (the entry's lifecycle: simulate → done →
// restored/recreated). Used by the dossier builder to embed the full audit trail of a set.
async function list_for_entry(queueId, query = real_query) {
  await ensure_table(query);
  if (queueId == null) return [];
  const rows = await query('SELECT ' + COLS + ' FROM `' + TABLE + '` WHERE queue_id = ? ORDER BY id ASC', [Number(queueId)]);
  return (rows || []).map(parseRow);
}

// Keep only the latest simulate row per entry: clear prior 'simulated' rows for a queue entry.
async function clear_simulated(queueId, query = real_query) {
  await ensure_table(query);
  if (queueId == null) return { cleared: 0 };
  const res = await query('DELETE FROM `' + TABLE + "` WHERE queue_id = ? AND result = 'simulated'", [Number(queueId)]);
  return { cleared: (res && (res.affectedRows != null ? res.affectedRows : 0)) || 0 };
}

module.exports = { write, list, list_for_entry, set_dossier, clear_simulated, ensure_table, TABLE, DDL };
