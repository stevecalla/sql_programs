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

// System / read-only fields that can't be written when CREATING a fresh Account from a snapshot.
// (Name on a Person Account is derived from First/Last, so it's skipped too.)
const CREATE_SKIP = new Set(['Id', 'account', 'contact', 'attributes', 'Name', 'CreatedDate', 'LastModifiedDate',
  'SystemModstamp', 'IsDeleted', 'MasterRecordId', 'LastActivityDate', 'LastViewedDate', 'LastReferencedDate', 'IsPersonAccount']);
function account_create_fields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (CREATE_SKIP.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}
// Pull the loser records (with their saved fields) + re-pointable children out of a snapshot.
function recreate_plan_from_snapshot(rows, survivorId) {
  const losers = []; const children = []; const master = {};
  for (const r of (rows || [])) {
    if (r.role === 'child') { if (!r.child_type || r.child_type === 'child') children.push(r.fields || {}); continue; }
    if (r.role === 'survivor' || r.account === survivorId) { Object.assign(master, r.fields || {}); continue; }
    if (r.role === 'loser') losers.push({ old_id: r.account, fields: r.fields || {} });
  }
  return { losers, children, master };
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

// The SECONDARY queue: sets whose Recycle-Bin restore failed (window expired / purged) and were
// routed to recreate-from-backup. Each carries its reason + what the backup snapshot can rebuild.
async function list_recreatable(deps = {}) {
  const Q = deps.queue || mqueue;
  const SN = deps.snapshot || snapshot;
  const pending = await Q.list(undefined, 'recreate_pending');
  const out = [];
  for (const e of pending) {
    const rows = await SN.list_for_entry(e.id);
    const losers = rows.filter((r) => r.role === 'loser');
    const children = rows.filter((r) => r.role === 'child' && (!r.child_type || r.child_type === 'child'));
    const has_snapshot = losers.length > 0;
    out.push({ id: e.id, source_type: e.source_type, source_key: e.source_key, survivor_account: e.survivor_account,
      survivor_name: e.survivor_name, loser_count: e.loser_count, environment: e.environment,
      has_snapshot, snapshot_losers: losers.length, snapshot_children: children.length,
      reason: has_snapshot
        ? 'recreate ' + losers.length + ' account(s) + ' + children.length + ' child link(s) from backup — NEW ids (external refs won’t reconnect)'
        : 'no backup snapshot — cannot recreate' });
  }
  return out;
}

function make_run_id() { return 'rrun-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function make_recreate_run_id() { return 'crun-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

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
  const runId = opts.run_id || make_run_id();
  if (opts.run_id) {
    await RUN.update(runId, { mode, environment: env, total_sets: entries.length, total_ops: entries.length });
  } else {
    await RUN.start({ run_id: runId, kind: 'restore', mode, environment: env,
      total_sets: entries.length, total_ops: entries.length, created_by: createdBy });
  }
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
      // Per-set routing: the whole set can't be undeleted from the Recycle Bin (window expired or a
      // loser was purged), so move it out of the restore list and into the SECONDARY recreate queue
      // for the user-initiated recreate-from-backup process. Reason captured for transparency.
      const reason = 'not in Recycle Bin (only ' + recoverable.length + '/' + losers.length + ' recoverable) — routed to recreate-from-backup queue';
      await Q.transition([e.id], 'recreate_pending', ['done']);
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'skipped', reason });
      out.skipped += 1; out.routed = (out.routed || 0) + 1; out.results.push({ id: e.id, result: 'routed', reason });
      log((e.survivor_name || e.id) + ' — routed to recreate queue (' + recoverable.length + '/' + losers.length + ' recoverable)');
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

