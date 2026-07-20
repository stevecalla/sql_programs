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
const post_snapshot = require('./merge_post_snapshot');

function execution_enabled() { return process.env.MERGE_ENABLE_EXECUTION === 'true'; }
function log(...a) { if (process.env.MERGE_LOG !== 'off') console.log('[restore]', ...a); }

// A field-level-security / read-only write refusal — the field exists but the write user lacks EDIT on it
// (typical of managed-package lookups). Distinct from a real failure: an admin grants field-level edit.
function _is_fls_error(msg) {
  return /Unable to create\/update fields|check the security settings|INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY|INSUFFICIENT_ACCESS|field is not writeable|not writable|read[- ]only/i.test(String(msg || ''));
}

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

// The survivor's CURRENT Salesforce LastModifiedDate (via the write connection). Used by the post-merge
// edit gate to tell if the survivor was touched in SF after the merge. Best-effort — null on any issue.
async function survivor_last_modified(conn, id) {
  if (!conn || typeof conn.query !== 'function' || !id) return null;
  try {
    const res = await conn.query("SELECT Id, LastModifiedDate FROM Account WHERE Id = '" + String(id).replace(/'/g, '') + "'");
    const r = (res.records || [])[0];
    return (r && r.LastModifiedDate) || null;
  } catch (e) { return null; }
}

// Re-link a file share (ContentDocumentLink) to the loser. Salesforce forbids updating LinkedEntityId, so
// we CREATE a fresh link on the loser (ch.parent_id / targetOverride) from the captured ContentDocumentId.
// ADDITIVE BY DESIGN: we do NOT delete the survivor's link and never touch the file itself — the loser
// simply regains access, the survivor keeps it, so nothing can ever be unshared or lost. Snapshots that
// predate ContentDocumentId capture can't be recreated here — skipped with a clear note (use the
// repair_file_shares.js tool for those). Returns { ok, note? }.
async function move_content_link(W, conn, ch, targetOverride) {
  const cdid = ch.content_document_id || ch.ContentDocumentId;
  const target = targetOverride || ch.parent_id;
  if (!cdid || !target) {
    return { ok: false, note: 'ContentDocumentLink ' + ch.id + ': file share left on the survivor — Salesforce won’t move a share by update, and this record predates ContentDocumentId capture so it can’t be recreated (expected, not an error; run repair_file_shares.js to re-link).' };
  }
  try {
    const res = await W.create_record(conn, 'ContentDocumentLink', { ContentDocumentId: cdid, LinkedEntityId: target, ShareType: ch.share_type || 'V', Visibility: ch.visibility || 'AllUsers' });
    if (res && res.success === false) {
      const msg = (res.errors && res.errors[0] && (res.errors[0].message || res.errors[0].statusCode)) || '';
      if (!/duplicate|already/i.test(msg)) return { ok: false, note: 'ContentDocumentLink ' + ch.id + ': could not re-link share to loser — ' + (msg || 'create failed') };
    }
  } catch (err) {
    const msg = (err && err.message) || '';
    if (!/duplicate|already/i.test(msg)) return { ok: false, note: 'ContentDocumentLink ' + ch.id + ': ' + msg };
  }
  return { ok: true };   // additive — survivor's link is intentionally left in place
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

// Build the survivor field patch to reset to pre-merge values. `keep` is an optional set/array of
// field API names the operator chose to LEAVE at their current (live) value — those are excluded from
// the reset (selective restore). Everything else non-blank + non-system is reset to the snapshot.
function master_reset_fields(masterFields, survivorId, keep) {
  const SKIP = new Set(['account', 'contact', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate']);
  const keepSet = keep instanceof Set ? keep : new Set(keep || []);
  const out = { Id: survivorId };
  for (const [k, v] of Object.entries(masterFields || {})) {
    if (SKIP.has(k)) continue;
    if (keepSet.has(k)) continue;   // operator kept the current value for this field
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
  const POST = deps.post_snapshot || post_snapshot;
  const DOS = deps.dossier || require('./merge_dossier');
  const createdBy = opts.created_by || null;
  const APIUSE = deps.api_usage || require('./api_usage');

  const idset = new Set((ids || []).map((x) => Number(x)));
  const done = await Q.list(undefined, 'done');
  const entries = done.filter((e) => idset.has(Number(e.id)));
  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  const is_test = env !== 'Production';
  const orgId = (entries[0] && entries[0].org_id) || null;   // stamp the run/history with the set's org (lineage)

  const armed = execution_enabled() && opts.mode === 'execute' && opts.confirm === 'RESTORE';
  const mode = armed ? 'execute' : 'simulate';
  const runId = opts.run_id || make_run_id();
  if (opts.run_id) {
    await RUN.update(runId, { mode, environment: env, org_id: orgId, total_sets: entries.length, total_ops: entries.length });
  } else {
    await RUN.start({ run_id: runId, kind: 'restore', mode, environment: env, org_id: orgId,
      total_sets: entries.length, total_ops: entries.length, created_by: createdBy });
  }
  log('run ' + runId + ' mode=' + mode + ' sets=' + entries.length + ' env=' + env);

  const out = { run_id: runId, mode, armed, processed: 0, restored: 0, simulated: 0, skipped: 0, failed: 0, results: [] };
  let conn = null; let completed = 0; let apiStartLogged = false;

  for (const e of entries) {
    out.processed += 1;
    const rows = await SN.list_for_entry(e.id);
    const { master, loserIds, children } = from_snapshot(rows, e.survivor_account);
    const losers = loserIds.length ? loserIds : String(e.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);

    if (!rows || !rows.length) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'skipped', reason: 'no snapshot to restore from' });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: 'no snapshot' });
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    try { if (!conn) conn = await W.default_write_connect(is_test); } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, org_id: e.org_id, mode, result: 'failed', reason: 'connection failed: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
      await RUN.finish(runId, { status: 'error' }); return out;
    }
    if (conn && !apiStartLogged) { apiStartLogged = true; try { const u0 = await APIUSE.usage_all(conn); if (u0 && u0.api) APIUSE.record({ env: env, org_id: orgId, op: 'restore', run_id: runId, actor: createdBy, used: u0.api.used, max: u0.api.max, apex_used: u0.apex && u0.apex.used, apex_max: u0.apex && u0.apex.max, bulk_used: u0.bulk && u0.bulk.used, bulk_max: u0.bulk && u0.bulk.max }); } catch (e) { /* fire-and-forget */ } }
    const states = await account_states(conn, losers);
    const toUndelete = losers.filter((id) => states[id] === 'deleted');
    const present = losers.filter((id) => states[id] === 'deleted' || states[id] === 'live'); // recoverable (in bin or already live)
    const missing = losers.filter((id) => states[id] === 'missing');
    const eligible = missing.length === 0 && losers.length > 0;
    const repointable = children.filter((c) => !c.child_type || c.child_type === 'child');

    // Selective restore: per-set list of survivor fields to KEEP at their current value (from the diff
    // review). Fields not kept are reset to the pre-merge snapshot.
    const keepList = (opts.keep_fields && (opts.keep_fields[e.id] || opts.keep_fields[String(e.id)])) || [];
    const keepSet = new Set(keepList);
    const resetPreview = Object.keys(master_reset_fields(master, e.survivor_account, keepSet)).length - 1;

    if (!armed) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'simulated', reason: 'restore preview — ' + (eligible ? 'eligible' : 'not eligible') + ' (' + present.length + '/' + losers.length + ' recoverable), ' + repointable.length + ' children to re-point, would reset ' + resetPreview + ' field(s)' + (keepSet.size ? ', keep ' + keepSet.size : '') });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', eligible, recoverable: present.length, children: children.length, reset_fields: resetPreview, kept_fields: keepSet.size });
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
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'skipped', reason });
      out.skipped += 1; out.routed = (out.routed || 0) + 1; out.results.push({ id: e.id, result: 'routed', reason });
      log((e.survivor_name || e.id) + ' — routed to recreate queue (' + present.length + '/' + losers.length + ' recoverable)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    // POST-MERGE EDIT GATE — if the survivor was edited IN SALESFORCE after the merge, a blind restore
    // (which resets the survivor to pre-merge values) would clobber that later change. Hold the set
    // (leave it 'done', in the queue) for review unless the operator acknowledged the risk. Best-effort:
    // if we can't read the timestamps we don't block. Only applies when a post-merge baseline exists.
    if (!opts.ack_post_merge) {
      try {
        const psnap = await POST.get(e.id);
        if (psnap && psnap.sf_last_modified) {
          const lmNow = await survivor_last_modified(conn, e.survivor_account);
          if (lmNow && new Date(lmNow) > new Date(psnap.sf_last_modified)) {
            const reason = 'survivor edited in Salesforce after the merge (' + lmNow + ' > ' + psnap.sf_last_modified + ') — held for review; acknowledge to restore anyway';
            await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
              survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
              result: 'skipped', reason });
            out.skipped += 1; out.held = (out.held || 0) + 1;
            out.results.push({ id: e.id, result: 'held', reason: 'edited since merge', sf_last_modified_now: lmNow, sf_last_modified_at_merge: psnap.sf_last_modified });
            log((e.survivor_name || e.id) + ' — HELD (edited in SF since merge)');
            completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
          }
        }
      } catch (gerr) { log('post-merge gate check skipped for ' + e.survivor_account + ': ' + (gerr && gerr.message)); }
    }

    // STEP 1 — reset the SURVIVOR's fields FIRST (pre-merge values from the snapshot). Salesforce has
    // no native "un-merge"; we compose it from update + undelete + update, so the ORDER is ours to get
    // right. Resetting the survivor before the undelete frees any UNIQUE value that survivorship moved
    // onto the survivor during the merge (e.g. a member number) — otherwise Salesforce blocks the
    // undelete below with "duplicate value found ...". Best-effort (isolated so it can't abort the set).
    let masterOk = true; let resetCount = 0; let resetPlan = []; const notes = [];
    try {
      const reset = master_reset_fields(master, e.survivor_account, keepSet);
      resetPlan = Object.entries(reset).filter(([k]) => k !== 'Id').map(([field, value]) => ({ field, value }));
      resetCount = resetPlan.length;
      if (resetCount > 0) await W.update_record(conn, 'Account', reset);
    } catch (err) { masterOk = false; notes.push('master reset: ' + (err && err.message)); }

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
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
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
      // File shares (ContentDocumentLink) can't be re-parented by UPDATE — Salesforce is insert/delete-only.
      // Re-link the share to the loser (ADDITIVE: create a link on the loser, keep the survivor's — a file
      // is never unshared or lost).
      if (ch.object === 'ContentDocumentLink') { const r = await move_content_link(W, conn, ch); if (r.ok) repointed += 1; else { skippedCh += 1; notes.push(r.note); } continue; }
      // Salesforce manages activity relationships itself: Task.AccountId is read-only and the *Relation
      // junctions can't be updated. Skip cleanly instead of raising a false error (see Reference panel).
      if (/^(Task|Event)(Who)?Relation$/i.test(ch.object) || ((ch.object === 'Task' || ch.object === 'Event') && ch.parent_field === 'AccountId')) {
        skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': skipped — Salesforce manages this activity relationship'); continue;
      }
      // Account–Contact relation is also system-managed: the DIRECT relation follows Contact.AccountId and
      // its ContactId is read-only, so re-pointing it always fails. Restoring the Contact's AccountId makes
      // Salesforce recreate it automatically — so skipping here is correct, not a data gap (Reference panel).
      if (ch.object === 'AccountContactRelation') {
        skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': skipped — Salesforce manages the direct Account–Contact relation (follows Contact.AccountId; ContactId is read-only)'); continue;
      }
      const patch = { Id: ch.id, [ch.parent_field]: ch.parent_id };
      try { await W.update_record(conn, ch.object, patch); repointed += 1; }
      catch (err) {
        const msg = (err && err.message) || '';
        if (/deleted/i.test(msg)) {
          try { await W.undelete(conn, [ch.id]); await W.update_record(conn, ch.object, patch); repointed += 1; }
          catch (e2) { skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': ' + ((e2 && e2.message) || 'deleted, unrecoverable')); }
        } else if (_is_fls_error(msg)) {
          // Field-level security: the field exists but the write user lacks EDIT on it (common for managed-
          // package lookups like iWave). Not a code bug — an admin must grant field-level edit. Merges are
          // unaffected (SF's native merge re-parents these to the survivor); only a restore can't reverse it.
          skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': skipped — field not writable for this user, needs field-level edit (FLS): ' + msg);
        } else { skippedCh += 1; notes.push(ch.object + ' ' + ch.id + ': ' + msg); }
      }
    }

    await Q.transition([e.id], 'restored', ['done']);
    // Lifecycle stamp: the merge was undone, so flag=false, date=now, by='RESTORE — <actor>'. Best-effort,
    // gated by the "Stamp survivor" checkbox (opts.stamp_merged, default on) — same control as merge.
    let stampNote = '';
    if (opts.stamp_merged !== false && process.env.MERGE_STAMP_SURVIVOR !== 'false') {   // checkbox + global off-switch
      try { const st = await W.stamp_survivor(conn, e.survivor_account, 'RESTORE', createdBy || 'salesforce_merge_tool');
        if (st.stamped) stampNote = ', stamped ' + st.count + ' field(s)'; } catch (se) { /* best-effort */ }
    }
    const keptNote = keepSet.size ? ', kept ' + keepSet.size + ' current' : '';
    const reason = 'undeleted ' + toUndelete.length + ', re-pointed ' + repointed
      + ', reset ' + resetCount + ' field(s)' + keptNote + stampNote
      + (skippedCh ? ', skipped ' + skippedCh : '') + (masterOk ? '' : ', master-reset partial')
      + (notes.length ? ' — ' + notes.slice(0, 5).join('; ') : '');
    const hres = await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
      survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
      result: 'restored', reason, diff: { kind: 'restore', reset: resetPlan, kept: [...keepSet] } });
    // Dossier: RESTORE attaches to ALL affected records — the survivor + the undeleted losers + the
    // re-pointed children — with one file, many links. Best-effort; never undoes the restore.
    if (DOS.attach_enabled(opts)) {
      try {
        const targets = [e.survivor_account, ...toUndelete, ...repointable.map((c) => c && c.id)].filter(Boolean);
        const dres = await DOS.generate({ run_id: runId, queue_id: e.id, action: 'RESTORE', actor: createdBy || 'salesforce_merge_tool',
          environment: e.environment, org_id: e.org_id, result: 'restored', reason, survivor_account: e.survivor_account,
          survivor_name: e.survivor_name, conn, targets }, { write: W });
        if (dres.dossier_id != null && typeof H.set_dossier === 'function') await H.set_dossier(hres && hres.id, dres.dossier_id, dres.content_document_id);
      } catch (derr) { log('dossier skipped (restore) for ' + e.survivor_account + ': ' + (derr && derr.message)); }
    }
    out.restored += 1; out.results.push({ id: e.id, result: 'restored', undeleted: toUndelete.length, repointed, skipped: skippedCh, reset_fields: resetCount, kept_fields: keepSet.size, notes });
    log((e.survivor_name || e.id) + ' — RESTORED: ' + reason);
    completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed });
  }

  log('run ' + runId + ' complete: restored=' + out.restored + ' simulated=' + out.simulated + ' skipped=' + out.skipped + ' failed=' + out.failed);
  if (apiStartLogged && conn) { try { const uEnd = await APIUSE.usage_all(conn); if (uEnd && uEnd.api) APIUSE.record({ env: env, org_id: orgId, op: 'restore', run_id: runId, actor: createdBy, used: uEnd.api.used, max: uEnd.api.max, apex_used: uEnd.apex && uEnd.apex.used, apex_max: uEnd.apex && uEnd.apex.max, bulk_used: uEnd.bulk && uEnd.bulk.used, bulk_max: uEnd.bulk && uEnd.bulk.max }); } catch (e) { /* fire-and-forget */ } }
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
  const DOS = deps.dossier || require('./merge_dossier');
  const createdBy = opts.created_by || null;

  const idset = new Set((ids || []).map((x) => Number(x)));
  const pending = await Q.list(undefined, 'recreate_pending');
  const entries = pending.filter((e) => idset.has(Number(e.id)));
  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  const is_test = env !== 'Production';
  const orgId = (entries[0] && entries[0].org_id) || null;   // stamp the run/history with the set's org (lineage)

  const armed = execution_enabled() && opts.mode === 'execute' && opts.confirm === 'RECREATE';
  const mode = armed ? 'execute' : 'simulate';
  const runId = opts.run_id || make_recreate_run_id();
  if (opts.run_id) {
    await RUN.update(runId, { mode, environment: env, org_id: orgId, total_sets: entries.length, total_ops: entries.length });
  } else {
    await RUN.start({ run_id: runId, kind: 'recreate', mode, environment: env, org_id: orgId, total_sets: entries.length, total_ops: entries.length, created_by: createdBy });
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
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'skipped', reason: 'no backup snapshot to recreate from' });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: 'no snapshot' });
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    if (!armed) {
      await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'simulated', reason: 'recreate preview — ' + losers.length + ' account(s) + ' + children.length + ' child link(s) from backup (NEW ids)' });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', accounts: losers.length, children: children.length });
      log((e.survivor_name || e.id) + ' — recreate preview (' + losers.length + ' accounts)');
      completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed }); continue;
    }

    try { if (!conn) conn = await W.default_write_connect(is_test); } catch (err) {
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, org_id: e.org_id, mode, result: 'failed', reason: 'connection failed: ' + err.message });
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
        if (!(ch && ch.object && ch.id && ch.parent_field && newParent)) continue;
        // File share: can't be re-parented by update — additively create a link to the rebuilt (new-id) loser.
        if (ch.object === 'ContentDocumentLink') { const r = await move_content_link(W, conn, ch, newParent); if (r.ok) childOk += 1; continue; }
        await W.update_record(conn, ch.object, { Id: ch.id, [ch.parent_field]: newParent });
        childOk += 1;
      }
      // Selective survivor reset (same keep-current choices as restore).
      const keepSet = new Set((opts.keep_fields && (opts.keep_fields[e.id] || opts.keep_fields[String(e.id)])) || []);
      const reset = master_reset_fields(master, e.survivor_account, keepSet);
      const resetPlan = Object.entries(reset).filter(([k]) => k !== 'Id').map(([field, value]) => ({ field, value }));
      if (resetPlan.length > 0) await W.update_record(conn, 'Account', reset);
      await Q.transition([e.id], 'recreated', ['recreate_pending']);
      // Lifecycle stamp: losers rebuilt from backup, so the survivor is no longer a merge product.
      // Gated by the "Stamp survivor" checkbox (opts.stamp_merged, default on) — same control as merge.
      let stampNote = '';
      if (opts.stamp_merged !== false && process.env.MERGE_STAMP_SURVIVOR !== 'false') {   // checkbox + global off-switch
        try { const st = await W.stamp_survivor(conn, e.survivor_account, 'RECREATE', createdBy || 'salesforce_merge_tool');
          if (st.stamped) stampNote = ', stamped ' + st.count + ' field(s)'; } catch (se) { /* best-effort */ }
      }
      const recReason = 'recreated ' + losers.length + ' account(s) (NEW ids), re-pointed ' + childOk + ' child link(s), reset ' + resetPlan.length + ' field(s)' + (keepSet.size ? ', kept ' + keepSet.size + ' current' : '');
      const hres = await H.write({ run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
        survivor_account: e.survivor_account, survivor_name: e.survivor_name, environment: e.environment, org_id: e.org_id, mode,
        result: 'recreated', reason: recReason + stampNote,
        diff: { kind: 'recreate', reset: resetPlan, kept: [...keepSet] } });
      // Dossier: RECREATE attaches to the survivor + the NEW loser accounts + the re-pointed children.
      if (DOS.attach_enabled(opts)) {
        try {
          const targets = [e.survivor_account, ...Object.values(idMap), ...children.map((c) => c && c.id)].filter(Boolean);
          const dres = await DOS.generate({ run_id: runId, queue_id: e.id, action: 'RECREATE', actor: createdBy || 'salesforce_merge_tool',
            environment: e.environment, org_id: e.org_id, result: 'recreated', reason: recReason, survivor_account: e.survivor_account,
            survivor_name: e.survivor_name, new_ids: idMap, conn, targets }, { write: W });
          if (dres.dossier_id != null && typeof H.set_dossier === 'function') await H.set_dossier(hres && hres.id, dres.dossier_id, dres.content_document_id);
        } catch (derr) { log('dossier skipped (recreate) for ' + e.survivor_account + ': ' + (derr && derr.message)); }
      }
      out.recreated += 1; out.results.push({ id: e.id, result: 'recreated', accounts: losers.length, children: childOk, new_ids: idMap, reset_fields: resetPlan.length, kept_fields: keepSet.size });
      log((e.survivor_name || e.id) + ' — RECREATED ' + losers.length + ' accounts (new ids)');
    } catch (err) {
      log((e.survivor_name || e.id) + ' — RECREATE FAILED: ' + (err && err.message));
      await H.write({ run_id: runId, queue_id: e.id, environment: e.environment, org_id: e.org_id, mode, result: 'failed', reason: 'recreate halted: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
    }
    completed += 1; await RUN.update(runId, { completed_ops: completed, completed_sets: completed });
  }

  log('recreate run ' + runId + ' complete: recreated=' + out.recreated + ' simulated=' + out.simulated + ' skipped=' + out.skipped + ' failed=' + out.failed);
  await RUN.finish(runId, { status: 'done', completed_ops: completed, completed_sets: completed, current_label: 'Complete' });
  return out;
}

module.exports = { restore, list_restorable, list_recreatable, recreate, status, deleted_set, account_states, survivor_last_modified, from_snapshot, recreate_plan_from_snapshot, account_create_fields, master_reset_fields, execution_enabled, make_run_id, _is_fls_error };
