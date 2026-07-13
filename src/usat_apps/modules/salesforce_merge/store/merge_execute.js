'use strict';
// Phase 3b — the single WRITE chokepoint for merges. SAFE BY DEFAULT: a real Salesforce merge runs
// only when the full gate stack is satisfied (MERGE_ENABLE_EXECUTION=true + mode 'execute' + typed
// 'MERGE' confirm + environment/org alignment). Otherwise every entry is SIMULATED — the whole
// pipeline runs (re-fetch, drift check, child-aware snapshot, field plan) but no Salesforce write
// happens. Failure policy is FAIL-STOP, NO auto-revert. All deps are injectable for tests.
const dashboard = require('./duplicates_read');
const cluster = require('./cluster_detail');
// salesforce_read / salesforce_write are lazy-required inside runQueue (only used as injected-dep
// defaults at run time) so the module loads without initializing the Salesforce connection layer.
const mqueue = require('./merge_queue');
const snapshot = require('./merge_snapshot');
const history = require('./merge_history');
const mrun = require('./merge_run');
const APIUSE = require('./api_usage');

// Deploy-level gate, default false. Read at call time so it can be toggled (tests / env) without reload.
function execution_enabled() { return process.env.MERGE_ENABLE_EXECUTION === 'true'; }
const DEFAULT_OP_SECONDS = 2; // rough per merge-call estimate until real history refines it
function safe_mode() { return !execution_enabled(); }
function make_run_id() { return 'mrun-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
const ceil2 = (n) => Math.ceil((Number(n) || 0) / 2);
// Server-side progress logs (stdout). Silence with MERGE_LOG=off (tests set this).
function log(...a) { if (process.env.MERGE_LOG !== 'off') console.log('[merge]', ...a); }

// Survivorship: which field values to WRITE onto the master. Precedence override > master non-blank >
// first loser non-blank (backfill). Only fields whose chosen value differs from master are returned.
function build_master_fields(accounts, survivorId, overrides) {
  const SKIP = new Set(['account', 'contact', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate']);
  const master = accounts.find((a) => a.account === survivorId) || {};
  const losers = accounts.filter((a) => a.account !== survivorId);
  const blank = (v) => v === undefined || v === null || v === '';
  const fields = new Set();
  for (const a of accounts) for (const k of Object.keys(a)) if (!SKIP.has(k)) fields.add(k);
  const out = {};
  for (const f of fields) {
    const ov = overrides ? overrides[f] : undefined;
    if (!blank(ov)) { if (ov !== master[f]) out[f] = ov; continue; }
    if (blank(master[f])) {
      const donor = losers.find((l) => !blank(l[f]));
      if (donor) out[f] = donor[f];
    }
  }
  return out;
}

// Alignment guard: a queued set must match the org we'd write to (environment label + org id).
function verify_alignment(entry, ctx) {
  if (entry.environment && ctx.environment && entry.environment !== ctx.environment) {
    return { ok: false, reason: 'environment mismatch (queued ' + entry.environment + ', current ' + ctx.environment + ')' };
  }
  if (entry.org_id && ctx.org_id && entry.org_id !== ctx.org_id) {
    return { ok: false, reason: 'org mismatch (queued ' + entry.org_id + ', connected ' + ctx.org_id + ')' };
  }
  return { ok: true };
}

async function status(deps = {}) {
  const dash = deps.dashboard || dashboard;
  const ds = await dash.dataset_info().catch(() => null);
  return {
    safe_mode: safe_mode(),
    execution_enabled: execution_enabled(),
    environment: ds ? ds.environment : null,
    data_as_of: ds ? ds.run_at : null,
  };
}

function histbase(runId, e, createdBy, mode) {
  return {
    run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
    survivor_account: e.survivor_account, survivor_name: e.survivor_name, loser_count: e.loser_count,
    environment: e.environment, org_id: e.org_id, master_rule: e.master_rule, mode,
  };
}

async function runQueue(ids, opts = {}, deps = {}) {
  const Q = deps.queue || mqueue;
  const C = deps.cluster || cluster;
  const SN = deps.snapshot || snapshot;
  const H = deps.history || history;
  const RUN = deps.run || mrun;
  const CTRL = deps.control || require('./merge_control');
  const SF = deps.sf || require('./salesforce_read');
  const W = deps.write || require('./salesforce_write');
  const dash = deps.dashboard || dashboard;
  const createdBy = opts.created_by || null;

  const idset = new Set((ids || []).map((x) => Number(x)));
  const approved = await Q.list(undefined, 'approved');
  const entries = approved.filter((e) => idset.has(Number(e.id)));

  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  const is_test = env !== 'Production';
  let ctxOrg = opts.org_id || null;
  try { const oi = await SF.get_org_identity({ is_test }); if (oi && oi.org_id) ctxOrg = oi.org_id; } catch (e) { /* best effort */ }
  const ctx = { environment: env, org_id: ctxOrg };

  const wantExecute = opts.mode === 'execute' && !opts.dry_run;
  const gates = { flag: execution_enabled(), mode: wantExecute, confirm: opts.confirm === 'MERGE' };
  const armed = gates.flag && gates.mode && gates.confirm;
  const mode = armed ? 'execute' : 'simulate';

  const totalOps = entries.reduce((s, e) => s + Math.max(1, ceil2(e.loser_count)), 0);
  const runId = opts.run_id || make_run_id();
  if (opts.run_id) {
    await RUN.update(runId, { mode, environment: env, org_id: ctxOrg, total_ops: totalOps, total_sets: entries.length, est_seconds: totalOps * DEFAULT_OP_SECONDS });
  } else {
    await RUN.start({ run_id: runId, kind: 'merge', mode, environment: env, org_id: ctxOrg,
      total_ops: totalOps, total_sets: entries.length, est_seconds: totalOps * DEFAULT_OP_SECONDS, created_by: createdBy });
  }

  log('run ' + runId + ' mode=' + mode + ' sets=' + entries.length + ' ops=' + totalOps + ' env=' + env);
  const out = { run_id: runId, environment: env, org_id: ctxOrg, mode, armed, gates,
    processed: 0, simulated: 0, done: 0, skipped: 0, failed: 0, results: [] };
  let completedOps = 0; let completedSets = 0;
  let conn = null;
  let apiStartLogged = false;

  for (let si = 0; si < entries.length; si += 1) {
    // Cooperative cancel: a Stop request flags this run id; we honor it at the SET boundary so every
    // set is left whole (finished sets stay done/skipped/failed; remaining sets stay approved).
    if (await CTRL.is_cancelled(runId)) {
      out.cancelled = true;
      out.remaining = entries.length - si;
      log('run ' + runId + ' STOP requested — halting before set ' + (si + 1) + ' of ' + entries.length);
      break;
    }
    const e = entries[si];
    out.processed += 1;
    const label = (n) => 'Set ' + (si + 1) + ' of ' + entries.length + (e.survivor_name ? ' · ' + e.survivor_name : '') + (n ? ' · ' + n : '');
    await RUN.update(runId, { stage: 'fetch', current_label: label('re-fetching + dry-run') });
    log(label('re-fetching'));

    const align = verify_alignment(e, ctx);
    if (!align.ok) {
      await H.write({ ...histbase(runId, e, createdBy, mode), snapshot_saved: 0, result: 'skipped', reason: align.reason });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: align.reason });
      completedOps += Math.max(1, ceil2(e.loser_count)); completedSets += 1;
      await RUN.update(runId, { completed_ops: completedOps, completed_sets: completedSets });
      continue;
    }

    let detail = null;
    try { detail = await C.cluster_detail(e.source_key, { kind: e.source_type }); } catch (err) { detail = null; }
    const accounts = (detail && detail.accounts) || [];
    const present = new Set(accounts.map((a) => a.account));
    const losers = String(e.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);
    const missing = [e.survivor_account].concat(losers).filter((id) => id && !present.has(id));
    if (!accounts.length || missing.length) {
      const reason = accounts.length ? ('records changed since queueing (' + missing.length + ' missing)') : 'no records found (drift or wrong org)';
      await H.write({ ...histbase(runId, e, createdBy, mode), snapshot_saved: 0, result: 'skipped', reason });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason });
      completedOps += Math.max(1, ceil2(e.loser_count)); completedSets += 1;
      await RUN.update(runId, { completed_ops: completedOps, completed_sets: completedSets });
      continue;
    }

    await RUN.update(runId, { stage: 'validate', current_label: label('re-validated') });
    await RUN.update(runId, { stage: 'snapshot', current_label: label('gathering child records') });
    log(label('gathering child records'));
    let snap_ok = false;
    try {
      const contactByAccount = {};
      for (const a of accounts) if (a.contact) contactByAccount[a.account] = a.contact;
      const children = await SF.fetch_children(accounts.map((a) => a.account), { is_test, contactByAccount }).catch(() => []);
      await SN.save(runId, e, accounts, children);
      snap_ok = true;
    } catch (err) { snap_ok = false; }

    await RUN.update(runId, { stage: 'snapshot', current_label: label('snapshot saved') });
    const masterFields = build_master_fields(accounts, e.survivor_account, e.field_overrides);
    const childTotal = (e.child_counts && e.child_counts.total) || 0;
    const opCount = Math.max(1, ceil2(losers.length));

    if (!armed) {
      if (H.clear_simulated) await H.clear_simulated(e.id).catch(() => {});
      await H.write({ ...histbase(runId, e, createdBy, mode), child_total: childTotal, snapshot_saved: snap_ok ? 1 : 0,
        result: 'simulated', reason: opts.dry_run ? 'dry-run' : 'safe mode / simulate — no Salesforce write',
        planned_fields: Object.keys(masterFields).length });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated', planned_field_changes: Object.keys(masterFields).length });
      log(label('simulated — ' + Object.keys(masterFields).length + ' field change(s) planned'));
      completedOps += opCount; completedSets += 1;
      await RUN.update(runId, { stage: 'record', completed_ops: completedOps, completed_sets: completedSets, current_label: label('simulated') });
      continue;
    }

    if (!conn) { try { conn = await W.default_write_connect(is_test); } catch (err) {
      await H.write({ ...histbase(runId, e, createdBy, mode), snapshot_saved: snap_ok ? 1 : 0, result: 'failed', reason: 'write connection failed: ' + err.message });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: err.message });
      await RUN.finish(runId, { status: 'error', completed_ops: completedOps, completed_sets: completedSets, current_label: 'connection failed' });
      CTRL.clear(runId);
      return out;
    } }

    if (!apiStartLogged) { apiStartLogged = true; try { const u0 = APIUSE.usage_from_conn(conn); if (u0) APIUSE.record({ env: env, org_id: ctxOrg, op: 'merge', run_id: runId, actor: createdBy, used: u0.used, max: u0.max }); } catch (e) { /* fire-and-forget */ } }

    const merged = []; let remaining = losers.slice(); let failure = null; let first = true;
    for (let i = 0; i < losers.length; i += 2) {
      const batch = losers.slice(i, i + 2);
      let res;
      try { res = await W.merge_one(conn, e.survivor_account, batch, first ? masterFields : {}); }
      catch (err) { failure = err.message; break; }
      first = false;
      completedOps += 1;
      await RUN.update(runId, { stage: 'merge', completed_ops: completedOps, current_label: label('batch ' + ((i / 2) + 1) + '/' + opCount) });
      log(label('merging batch ' + ((i / 2) + 1) + '/' + opCount));
      if (!res.success) { failure = (res.errors && res.errors[0] && (res.errors[0].message || res.errors[0].statusCode)) || 'merge failed'; break; }
      merged.push(...batch); remaining = remaining.filter((x) => !batch.includes(x));
    }

    if (failure) {
      await Q.transition([e.id], 'failed', ['approved']);
      await H.write({ ...histbase(runId, e, createdBy, mode), child_total: childTotal, snapshot_saved: snap_ok ? 1 : 0,
        result: 'failed', reason: 'halted: ' + failure + ' (merged ' + merged.length + ', remaining ' + remaining.length + ')',
        merged_count: merged.length, remaining_count: remaining.length });
      out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: failure, merged: merged.length, remaining: remaining.length });
      log(label('FAILED — ' + failure));
    } else {
      // Optional: stamp the survivor as merged. Done AFTER the merge as a best-effort update so a
      // missing custom field (was_merged__c / was_merged_date__c) never fails the merge itself.
      let stampNote = '';
      if (opts.stamp_merged) {
        try {
          await W.update_record(conn, 'Account', { Id: e.survivor_account, was_merged__c: true, was_merged_date__c: new Date().toISOString() });
          stampNote = '; stamped was_merged__c';
        } catch (err) { stampNote = '; stamp skipped (' + err.message + ')'; }
      }
      await Q.transition([e.id], 'done', ['approved']);
      await H.write({ ...histbase(runId, e, createdBy, mode), child_total: childTotal, snapshot_saved: snap_ok ? 1 : 0,
        result: 'done', reason: 'merged ' + merged.length + ' record(s)' + stampNote, merged_count: merged.length, remaining_count: 0 });
      out.done += 1; out.results.push({ id: e.id, result: 'done', merged: merged.length });
      log(label('done — merged ' + merged.length + stampNote));
    }
    completedSets += 1;
    await RUN.update(runId, { stage: 'record', completed_sets: completedSets });
  }

  const stopped = out.cancelled === true;
  const finalStatus = stopped ? 'cancelled' : 'done';
  const finalLabel = stopped
    ? 'Stopped — ' + completedSets + ' of ' + entries.length + ' set(s) processed'
    : 'Complete';
  log('run ' + runId + (stopped ? ' STOPPED' : ' complete') + ': done=' + out.done + ' simulated=' + out.simulated + ' skipped=' + out.skipped + ' failed=' + out.failed + (stopped ? ' (remaining ' + (out.remaining || 0) + ')' : ''));
  try { const uEnd = APIUSE.usage_from_conn(conn); if (uEnd) APIUSE.record({ env: env, org_id: ctxOrg, op: 'merge', run_id: runId, actor: createdBy, used: uEnd.used, max: uEnd.max }); } catch (e) { /* fire-and-forget */ }
  await RUN.finish(runId, { status: finalStatus, completed_ops: completedOps, completed_sets: completedSets, current_label: finalLabel });
  CTRL.clear(runId);
  return out;
}

module.exports = { process: runQueue, status, verify_alignment, build_master_fields, safe_mode, execution_enabled, make_run_id };
