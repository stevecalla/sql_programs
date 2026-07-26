'use strict';
// submission_history.js — NON-PII audit log of COI submission RUNS. One row per run (one click of Start):
// who ran it, when, which event, and the outcome counts (requested/submitted/failed/skipped) + status.
// It NEVER stores holder data (names/addresses/emails/coverage/screenshots) — the tool is a pass-through
// and the CSR24 portal is the system of record. Written 'running' at launch, updated when the run ends.
// Mirrors codebase conventions: self-documenting `purpose` column, idempotent ensure_table, injectable
// `query` (for tests), shared store/db pool, created_at_* as the last two columns.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'event_coi_submission_history';

const PURPOSE = 'Non-PII audit log of Event/Race COI submission runs: one row per run (one Start) with '
  + 'ran_by / event / timing and counts (requested, submitted, failed, skipped) + status '
  + '(running->completed/partial/failed/cancelled/interrupted). No holder/COI data is ever stored.';

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
  ' status VARCHAR(16) NOT NULL DEFAULT "running",' +
  ' started_at DATETIME NULL,' +
  ' finished_at DATETIME NULL,' +
  ' created_at_mtn DATETIME NULL,' +
  ' created_at_utc DATETIME NULL,' +
  ' INDEX idx_status (status),' +
  ' INDEX idx_started (started_at)' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  const adds = [
    'ran_by VARCHAR(120)', 'event_name VARCHAR(255)', 'event_sanction_id VARCHAR(10)',
    'certificates_requested INT NOT NULL DEFAULT 0', 'certificates_submitted INT NOT NULL DEFAULT 0',
    'certificates_failed INT NOT NULL DEFAULT 0', 'certificates_skipped INT NOT NULL DEFAULT 0',
    'status VARCHAR(16) NOT NULL DEFAULT "running"', 'started_at DATETIME NULL', 'finished_at DATETIME NULL',
  ];
  for (const col of adds) { try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN ' + col, []); } catch (e) { /* exists */ } }
  _ensured = true;
}

// Insert a run at launch. job = { ran_by, event_name, event_sanction_id, certificates_requested }.
// Returns { id }.
async function record_start(job, query = real_query) {
  await ensure_table(query);
  job = job || {};
  const ts = now_mtn_utc();
  const res = await query(
    'INSERT INTO `' + TABLE + '` (ran_by, event_name, event_sanction_id, certificates_requested, status, ' +
    'started_at, finished_at, created_at_mtn, created_at_utc) VALUES (?, ?, ?, ?, "running", NOW(), NULL, ?, ?)',
    [job.ran_by || null, job.event_name || null, job.event_sanction_id || null,
     Number(job.certificates_requested) || 0, ts.mtn, ts.utc]);
  return { id: (res && res.insertId) || null };
}

// Update the run when it ends. outcome = { status, submitted, failed, skipped }.
async function record_finish(id, outcome, query = real_query) {
  if (id == null) return;
  outcome = outcome || {};
  await query(
    'UPDATE `' + TABLE + '` SET status = ?, certificates_submitted = ?, certificates_failed = ?, ' +
    'certificates_skipped = ?, finished_at = NOW() WHERE id = ?',
    [outcome.status || 'completed', Number(outcome.submitted) || 0, Number(outcome.failed) || 0,
     Number(outcome.skipped) || 0, Number(id)]);
}

// On backend startup, clear rows stranded 'running' by a prior restart (an in-memory run can't survive
// one). Returns { interrupted }.
async function mark_interrupted(query = real_query) {
  await ensure_table(query);
  const res = await query('UPDATE `' + TABLE + '` SET status = "interrupted", finished_at = COALESCE(finished_at, NOW()) WHERE status = "running"', []);
  return { interrupted: (res && res.affectedRows) || 0 };
}

// Most recent runs (newest first).
async function recent(limit, query = real_query) {
  await ensure_table(query);
  const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
  const rows = await query(
    'SELECT id, started_at, event_name, event_sanction_id, ran_by, certificates_requested, ' +
    'certificates_submitted, certificates_failed, certificates_skipped, status ' +
    'FROM `' + TABLE + '` ORDER BY started_at DESC, id DESC LIMIT ' + n, []);
  return rows || [];
}

// Counts by status + grand total (WITH ROLLUP -> the rollup row has status NULL).
async function counts_by_status(query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT status, COUNT(*) AS runs FROM `' + TABLE + '` GROUP BY status WITH ROLLUP', []);
  return (rows || []).map((r) => ({ status: r.status == null ? 'TOTAL' : String(r.status), runs: Number(r.runs) || 0 }));
}

module.exports = { TABLE, DDL, ensure_table, record_start, record_finish, mark_interrupted, recent, counts_by_status };