// SECONDARY restore: recreate-from-backup, USER-INITIATED. For sets routed to `recreate_pending`
// (their losers are gone from the Recycle Bin), rebuild the loser Accounts from the backup snapshot.
// The new records get NEW ids — external references won't reconnect. Same safe-mode gate model as
// restore, but the typed confirm is 'RECREATE'. SAFE BY DEFAULT; fail-records-but-continue per set.
async function recreate(ids, opts = {}, deps = {}) {
  const Q = deps.queue || mqueue;
  const SN = deps.snapshot || snapshot;
  const H = deps.history || history;
  const RUN = deps.run || mrun;
  const W = deps.write || require('./salesforce_write');
  const dash = deps.dashboard || dashboard;
  const createdBy = opts.created_by || null;

  const idset = new Set((ids || []).map((x) => Number(x)));
  const pending = await Q.list(undefined, 'recreate_pending');
  const entries = pending.filter((e) => idset.has(Number(e.id)));
  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  const is_test = env !== 'Production';

  const armed = execution_enabled() && opts.mode === 'execute' && opts.confirm === 'RECREATE';
  const mode = armed ? 'execute' : 'simulate';
  const runId = opts.run_id || make_recreate_run_id();
  if (opts.run_id) {
    await RUN.update(runId, { mode, environment: env, total_sets: entries.length, total_ops: entries.length });
  } else {
    await RUN.start({ run_id: runId, kind: 'recreate', mode, environment: env, total_sets: entries.length, total_ops: entries.length, created_by: createdBy });
  }
  log('recreate run ' + runId + ' mode=' + mode + ' sets=' + entries.length + ' env=' + env);

  const out = { run_id: runId, mode, armed, processed: 0, recreated: 0, simulated: 0, skipped: 0, failed: 0, results: [] };
  let conn = null; let completed = 0;

  for (const e of entries) {
    out.processed += 1;
    const rows = await SN.list_for_entry(e.id);
    const { losers, children, master } = recreate_plan_from_snapshot(rows, e.survivor_account);

    if (!losers.length) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'skipped', reason: 'no backup snapshot to recreate from' });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: 'no snapshot' });
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    if (!armed) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'simulated', reason: 'recreate preview — ' + losers.length + ' account(s) + ' + children.length + ' child link(s) from backup (NEW ids)' });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', accounts: losers.length, children: children.length });
      log((e.survivor_name || e.id) + ' — recreate preview (' + losers.length + ' accounts)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    try { if (!conn) conn = await W.default_write_connect(is_test); } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, mode, result: 'failed', reason: 'connection failed: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
      await RUN.finish(runId, { status: 'error' }); return out;
    }

    try {
      const idMap = {}; // old loser id -> new id
      for (const l of losers) {
        const res = await W.create_record(conn, 'Account', account_create_fields(l.fields));
        if (!res.success || !res.id) throw new Error((res.errors && res.errors[0] && (res.errors[0].message || res.errors[0].statusCode)) || ('create failed for ' + l.old_id));
        idMap[l.old_id] = res.id;
      }
      let childOk = 0;
      for (const ch of children) {
        const newParent = idMap[ch.parent_id] || idMap[ch.account];
        if (ch && ch.object && ch.id && ch.parent_field && newParent) {
          await W.update_record(conn, ch.object, { Id: ch.id, [ch.parent_field]: newParent });
          childOk += 1;
        }
      }
      const reset = master_reset_fields(master, e.survivor_account);
      if (Object.keys(reset).length > 1) await W.update_record(conn, 'Account', reset);
      await Q.transition([e.id], 'recreated', ['recreate_pending']);
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'recreated', reason: 'recreated ' + losers.length + ' account(s) (NEW ids), re-pointed ' + childOk + ' child link(s)' });
      out.recreated += 1; out.results.push({ id: e.id, result: 'recreated', accounts: losers.length, children: childOk, new_ids: idMap });
      log((e.survivor_name || e.id) + ' — RECREATED ' + losers.length + ' accounts (new ids)');
    } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, mode, result: 'failed', reason: 'recreate halted: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
    }
    completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed });
  }

  log('recreate run ' + runId + ' complete: recreated=' + out.recreated + ' simulated=' + out.simulated + ' skipped=' + out.skipped + ' failed=' + out.failed);
  await RUN.finish(runId, { status: 'done', completed_ops: completed, completed_sets: completed, current_label: 'Complete' });
  return out;
}

module.exports = { restore, list_restorable, list_recreatable, recreate, status, deleted_set, from_snapshot, recreate_plan_from_snapshot, account_create_fields, master_reset_fields, execution_enabled, make_run_id };
