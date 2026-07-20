'use strict';
// Phase 3b/4 — run-progress record so the UI can show a live progress bar + elapsed timer + ETA
// while a merge/restore runs server-side (sequential calls). One row per run, updated as each call
// completes. `query` injectable for tests. Read-only of Salesforce — this only tracks our own run.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'salesforce_merge_run';

// Self-documenting column (visible in SELECT *) so future readers know what this table is for.
const PURPOSE = 'Run log + live progress + job queue for merge/restore/recreate. Rows start "queued"; the '
  + 'isolated worker atomically claims one, flips it "running", and drains it — one row per run with '
  + 'stage/progress/heartbeat/result. Also carries the cross-process cancel flag and the stale-claim reaper anchor.';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' run_id VARCHAR(64) PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' kind VARCHAR(16) NOT NULL,' +                 // 'merge' | 'restore'
  ' mode VARCHAR(16) NOT NULL,' +                 // 'simulate' | 'execute'
  ' environment VARCHAR(24),' +
  ' org_id VARCHAR(32),' +
  ' job_id VARCHAR(40) NULL,' +                   // groups the parallel chunk-runs of one user job; NULL = legacy single run
  ' batch_index INT NULL,' +                      // 1-based position of this chunk within the job (display)
  ' batch_total INT NULL,' +                      // how many chunks the job was split into (display)
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
  ' heartbeat_at DATETIME NULL,' +                // last progress touch — a stale one means the worker died
  ' cancel_requested TINYINT NOT NULL DEFAULT 0,' +
  ' params TEXT NULL,' +
  ' result TEXT NULL,' +
  ' started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' finished_at DATETIME NULL,' +
  ' created_at_mtn DATETIME NULL,' +              // Denver wall-clock, written by the app (event-table convention)
  ' created_at_utc DATETIME NULL' +               // UTC wall-clock, written by the app
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query("ALTER TABLE `" + TABLE + "` ADD COLUMN purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'", []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN stage VARCHAR(24)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN claimed_by VARCHAR(64) NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN claimed_at DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN heartbeat_at DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN cancel_requested TINYINT NOT NULL DEFAULT 0', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN params TEXT NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN result TEXT NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  // Add the job columns positioned with the run identity (AFTER org_id) so a fresh add lands correctly.
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN job_id VARCHAR(40) NULL AFTER org_id', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN batch_index INT NULL AFTER job_id', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN batch_total INT NULL AFTER batch_index', []); } catch (e) { /* exists */ }
  // One-time self-heal: earlier builds appended job_id/batch_index/batch_total at the END (ADD COLUMN
  // defaults to the tail), pushing them past the created_at_* wall-clocks. Put them back with the run
  // identity (after org_id) and keep created_at_* LAST. Guarded on ordinal position so the (COPY-algorithm)
  // reorder runs only when actually out of order — not on every boot — and never blocks startup.
  try {
    const pos = await query("SELECT COLUMN_NAME AS c, ORDINAL_POSITION AS p FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN ('job_id','created_at_utc')", [TABLE]);
    const m = {}; (Array.isArray(pos) ? pos : []).forEach((r) => { if (r && r.c) m[r.c] = Number(r.p); });
    if (m.job_id && m.created_at_utc && m.job_id > m.created_at_utc) {
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN job_id VARCHAR(40) NULL AFTER org_id', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN batch_index INT NULL AFTER job_id', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN batch_total INT NULL AFTER batch_index', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN created_at_mtn DATETIME NULL AFTER finished_at', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN created_at_utc DATETIME NULL AFTER created_at_mtn', []);
    }
  } catch (e) { /* best-effort column ordering — never blocks boot */ }
  _ensured = true;
}

async function start(run, query = real_query) {
  await ensure_table(query);
  const ts = now_mtn_utc();
  await query(
    'REPLACE INTO `' + TABLE + '` (run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds, ' +
    'completed_ops, completed_sets, current_label, status, created_by, started_at, finished_at, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, "running", ?, NOW(), NULL, ?, ?)',
    [String(run.run_id), run.kind || 'merge', run.mode || 'simulate', run.environment || null, run.org_id || null,
     Number(run.total_ops) || 0, Number(run.total_sets) || 0, Number(run.est_seconds) || 0,
     run.current_label || null, run.created_by || null, ts.mtn, ts.utc]);
  return { run_id: run.run_id };
}

