'use strict';
// Phase 3 — the single write chokepoint. Processes APPROVED queue entries. SAFE BY DEFAULT: unless
// MERGE_ENABLE_EXECUTION=true, no Salesforce write ever happens — each entry is validated, snapshotted
// (backup), and recorded as 'simulated'. The actual Database.merge (Phase 3b) is intentionally not
// implemented here, so even with the flag on it refuses rather than risk an unconfigured write.
// Every dependency is injectable for tests.
const dashboard = require('./duplicates_read');
const cluster = require('./cluster_detail');
const sfread = require('./salesforce_read');
const mqueue = require('./merge_queue');
const snapshot = require('./merge_snapshot');
const history = require('./merge_history');

const EXECUTION_ENABLED = process.env.MERGE_ENABLE_EXECUTION === 'true'; // default false
function safe_mode() { return !EXECUTION_ENABLED; }
function make_run_id() { return 'mrun-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

// The queued entry's lineage must match the org we'd write to. Environment (Production/Sandbox) is the
// label guard; org_id is the deterministic guard when both sides are known.
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
    execution_enabled: EXECUTION_ENABLED,
    environment: ds ? ds.environment : null,
    data_as_of: ds ? ds.run_at : null,
  };
}

function histbase(runId, e, createdBy) {
  return {
    run_id: runId, queue_id: e.id, created_by: createdBy, source_type: e.source_type, source_key: e.source_key,
    survivor_account: e.survivor_account, survivor_name: e.survivor_name, loser_count: e.loser_count,
    environment: e.environment, org_id: e.org_id, master_rule: e.master_rule,
  };
}

async function runQueue(ids, opts = {}, deps = {}) {
  const Q = deps.queue || mqueue;
  const C = deps.cluster || cluster;
  const SN = deps.snapshot || snapshot;
  const H = deps.history || history;
  const dash = deps.dashboard || dashboard;
  const SF = deps.sf || sfread;
  const createdBy = opts.created_by || null;

  const idset = new Set((ids || []).map((x) => Number(x)));
  const approved = await Q.list(undefined, 'approved');
  const entries = approved.filter((e) => idset.has(Number(e.id)));

  const ds = await dash.dataset_info().catch(() => null);
  const env = ds ? ds.environment : null;
  let ctxOrg = opts.org_id || null;
  try { const oi = await SF.get_org_identity({ is_test: env !== 'Production' }); if (oi && oi.org_id) ctxOrg = oi.org_id; } catch (e) { /* best effort */ }
  const ctx = { environment: env, org_id: ctxOrg };

  const runId = make_run_id();
  const out = { run_id: runId, environment: env, org_id: ctxOrg, safe_mode: safe_mode(),
    processed: 0, simulated: 0, skipped: 0, failed: 0, results: [] };

  for (const e of entries) {
    out.processed += 1;
    const align = verify_alignment(e, ctx);
    if (!align.ok) {
      await H.write({ ...histbase(runId, e, createdBy), snapshot_saved: 0, result: 'skipped', reason: align.reason });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason: align.reason });
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
      await H.write({ ...histbase(runId, e, createdBy), snapshot_saved: 0, result: 'skipped', reason });
      out.skipped += 1; out.results.push({ id: e.id, result: 'skipped', reason });
      continue;
    }
    let snap_ok = false;
    try { await SN.save(runId, e, accounts); snap_ok = true; } catch (err) { snap_ok = false; }
    const childTotal = (e.child_counts && e.child_counts.total) || 0;

    if (safe_mode() || opts.dry_run) {
      await H.write({ ...histbase(runId, e, createdBy), child_total: childTotal, snapshot_saved: snap_ok ? 1 : 0,
        result: 'simulated', reason: opts.dry_run ? 'dry-run' : 'safe mode — no Salesforce write' });
      out.simulated += 1; out.results.push({ id: e.id, result: 'simulated' });
      continue;
    }
    // Execution path (Phase 3b) — no merge endpoint configured; refuse rather than risk a write.
    await H.write({ ...histbase(runId, e, createdBy), child_total: childTotal, snapshot_saved: snap_ok ? 1 : 0,
      result: 'failed', reason: 'merge execution endpoint not configured (Phase 3b)' });
    out.failed += 1; out.results.push({ id: e.id, result: 'failed', reason: 'no merge endpoint' });
  }
  return out;
}

module.exports = { process: runQueue, status, verify_alignment, safe_mode, make_run_id, EXECUTION_ENABLED };
