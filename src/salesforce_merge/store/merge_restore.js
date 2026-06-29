'use strict';
// Phase 4 — best-effort RESTORE of a completed merge, reusing the same write chokepoint + gate model
// as execution. Three matching steps: undelete the losers from the Recycle Bin (original ids),
// re-point their children back to their original parents (from the snapshot), and reset the master's
// overwritten fields (from the snapshot). SAFE BY DEFAULT (MERGE_ENABLE_EXECUTION + mode 'execute' +
// typed 'RESTORE'). Recycle Bin holds losers ~15 days; beyond that restore is not possible here.
const mqueue = require('./merge_queue');
const snapshot = require('./merge_snapshot');
const history = require('./merge_history');
const mrun = require('./merge_run');
const dashboard = require('./duplicates_read');

function execution_enabled() { return process.env.MERGE_ENABLE_EXECUTION === 'true'; }
function log(...a) { if (process.env.MERGE_LOG !== 'off') console.log('[restore]', ...a); }

// Which ids are currently in the Recycle Bin (soft-deleted)? scanAll:true => jsforce queryAll endpoint.
async function deleted_set(conn, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length || !conn || typeof conn.query !== 'function') return new Set();
  const inList = list.map((id) => "'" + String(id).replace(/'/g, '') + "'").join(', ');
  try {
    const res = await conn.query('SELECT Id, IsDeleted FROM Account WHERE Id IN (' + inList + ')', { scanAll: true });
    const out = new Set();
    for (const r of (res.records || [])) if (r.IsDeleted) out.add(r.Id);
    return out;
  } catch (e) { return new Set(); }
}

function from_snapshot(rows, survivorId) {
  const master = {}; const loserIds = []; const children = [];
  for (const r of (rows || [])) {
    if (r.role === 'child') { children.push(r.fields || {}); continue; }
    if (r.role === 'survivor' || r.account === survivorId) { Object.assign(master, r.fields || {}); continue; }
    if (r.role === 'loser') loserIds.push(r.account);
  }
  return { master, loserIds, children };
}

function master_reset_fields(masterFields, survivorId) {
  const SKIP = new Set(['account', 'contact', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate']);
  const out = { Id: survivorId };
  for (const [k, v] of Object.entries(masterFields || {})) {
    if (SKIP.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

async function status(deps = {}) {
  const dash = deps.dashboard || dashboard;
  const ds = await dash.dataset_info().catch(() => null);
  return { safe_mode: !execution_enabled(), execution_enabled: execution_enabled(),
    environment: ds ? ds.environment : null, data_as_of: ds ? ds.run_at : null };
}

async function list_restorable(deps = {}) {
  const Q = deps.queue || mqueue;
  const dash = deps.dashboard || dashboard;
  const W = deps.write || require('./salesforce_write');
  const done = await Q.list(undefined, 'done');
  const ds = await dash.dataset_info().catch(() => null);
  const is_test = !ds || ds.environment !== 'Production';
  let conn = null;
  const out = [];
  for (const e of done) {
    const losers = String(e.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);
    let restorable = null; let reason = '';
    try {
      if (!conn) conn = await W.default_write_connect(is_test);
      const del = await deleted_set(conn, losers);
      const back = losers.filter((id) => del.has(id));
      restorable = back.length === losers.length && losers.length > 0;
      reason = restorable ? 'all losers recoverable' : (back.length + ' of ' + losers.length + ' still in Recycle Bin');
    } catch (err) { restorable = null; reason = 'eligibility check unavailable'; }
    out.push({ id: e.id, source_type: e.source_type, source_key: e.source_key, survivor_account: e.survivor_account,
      survivor_name: e.survivor_name, loser_count: e.loser_count, environment: e.environment, restorable, reason });
  }
  return out;
}

function make_run_id() { return 'rrun-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

async function restore(ids, opts = {}, deps = {}) {
  const Q = deps.queue || mqueue;
  const SN = deps.snapshot || snapshot;
  const H = deps.history || history;
  const RUN = deps.run || mrun;
  const W = deps.write || require('./salesforce_write');
  const dash = deps.dashboard || dashboard;
  const createdBy = opts.created_by || null;

  const idset = new Set((ids || []).map((x) => Number(x)));
  const done = await Q.list(undefined, 'done');
  const entries = done.filter((e) => idset.has(Number(e.id)));
  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  const is_test = env !== 'Production';

  const armed = execution_enabled() && opts.mode === 'execute' && opts.confirm === 'RESTORE';
  const mode = armed ? 'execute' : 'simulate';
  const runId = make_run_id();
  await RUN.start({ run_id: runId, kind: 'restore', mode, environment: env,
    total_sets: entries.length, total_ops: entries.length, created_by: createdBy });
  log('run ' + runId + ' mode=' + mode + ' sets=' + entries.length + ' env=' + env);

  const out = { run_id: runId, mode, armed, processed: 0, restored: 0, simulated: 0, skipped: 0, failed: 0, results: [] };
  let conn = null; let completed = 0;

  for (const e of entries) {
    out.processed += 1;
    const rows = await SN.list_for_entry(e.id);
    const { master, loserIds, children } = from_snapshot(rows, e.survivor_account);
    const losers = loserIds.length ? loserIds : String(e.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);

    if (!rows || !rows.length) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'skipped', reason: 'no snapshot to restore from' });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: 'no snapshot' });
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    try { if (!conn) conn = await W.default_write_connect(is_test); } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, mode, result: 'failed', reason: 'connection failed: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
      await RUN.finish(runId, { status: 'error' }); return out;
    }
    const del = await deleted_set(conn, losers);
    const recoverable = losers.filter((id) => del.has(id));
    const eligible = recoverable.length === losers.length && losers.length > 0;

    if (!armed) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'simulated', reason: 'restore preview — ' + (eligible ? 'eligible' : 'not eligible') + ' (' + recoverable.length + '/' + losers.length + ' recoverable), ' + children.filter((c) => !c.child_type || c.child_type === 'child').length + ' children to re-point' });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', eligible, recoverable: recoverable.length, children: children.length });
      log((e.survivor_name || e.id) + ' — preview ' + (eligible ? 'eligible' : 'not eligible') + ' (' + recoverable.length + '/' + losers.length + ' recoverable)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    if (!eligible) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, mode, result: 'skipped',
        reason: 'not restorable: only ' + recoverable.length + '/' + losers.length + ' still in Recycle Bin (15-day window?)' });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: 'window expired' });
      log((e.survivor_name || e.id) + ' — skipped (Recycle Bin window expired)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    try {
      await W.undelete(conn, losers);
      for (const ch of children) {
        if (ch && ch.child_type && ch.child_type !== 'child') continue; // self halves return with undelete
        if (ch && ch.object && ch.id && ch.parent_field) {
          await W.update_record(conn, ch.object, { Id: ch.id, [ch.parent_field]: ch.parent_id });
        }
      }
      const reset = master_reset_fields(master, e.survivor_account);
      if (Object.keys(reset).length > 1) await W.update_record(conn, 'Account', reset);
      await Q.transition([e.id], 'restored', ['done']);
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'restored', reason: 'undeleted ' + losers.length + ', re-pointed ' + children.length + ' children' });
      out.restored += 1; out.results.push({ id: e.id, result: 'restored', undeleted: losers.length, children: children.length });
      log((e.survivor_name || e.id) + ' — RESTORED: undeleted ' + losers.length + ', re-pointed children');
    } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, mode, result: 'failed', reason: 'restore halted: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
    }
    completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed });
  }

  log('run ' + runId + ' complete: restored=' + out.restored + ' simulated=' + out.simulated + ' skipped=' + out.skipped + ' failed=' + out.failed);
  await RUN.finish(runId, { status: 'done', completed_ops: completed, completed_sets: completed, current_label: 'Complete' });
  return out;
}

module.exports = { restore, list_restorable, status, deleted_set, from_snapshot, master_reset_fields, execution_enabled, make_run_id };
