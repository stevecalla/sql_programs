'use strict';
// submission_history.js — NON-PII audit log of COI submission RUNS. One row per run (one click of Start).
// Recorded 'queued' at submit, flips to 'in_progress' when a browser picks it up, its counts are updated
// after each certificate, and its status is finalized when the run ends. NEVER stores holder data — the
// CSR24 portal is the system of record. Mirrors codebase conventions: self-documenting `purpose` column,
// idempotent ensure_table, injectable `query`, shared store/db, created_at_* as the last two columns.
//
// Status lifecycle + the human-readable meaning stored per row in `status_description`:
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'event_coi_submission_history';

const STATUS_DESC = {
  queued: 'Submitted; waiting for a free browser',
  in_progress: 'Running through the batch',
  complete: 'Ran through the full batch',
  stopped: 'Stopped by the user',
  timed_out: 'Approval gate expired; run abandoned',
  crashed: 'The run errored out',
  server_restart: 'Ended by a server restart',
};
function desc(status) { return STATUS_DESC[status] || String(status || ''); }

const PURPOSE = 'Non-PII audit log of Event/Race COI submission runs: one row per run (ran_by / event / '
  + 'timing / counts / status). Status queued->in_progress->complete/stopped/timed_out/crashed/'
  + 'server_restart; status_description holds the plain-English meaning. No holder/COI data is ever stored.';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' ran_by VARCHAR(120),' +
  ' event_name VARCHAR(255),' +
  ' event_sanction_id VARCHAR(10),' +
  ' certificates_requested INT NOT NULL DEFAULT 0,' +
  ' certificates_submitted INT NOT NULL DEFAULT 0,' +
  ' certificates_failed INT NOT NULL DEFAULT 0,' +
  ' certificates_skipped INT NOT NULL DEFAULT 0,' +
  ' status VARCHAR(16) NOT NULL DEFAULT "queued",' +
  ' status_description VARCHAR(120),' +
  ' started_at_mtn DATETIME NULL,' +
  ' finished_at_mtn DATETIME NULL,' +
  ' created_at_mtn DATETIME NULL,' +
  ' created_at_utc DATETIME NULL,' +
  ' INDEX idx_status (status),' +
  ' INDEX idx_started (started_at_mtn)' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  // Always run the (idempotent) CREATE TABLE IF NOT EXISTS so the table is recreated if it was ever
  // dropped — a submission must never fail to record for lack of a table. The one-time column
  // migrations below stay gated behind _ensured so they don't re-run on every call.
  await query(DDL, []);
  if (_ensured) return;
  const adds = [
    'ran_by VARCHAR(120)', 'event_name VARCHAR(255)', 'event_sanction_id VARCHAR(10)',
    'certificates_requested INT NOT NULL DEFAULT 0', 'certificates_submitted INT NOT NULL DEFAULT 0',
    'certificates_failed INT NOT NULL DEFAULT 0', 'certificates_skipped INT NOT NULL DEFAULT 0',
    'status VARCHAR(16) NOT NULL DEFAULT "queued"', 'status_description VARCHAR(120)',
    'started_at_mtn DATETIME NULL', 'finished_at_mtn DATETIME NULL',
  ];
  for (const col of adds) { try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN ' + col, []); } catch (e) { /* exists */ } }
  _ensured = true;
}

// Record a run at submit time (waiting for a browser). job = { ran_by, event_name, event_sanction_id,
// certificates_requested }. Returns { id }.
async function record_queued(job, query = real_query) {
  await ensure_table(query);
  job = job || {};
  const ts = now_mtn_utc();
  const res = await query(
    'INSERT INTO `' + TABLE + '` (ran_by, event_name, event_sanction_id, certificates_requested, status, ' +
    'status_description, started_at_mtn, finished_at_mtn, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, "queued", ?, NULL, NULL, ?, ?)',
    [job.ran_by || null, job.event_name || null, job.event_sanction_id || null,
     Number(job.certificates_requested) || 0, desc('queued'), ts.mtn, ts.utc]);
  return { id: (res && res.insertId) || null };
}

// A browser picked the run up.
async function mark_in_progress(id, query = real_query) {
  if (id == null) return;
  const ts = now_mtn_utc();
  await query('UPDATE `' + TABLE + '` SET status = "in_progress", status_description = ?, ' +
    'started_at_mtn = COALESCE(started_at_mtn, ?) WHERE id = ? AND status = "queued"', [desc('in_progress'), ts.mtn, Number(id)]);
}

// Live count refresh after each certificate. counts = { submitted, failed, skipped }.
async function update_counts(id, counts, query = real_query) {
  if (id == null) return;
  counts = counts || {};
  await query('UPDATE `' + TABLE + '` SET certificates_submitted = ?, certificates_failed = ?, ' +
    'certificates_skipped = ? WHERE id = ?',
    [Number(counts.submitted) || 0, Number(counts.failed) || 0, Number(counts.skipped) || 0, Number(id)]);
}

// Finalize the run. outcome = { status, submitted, failed, skipped }.
async function record_finish(id, outcome, query = real_query) {
  if (id == null) return;
  outcome = outcome || {};
  const st = outcome.status || 'complete';
  const ts = now_mtn_utc();
  await query('UPDATE `' + TABLE + '` SET status = ?, status_description = ?, certificates_submitted = ?, ' +
    'certificates_failed = ?, certificates_skipped = ?, finished_at_mtn = ? WHERE id = ?',
    [st, desc(st), Number(outcome.submitted) || 0, Number(outcome.failed) || 0, Number(outcome.skipped) || 0, ts.mtn, Number(id)]);
}

// On backend startup, mark rows a prior restart stranded (queued or in_progress) as server_restart.
async function mark_server_restart(query = real_query) {
  await ensure_table(query);
  const ts = now_mtn_utc();
  const res = await query('UPDATE `' + TABLE + '` SET status = "server_restart", status_description = ?, ' +
    'finished_at_mtn = COALESCE(finished_at_mtn, ?) WHERE status IN ("queued", "in_progress")', [desc('server_restart'), ts.mtn]);
  return { reset: (res && res.affectedRows) || 0 };
}

async function recent(limit, query = real_query) {
  await ensure_table(query);
  const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
  const rows = await query(
    'SELECT id, started_at_mtn, event_name, event_sanction_id, ran_by, certificates_requested, ' +
    'certificates_submitted, certificates_failed, certificates_skipped, status, status_description ' +
    'FROM `' + TABLE + '` ORDER BY started_at_mtn DESC, id DESC LIMIT ' + n, []);
  return rows || [];
}

async function counts_by_status(query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT status, COUNT(*) AS runs FROM `' + TABLE + '` GROUP BY status WITH ROLLUP', []);
  return (rows || []).map((r) => ({ status: r.status == null ? 'TOTAL' : String(r.status), runs: Number(r.runs) || 0 }));
}

module.exports = {
  TABLE, DDL, STATUS_DESC, desc, ensure_table, record_queued, mark_in_progress, update_counts,
  record_finish, mark_server_restart, recent, counts_by_status,
};
