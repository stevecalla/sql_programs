'use strict';
// Phase 3b/4 — run-progress record so the UI can show a live progress bar + elapsed timer + ETA
// while a merge/restore runs server-side (sequential calls). One row per run, updated as each call
// completes. `query` injectable for tests. Read-only of Salesforce — this only tracks our own run.
const { query: real_query } = require('../../../store/db');

const TABLE = 'salesforce_merge_run';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' run_id VARCHAR(64) PRIMARY KEY,' +
  ' kind VARCHAR(16) NOT NULL,' +                 // 'merge' | 'restore'
  ' mode VARCHAR(16) NOT NULL,' +                 // 'simulate' | 'execute'
  ' environment VARCHAR(24),' +
  ' org_id VARCHAR(32),' +
  ' total_ops INT DEFAULT 0,' +
  ' completed_ops INT DEFAULT 0,' +
  ' total_sets INT DEFAULT 0,' +
  ' completed_sets INT DEFAULT 0,' +
  ' est_seconds INT DEFAULT 0,' +
  ' current_label VARCHAR(255),' +
  ' stage VARCHAR(24),' +
  ' status VARCHAR(16) NOT NULL DEFAULT "running",' +   // 'running' | 'done' | 'error'
  ' created_by VARCHAR(128),' +
  ' claimed_by VARCHAR(64) NULL,' +
  ' claimed_at DATETIME NULL,' +
  ' cancel_requested TINYINT NOT NULL DEFAULT 0,' +
  ' params TEXT NULL,' +
  ' result TEXT NULL,' +
  ' started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' finished_at DATETIME NULL' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN stage VARCHAR(24)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN claimed_by VARCHAR(64) NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN claimed_at DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN cancel_requested TINYINT NOT NULL DEFAULT 0', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN params TEXT NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN result TEXT NULL', []); } catch (e) { /* exists */ }
  _ensured = true;
}

async function start(run, query = real_query) {
  await ensure_table(query);
  await query(
    'REPLACE INTO `' + TABLE + '` (run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds, ' +
    'completed_ops, completed_sets, current_label, status, created_by, started_at, finished_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, "running", ?, NOW(), NULL)',
    [String(run.run_id), run.kind || 'merge', run.mode || 'simulate', run.environment || null, run.org_id || null,
     Number(run.total_ops) || 0, Number(run.total_sets) || 0, Number(run.est_seconds) || 0,
     run.current_label || null, run.created_by || null]);
  return { run_id: run.run_id };
}

// Patch progress fields mid-run. Pass any of completed_ops, completed_sets, current_label.
async function update(runId, patch = {}, query = real_query) {
  await ensure_table(query);
  const sets = []; const vals = [];
  for (const k of ['completed_ops', 'completed_sets', 'current_label', 'total_ops', 'total_sets', 'stage', 'mode', 'environment', 'org_id', 'est_seconds']) {
    if (patch[k] !== undefined) { sets.push('`' + k + '` = ?'); vals.push(patch[k]); }
  }
  if (!sets.length) return;
  vals.push(String(runId));
  await query('UPDATE `' + TABLE + '` SET ' + sets.join(', ') + ' WHERE run_id = ?', vals);
}

async function finish(runId, patch = {}, query = real_query) {
  await ensure_table(query);
  await query(
    'UPDATE `' + TABLE + '` SET status = ?, completed_ops = COALESCE(?, completed_ops), ' +
    'completed_sets = COALESCE(?, completed_sets), current_label = ?, finished_at = NOW() WHERE run_id = ?',
    [patch.status || 'done', patch.completed_ops ?? null, patch.completed_sets ?? null,
     patch.current_label || null, String(runId)]);
}

async function get(runId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE run_id = ?', [String(runId)]);
  return (rows && rows[0]) || null;
}

// Most recent run (so the UI can poll without tracking a run id).
async function latest(kind, query = real_query) {
  await ensure_table(query);
  const where = kind ? ' WHERE kind = ?' : '';
  const params = kind ? [String(kind)] : [];
  const rows = await query('SELECT * FROM `' + TABLE + '`' + where + ' ORDER BY started_at DESC LIMIT 1', params);
  return (rows && rows[0]) || null;
}

// ---- Phase 3: worker job queue on THIS table (user-triggered; no new table) ----
// Enqueue a run for the worker to pick up. status 'queued'; params holds { ids, opts } for the executor.
async function enqueue(job, query = real_query) {
  await ensure_table(query);
  const pfx = job.kind === 'restore' ? 'rrun-' : job.kind === 'recreate' ? 'crun-' : 'mrun-';
  const runId = job.run_id || (pfx + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7));
  await query(
    'INSERT INTO `' + TABLE + '` (run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds, ' +
    'completed_ops, completed_sets, current_label, status, created_by, params, started_at, finished_at) ' +
    'VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, "queued", ?, ?, NOW(), NULL)',
    [String(runId), job.kind || 'merge', job.mode || 'simulate', job.environment || null, job.org_id || null,
     job.current_label || 'Queued', job.created_by || null, JSON.stringify(job.params || {})]);
  return { run_id: runId, status: 'queued' };
}

// Atomically claim the oldest queued run of one of `kinds` for this worker `token`. Row or null.
async function claim_next(kinds, token, query = real_query) {
  await ensure_table(query);
  const ks = (kinds && kinds.length) ? kinds : ['merge', 'restore', 'recreate'];
  const inClause = ks.map(function () { return '?'; }).join(',');
  const res = await query(
    'UPDATE `' + TABLE + '` SET status = "running", claimed_by = ?, claimed_at = NOW() ' +
    'WHERE status = "queued" AND claimed_by IS NULL AND kind IN (' + inClause + ') ' +
    'ORDER BY started_at ASC LIMIT 1',
    [String(token)].concat(ks));
  const affected = (res && res.affectedRows) || 0;
  if (!affected) return null;
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE claimed_by = ? AND status = "running" ORDER BY claimed_at DESC LIMIT 1', [String(token)]);
  return (rows && rows[0]) || null;
}

// DB-backed cancellation (cross-process: the web sets the flag, the worker reads it between sets).
async function request_cancel(runId, query = real_query) {
  await ensure_table(query);
  await query('UPDATE `' + TABLE + '` SET cancel_requested = 1 WHERE run_id = ? AND status = "running"', [String(runId)]);
  return { run_id: runId };
}
async function is_cancelled(runId, query = real_query) {
  if (runId == null) return false;
  const rows = await query('SELECT cancel_requested FROM `' + TABLE + '` WHERE run_id = ? LIMIT 1', [String(runId)]);
  return !!(rows && rows[0] && Number(rows[0].cancel_requested) === 1);
}

// Persist the executor's own result object onto the run row so the UI shows the SAME counts the old
// synchronous response returned (done/simulated/skipped/failed/...). Parity with the pre-worker version.
async function set_result(runId, obj, query = real_query) {
  await ensure_table(query);
  await query('UPDATE `' + TABLE + '` SET result = ? WHERE run_id = ?', [JSON.stringify(obj || {}), String(runId)]);
}

module.exports = { start, update, finish, get, latest, ensure_table, enqueue, claim_next, request_cancel, is_cancelled, set_result, TABLE, DDL };