// Patch progress fields mid-run. Pass any of completed_ops, completed_sets, current_label.
async function update(runId, patch = {}, query = real_query) {
  await ensure_table(query);
  // Always touch the heartbeat so the reaper can tell a live run from a dead worker.
  const sets = ['`heartbeat_at` = NOW()']; const vals = [];
  for (const k of ['completed_ops', 'completed_sets', 'current_label', 'total_ops', 'total_sets', 'stage', 'mode', 'environment', 'org_id', 'est_seconds']) {
    if (patch[k] !== undefined) { sets.push('`' + k + '` = ?'); vals.push(patch[k]); }
  }
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
  const ts = now_mtn_utc();
  await query(
    'INSERT INTO `' + TABLE + '` (run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds, ' +
    'completed_ops, completed_sets, current_label, status, created_by, params, job_id, batch_index, batch_total, started_at, finished_at, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, "queued", ?, ?, ?, ?, ?, NOW(), NULL, ?, ?)',
    [String(runId), job.kind || 'merge', job.mode || 'simulate', job.environment || null, job.org_id || null,
     job.current_label || 'Queued', job.created_by || null, JSON.stringify(job.params || {}),
     job.job_id || null, job.batch_index != null ? Number(job.batch_index) : null, job.batch_total != null ? Number(job.batch_total) : null,
     ts.mtn, ts.utc]);
  return { run_id: runId, status: 'queued' };
}

// ---- Phase 1 (parallel workers): a "job" = N chunk-runs sharing a job_id ----
// Aggregate live progress for a whole job across its chunk-runs: summed sets, batch/worker counts, and a
// rolled-up status. `workers` = distinct pm2 workers currently draining the job (claim-token pid prefix).
async function job_progress(jobId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE job_id = ? ORDER BY batch_index ASC, started_at ASC', [String(jobId)]);
  const runs = rows || [];
  if (!runs.length) return null;
  const sum = (f) => runs.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  const isTerminal = (s) => s === 'done' || s === 'error' || s === 'cancelled'; // 'held' is NOT terminal (resumable)
  const runs_done = runs.filter((r) => isTerminal(r.status)).length;
  const workers = new Set(runs.filter((r) => r.status === 'running').map((r) => String(r.claimed_by || '').split('-')[0]).filter(Boolean)).size;
  const anyRunning = runs.some((r) => r.status === 'running');
  const anyQueued = runs.some((r) => r.status === 'queued');
  const anyHeld = runs.some((r) => r.status === 'held');
  const anyError = runs.some((r) => r.status === 'error');
  const anyCancelled = runs.some((r) => r.status === 'cancelled');
  const runs_held = runs.filter((r) => r.status === 'held').length;
  // Precedence: a paused job (breaker tripped → some batches held, nothing left queued) shows 'paused'
  // even while a running chunk finishes its in-flight set; otherwise active → running; else terminal.
  const status = (anyHeld && !anyQueued) ? 'paused'
    : (anyRunning || anyQueued) ? 'running'
    : (anyError ? 'error' : (anyCancelled ? 'cancelled' : 'done'));
  // Total wall time across the whole job (accounts for parallelism): earliest start → latest finish among
  // the chunk-runs. Both are DB DATETIMEs so the delta is tz-consistent. Grows as batches finish; final
  // when the job is terminal.
  const ms = (v) => (v ? new Date(v).getTime() : 0);
  const starts = runs.map((r) => ms(r.claimed_at || r.started_at)).filter(Boolean);
  const ends = runs.map((r) => ms(r.finished_at)).filter(Boolean);
  const total_seconds = (starts.length && ends.length) ? Math.max(0, Math.round((Math.max(...ends) - Math.min(...starts)) / 1000)) : null;
  return {
    job_id: String(jobId), kind: runs[0].kind, mode: runs[0].mode, status,
    runs_total: runs.length, runs_done, runs_held, workers_active: workers,
    total_sets: sum('total_sets'), completed_sets: sum('completed_sets'),
    total_ops: sum('total_ops'), completed_ops: sum('completed_ops'),
    started_at: runs[0].started_at, total_seconds,
    runs: runs.map((r) => ({ run_id: r.run_id, batch_index: r.batch_index, batch_total: r.batch_total, status: r.status,
      completed_sets: r.completed_sets, total_sets: r.total_sets, worker: String(r.claimed_by || '').split('-')[0] || null, current_label: r.current_label,
      seconds: (r.claimed_at && r.finished_at) ? Math.max(0, Math.round((new Date(r.finished_at).getTime() - new Date(r.claimed_at).getTime()) / 1000)) : null })),
  };
}

// Live ops snapshot for the Merge Ops panel: current queue depth + how many pm2 workers are actively
// draining (distinct claim-token pid prefixes among running runs) + held (paused) + active job count.
// Note: only BUSY workers show here (a run they're draining); an idle-but-online cluster instance has no
// running row to count — the panel labels this "workers active", and pm2 scale reports the true online N.
async function ops_status(query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT status, claimed_by, job_id FROM `' + TABLE + '` WHERE status IN ("queued", "running", "held")', []);
  const list = rows || [];
  const running = list.filter((r) => r.status === 'running');
  const workers = new Set(running.map((r) => String(r.claimed_by || '').split('-')[0]).filter(Boolean));
  const jobs = new Set(list.map((r) => r.job_id).filter(Boolean));
  return {
    queued: list.filter((r) => r.status === 'queued').length,
    running: running.length,
    held: list.filter((r) => r.status === 'held').length,
    workers_active: workers.size,
    workers: [...workers].sort(),
    active_jobs: jobs.size,
  };
}

