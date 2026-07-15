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

// Classify each account id: 'deleted' (in the Recycle Bin), 'live' (exists, e.g. already restored by a
// prior partial run), or 'missing' (purged / gone). Lets restore treat an already-live loser as
// recoverable instead of mis-routing it to the recreate queue on a retry.
async function account_states(conn, ids) {
  const list = (ids || []).filter(Boolean);
  const map = {};
  for (const id of list) map[id] = 'missing';
  if (!list.length || !conn || typeof conn.query !== 'function') return map;
  const inList = list.map((id) => "'" + String(id).replace(/'/g, '') + "'").join(', ');
  try {
    const res = await conn.query('SELECT Id, IsDeleted FROM Account WHERE Id IN (' + inList + ')', { scanAll: true });
    for (const r of (res.records || [])) map[r.Id] = r.IsDeleted ? 'deleted' : 'live';
  } catch (e) { /* leave as missing */ }
  return map;
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
    const states = await account_states(conn, losers);
    const toUndelete = losers.filter((id) => states[id] === 'deleted');
    const present = losers.filter((id) => states[id] === 'deleted' || states[id] === 'live'); // recoverable (in bin or already live)
    const missing = losers.filter((id) => states[id] === 'missing');
    const eligible = missing.length === 0 && losers.length > 0;
    const repointable = children.filter((c) => !c.child_type || c.child_type === 'child');

    if (!armed) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'simulated', reason: 'restore preview — ' + (eligible ? 'eligible' : 'not eligible') + ' (' + present.length + '/' + losers.length + ' recoverable), ' + repointable.length + ' children to re-point' });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', eligible, recoverable: present.length, children: children.length });
      log((e.survivor_name || e.id) + ' — preview ' + (eligible ? 'eligible' : 'not eligible') + ' (' + present.length + '/' + losers.length + ' recoverable)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    if (!eligible) {
      // Per-set routing: a loser is purged (gone from the Recycle Bin), so move the set into the
      // SECONDARY recreate queue for the user-initiated recreate-from-backup process. (An already-live
      // loser is NOT purged — it counts as recoverable, so a retry after a partial restore still runs.)
      const reason = 'not in Recycle Bin (only ' + present.length + '/' + losers.length + ' recoverable) — routed to recreate-from-backup queue';
      await Q.transition([e.id], 'recreate_pending', ['done']);
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'skipped', reason });
      out.skipped += 1; out.routed = (out.routed || 0) + 1; out.results.push({ id: e.id, result: 'routed', reason });
      log((e.survivor_name || e.id) + ' — routed to recreate queue (' + present.length + '/' + losers.length + ' recoverable)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    // STEP 1 — reset the SURVIVOR's fields FIRST (pre-merge values from the snapshot). Salesforce has
    // no native "un-merge"; we compose it from update + undelete + update, so the ORDER is ours to get
    // right. Resetting the survivor before the undelete frees any UNIQUE value that survivorship moved
    // onto the survivor during the merge (e.g. a member number) — otherwise Salesforce blocks the
    // undelete below with "duplicate value found ...". Best-effort (isolated so it can't abort the set).
    let masterOk = true; const notes = [];
    try { const reset = master_reset_fields(master, e.survivor_account); if (Object.keys(reset).length > 1) await W.update_record(conn, 'Account', reset); }
    catch (err) { masterOk = false; notes.push('master reset: ' + (err && err.message)); }

    // STEP 2 — bring the loser(s) back. Only undelete the ones still in the bin, and CHECK the result:
    // if a loser won't come back, that's a real failure (report Salesforce's own message) — don't push
    // on and fail later on a child that still points at a deleted parent.
    let undelErr = null;
    if (toUndelete.length) {
      try {
        const res = await W.undelete(conn, toUndelete);
        const bad = (res || []).filter((r) => r && r.success === false);
        if (bad.length) undelErr = (bad[0].errors && bad[0].errors[0] && (bad[0].errors[0].message || bad[0].errors[0].statusCode)) || 'undelete rejected';
      } catch (err) { undelErr = (err && err.message) || 'undelete threw'; }
    }
    if (undelErr) {
      log((e.survivor_name || e.id) + ' — RESTORE FAILED at undelete: ' + undelErr);
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
        result: 'failed', reason: 'restore halted at undelete: ' + undelErr + (masterOk ? '' : ' (survivor reset also failed)') });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: 'undelete: ' + undelErr });
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    // STEP 3 — re-point the reparented children back to the loser, BEST-EFFORT: isolate each record so
    // one problem (e.g. a child the merge deleted → "entity is deleted") can't abort the whole restore.
    // If a target is itself deleted, undelete it first then re-point; otherwise skip it with a note.
    let repointed = 0; let skippedCh = 0;
    for (const ch of repointable) {
      if (!(ch && ch.object && ch.id && ch.parent_field)) continue;
      const patch = { Id: ch.id, [ch.parent_field]: ch.parent_id };
      try { await W.update_record(conn, ch.object, patch); repointed += 1; }
      catch (err) {
        if (/deleted/i.test((err && err.message) || '')) {
          try { await W.undelete(conn, [ch.id]); await W.update_record(conn, ch.object, patch); repointed += 1; }
          catch (e2) { skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': ' + ((e2 && e2.message) || 'deleted, unrecoverable')); }
        } else { skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': ' + (err && err.message)); }
      }
    }

    await Q.transition([e.id], 'restored', ['done']);
    const reason = 'undeleted ' + toUndelete.length + ', re-pointed ' + repointed
      + (skippedCh ? ', skipped ' + skippedCh : '') + (masterOk ? '' : ', master-reset partial')
      + (notes.length ? ' — ' + notes.slice(0, 5).join('; ') : '');
    await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
      survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, mode,
      result: 'restored', reason });
    out.restored += 1; out.results.push({ id: e.id, result: 'restored', undeleted: toUndelete.length, repointed, skipped: skippedCh, notes });
    log((e.survivor_name || e.id) + ' — RESTORED: ' + reason);
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
      log((e.survivor_name || e.id) + ' — RECREATE FAILED: ' + (err && err.message));
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