// Cancel a whole job: flag cancel on every still-running chunk-run (worker honors it at the set boundary).
// Queued-but-unclaimed chunks are removed so they never start. Returns { cancelled, removed }.
async function cancel_job(jobId, query = real_query) {
  await ensure_table(query);
  const c = await query('UPDATE `' + TABLE + '` SET cancel_requested = 1 WHERE job_id = ? AND status = "running"', [String(jobId)]);
  const r = await query('UPDATE `' + TABLE + '` SET status = "cancelled", current_label = ?, finished_at = NOW() WHERE job_id = ? AND status = "queued"', ['cancelled before start', String(jobId)]);
  return { job_id: String(jobId), cancelled: (c && c.affectedRows) || 0, removed: (r && r.affectedRows) || 0 };
}

// PAUSE a job (async-Apex circuit breaker or a manual hold): park every queued-but-unclaimed chunk as
// 'held' so no worker starts it, and flag any running chunk to stop at its next set boundary (in-flight
// set finishes cleanly). Resumable — nothing is discarded. `reason` is shown on the held rows.
async function hold_job(jobId, reason, query = real_query) {
  await ensure_table(query);
  const label = reason || 'paused';
  const h = await query('UPDATE `' + TABLE + '` SET status = "held", current_label = ? WHERE job_id = ? AND status = "queued"', [label, String(jobId)]);
  const c = await query('UPDATE `' + TABLE + '` SET cancel_requested = 1 WHERE job_id = ? AND status = "running"', [String(jobId)]);
  return { job_id: String(jobId), held: (h && h.affectedRows) || 0, stopping: (c && c.affectedRows) || 0 };
}

// RESUME a paused job: put every held chunk back to 'queued' (clearing any cancel flag) so the worker
// cluster drains them again. Sets already merged are 'done' and drop out via the executor's drift check,
// so resume safely continues with only what's left. Returns { resumed }.
async function resume_job(jobId, query = real_query) {
  await ensure_table(query);
  const r = await query('UPDATE `' + TABLE + '` SET status = "queued", cancel_requested = 0, current_label = "Queued (resumed)", claimed_by = NULL, claimed_at = NULL WHERE job_id = ? AND status = "held"', [String(jobId)]);
  return { job_id: String(jobId), resumed: (r && r.affectedRows) || 0 };
}

// Atomically claim the oldest queued run of one of `kinds` for this worker `token`. Row or null.
async function claim_next(kinds, token, query = real_query) {
  await ensure_table(query);
  const ks = (kinds && kinds.length) ? kinds : ['merge', 'restore', 'recreate'];
  const inClause = ks.map(function () { return '?'; }).join(',');
  const res = await query(
    'UPDATE `' + TABLE + '` SET status = "running", claimed_by = ?, claimed_at = NOW(), heartbeat_at = NOW() ' +
    'WHERE status = "queued" AND claimed_by IS NULL AND kind IN (' + inClause + ') ' +
    'ORDER BY started_at ASC LIMIT 1',
    [String(token)].concat(ks));
  const affected = (res && res.affectedRows) || 0;
  if (!affected) return null;
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE claimed_by = ? AND status = "running" ORDER BY claimed_at DESC LIMIT 1', [String(token)]);
  return (rows && rows[0]) || null;
}

// Stale-claim reaper: fail runs left in 'running' whose heartbeat is older than maxIdleSeconds — the
// signature of a worker that died mid-run (crash / OOM / reboot), which the in-loop try/catch can't
// catch. Multi-worker safe: a live run's heartbeat is refreshed on every progress update, so it's never
// stale. We only FAIL the run (unsticks the UI); the queued merge sets stay 'approved' and can be
// re-selected — safe because the add-dedup + drift checks guard against double-processing. `secs` is
// clamped + inlined as a validated integer (no injection).
async function reap_stale(maxIdleSeconds, query = real_query) {
  await ensure_table(query);
  const secs = Math.max(30, Math.floor(Number(maxIdleSeconds) || 600));
  const cutoff = 'COALESCE(heartbeat_at, claimed_at, started_at) < (NOW() - INTERVAL ' + secs + ' SECOND)';
  const stale = await query('SELECT run_id FROM `' + TABLE + '` WHERE status = "running" AND ' + cutoff, []);
  const ids = (stale || []).map((r) => r.run_id).filter(Boolean);
  if (!ids.length) return { reaped: 0, run_ids: [] };
  await query(
    'UPDATE `' + TABLE + '` SET status = "error", current_label = ?, finished_at = NOW() ' +
    'WHERE status = "running" AND ' + cutoff,
    ['stale — worker stopped before finishing (reclaimed; re-select the sets to retry)']);
  return { reaped: ids.length, run_ids: ids };
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

module.exports = { start, update, finish, get, latest, ensure_table, enqueue, claim_next, reap_stale, request_cancel, is_cancelled, set_result, job_progress, cancel_job, hold_job, resume_job, ops_status, TABLE, DDL };
