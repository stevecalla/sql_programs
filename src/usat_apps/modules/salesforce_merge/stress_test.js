'use strict';
// Merge stress-test harness (sandbox‑first). Drives the REAL merge pipeline through the running
// server's HTTP endpoints (queue → approve → process → progress → restore) and writes a consolidated
// Excel report to the external /data folder. This file currently ships the pure selection helpers +
// the cluster-size DISTRIBUTION view; the run sequence builds on these.
//
//   node src/usat_apps/modules/salesforce_merge/stress_test.js distribution   # show cluster-size histogram
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

// ---- pure helpers (unit-tested; no DB / network) ---------------------------------------------

// Build a size distribution from GROUP BY rows [{ size, n }] -> per-size pct + cumulative pct,
// totals, min/max, and the p95 size (95% of clusters are this size or smaller) so extremes are obvious.
function build_distribution(rows) {
  const clean = (rows || [])
    .map((r) => ({ size: Number(r.size) || 0, n: Number(r.n) || 0 }))
    .filter((r) => r.size > 0 && r.n > 0)
    .sort((a, b) => a.size - b.size);
  const total = clean.reduce((s, r) => s + r.n, 0);
  const records = clean.reduce((s, r) => s + r.size * r.n, 0);
  let cum = 0;
  const out = clean.map((r) => { cum += r.n; return { size: r.size, n: r.n, pct: total ? (r.n / total) * 100 : 0, cum_pct: total ? (cum / total) * 100 : 0 }; });
  const min = clean.length ? clean[0].size : 0;
  const max = clean.length ? clean[clean.length - 1].size : 0;
  const p95 = (out.find((r) => r.cum_pct >= 95) || out[out.length - 1] || { size: max }).size;
  return { rows: out, total, records, min, max, p95 };
}

// Render the distribution as a console histogram.
function format_distribution(dist, width = 28) {
  const maxN = dist.rows.reduce((m, r) => Math.max(m, r.n), 0) || 1;
  const header = `  ${'size'.padStart(4)}  ${'clusters'.padStart(9)}  ${'%'.padStart(6)}  ${'cum%'.padStart(6)}`;
  const lines = dist.rows.map((r) => {
    const bar = '#'.repeat(Math.max(1, Math.round((r.n / maxN) * width)));
    return `  ${String(r.size).padStart(4)}  ${r.n.toLocaleString().padStart(9)}  ${r.pct.toFixed(1).padStart(5)}%  ${r.cum_pct.toFixed(1).padStart(5)}%  ${bar}`;
  });
  const footer = `  total: ${dist.total.toLocaleString()} clusters · ${dist.records.toLocaleString()} records · sizes ${dist.min}-${dist.max} · 95% are size <= ${dist.p95}`;
  return [header, ...lines, footer].join('\n');
}

// Keep only clusters whose size is within [min, max] (either bound optional).
function in_size_range(size, min, max) {
  const s = Number(size) || 0;
  if (min != null && min !== '' && s < Number(min)) return false;
  if (max != null && max !== '' && s > Number(max)) return false;
  return true;
}

// Resolve the target environment from argv. Default 'sandbox'; --env production / --env prod / --prod -> production.
function resolve_env(argv) {
  const a = (argv || []).map((x) => String(x).toLowerCase());
  const i = a.indexOf('--env');
  const v = i >= 0 ? a[i + 1] : (a.includes('--prod') ? 'production' : 'sandbox');
  return (v === 'production' || v === 'prod') ? 'production' : 'sandbox';
}

// Normalize the snapshot's stored env value ('test'/'prod'/'sandbox'/'production') to sandbox|production.
function normalize_env(v) {
  const x = String(v || '').toLowerCase();
  return (x === 'prod' || x === 'production') ? 'production' : 'sandbox';
}

// Deterministic RNG so a run can be reproduced with the same --seed.
function mulberry32(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded random sample of `count` items (Fisher–Yates with a seeded RNG; same seed -> same pick).
function sample(items, count, seed = 1) {
  const arr = (items || []).slice();
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr.slice(0, Math.max(0, Number(count) || 0));
}

// Split ids into batches of `size` (the "execute N per cycle" control).
function plan_batches(ids, size) {
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < (ids || []).length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

// Roll per-set outcomes up into totals for the console + report Summary.
function summarize(records, elapsed_ms) {
  const r = records || [];
  const by = (s) => r.filter((x) => x.outcome === s).length;
  const done = by('done') + by('merged') + by('simulated');
  const failed = by('failed') + by('error');
  const held = by('held');
  const secs = Math.max(0.001, (Number(elapsed_ms) || 0) / 1000);
  return {
    total: r.length, done, failed, held,
    per_min: Math.round((r.length / secs) * 60 * 10) / 10,
    seconds: Math.round(secs),
  };
}

// Format seconds as hh:mm:ss.
function fmt_hms(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// Preview the sampled sets (survivor · loser count · cluster key) before processing starts.
function format_selection(entries, cap = 25) {
  const list = entries || [];
  const lines = list.slice(0, cap).map((e, i) => {
    const losers = Array.isArray(e.loser_accounts) ? e.loser_accounts.length : String(e.loser_accounts || '').split(';').filter(Boolean).length;
    const key = String(e.source_key || '');
    const shortKey = key.length > 44 ? key.slice(0, 41) + '...' : key;
    return `        ${String(i + 1).padStart(3)}. ${e.survivor_name || '(no name)'} · survivor ${e.survivor_account} · ${losers} loser(s) · ${shortKey}`;
  });
  if (list.length > cap) lines.push(`        ... and ${list.length - cap} more`);
  return lines.join('\n');
}

// ---- DB-backed (not exercised by unit tests) -------------------------------------------------

async function get_distribution(query) {
  const q = query || require('../../store/db').query;
  const cfg = require('../../../salesforce_duplicates/config');
  const rows = await q('SELECT CAST(Group_Record_Count__c AS UNSIGNED) AS size, COUNT(*) AS n FROM `'
    + cfg.RESULT_CONSOLIDATED_TABLE + '` GROUP BY size ORDER BY size', []);
  return build_distribution(rows);
}

async function get_dataset_stamp(query) {
  const q = query || require('../../store/db').query;
  const cfg = require('../../../salesforce_duplicates/config');
  const rows = await q('SELECT MIN(environment) AS env, MIN(org_id) AS org_id, MAX(loaded_at) AS as_of, COUNT(*) AS records FROM `'
    + cfg.SNAPSHOT_TABLE_NAME + '`', []);
  const r = (rows && rows[0]) || {};
  return { env: normalize_env(r.env), org_id: r.org_id || '', as_of: r.as_of || null, records: Number(r.records) || 0 };
}

const RUN_TABLES = [
  'salesforce_merge_queue', 'salesforce_merge_stage_baseline', 'salesforce_merge_premerge_snapshot',
  'salesforce_merge_postmerge_snapshot', 'salesforce_merge_history', 'salesforce_merge_run', 'salesforce_merge_dossier',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function db() { return require('../../store/db').query; }
function stores() {
  return {
    mqueue: require('./store/merge_queue'),
    mrun: require('./store/merge_run'),
    reviews: require('./store/reviews_read'),
    api_usage: require('./store/api_usage'),
    cfg: require('../../../salesforce_duplicates/config'),
  };
}

// TRUNCATE the merge tool's own run/queue tables (never the finder input).
async function clear_run_tables() {
  const q = db();
  const done = [];
  for (const t of RUN_TABLES) {
    try { await q('TRUNCATE TABLE `' + t + '`', []); done.push(t); }
    catch (e) { try { await q('DELETE FROM `' + t + '`', []); done.push(t + ' (delete)'); } catch (e2) { done.push(t + ' (skip)'); } }
  }
  return done;
}

// Pick candidate cluster keys within the size band, random-sample `count`, resolve to queue entries.
async function select_targets(o, stamp) {
  const q = db();
  const { reviews, cfg } = stores();
  let picked = [];
  let pool = 0;
  if (o.source === 'merge_id') {
    const groups = await reviews.resolve_merge_groups({}, q);
    pool = groups.length;
    picked = sample(groups.map((g) => g.merge_id).filter(Boolean), o.count, o.seed);
    const resolved = await reviews.resolve_merge_groups({ keys: picked }, q);
    return build_entries(resolved, 'merge_id', o, stamp, pool, picked.length);
  }
  const where = ['1=1']; const params = [];
  if (o.min_size) { where.push('CAST(Group_Record_Count__c AS UNSIGNED) >= ?'); params.push(Number(o.min_size)); }
  if (o.max_size) { where.push('CAST(Group_Record_Count__c AS UNSIGNED) <= ?'); params.push(Number(o.max_size)); }
  const rows = await q('SELECT Consolidated_Group_Key__c AS k FROM `' + cfg.RESULT_CONSOLIDATED_TABLE + '` WHERE ' + where.join(' AND '), params);
  const keys = (rows || []).map((r) => r.k).filter(Boolean);
  pool = keys.length;
  picked = sample(keys, o.count, o.seed);
  const groups = await reviews.resolve_duplicate_groups({ keys: picked }, q);
  return build_entries(groups, 'group', o, stamp, pool, picked.length);
}

function build_entries(groups, source_type, o, stamp, pool, sampled) {
  const keyOf = (g) => (source_type === 'merge_id' ? g.merge_id : g.source_key);
  const entries = (groups || []).filter((g) => g.resolvable).map((g) => ({
    created_by: 'stress-test', source_type, source_key: keyOf(g), survivor_account: g.survivor,
    survivor_name: g.name, loser_accounts: g.losers, master_rule: g.rule || 'cascade',
    environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null,
  }));
  return { pool, sampled, entries };
}

async function queue_and_approve(entries) {
  const { mqueue } = stores();
  const r = await mqueue.add_many(entries);
  const ids = (r.added || []).filter((x) => x && x.id).map((x) => x.id);
  if (ids.length) await mqueue.transition(ids, 'approved', ['queued']);
  return ids;
}

// Poll a run until it leaves queued/running. onTick(row) for progress narration.
// Console verbosity: default COMPACT (one line per batch + a periodic global heartbeat) so a 200-merge
// run stays readable; --verbose restores the per-set/per-phase stream; --heartbeat <sec> tunes the beat.
const VERBOSE = process.argv.includes('--verbose');
const HEARTBEAT_MS = (() => { const i = process.argv.indexOf('--heartbeat'); const v = i >= 0 ? Number(process.argv[i + 1]) : NaN; return Number.isFinite(v) && v > 0 ? v * 1000 : 60000; })();

async function poll_run(run_id, opts = {}) {
  const { mrun } = stores();
  const total = opts.total || 0; const started = Date.now();
  const onTick = typeof opts.onTick === 'function' ? opts.onTick : null;
  let lastAt = 0; let lastDone = -1; let lastLabel = null;
  for (let i = 0; i < 100000; i += 1) {
    const row = await mrun.get(run_id);
    const done = (row && row.completed_sets) || 0; const now = Date.now();
    const label = row && row.current_label ? String(row.current_label).slice(0, 40) : '';
    if (onTick) onTick({ done, total, label, now });
    // VERBOSE only: per-phase stream. Compact mode is silent here — the caller drives a global heartbeat.
    if (VERBOSE && row && (done !== lastDone || label !== lastLabel || now - lastAt >= 20000)) {
      console.log(`        ${fmt_hms((now - started) / 1000)} · ${done}/${total} sets${label ? ' · ' + label : ''}`);
      lastAt = now; lastDone = done; lastLabel = label;
    }
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return row;
    await sleep(1000);
  }
  return await mrun.get(run_id);
}

function env_label(env) { return env === 'production' ? 'Production' : 'Sandbox'; }
async function get_pool_p() { return require('../../store/db').get_pool(); }

// Current daily API usage snapshot for an env: { used, max }. From the recorded api_usage table.
async function api_snapshot(env) {
  try {
    const pool = await get_pool_p(); const { api_usage } = stores();
    const r = await api_usage.latest(pool, env_label(env));
    return r && r.api_used != null ? {
      used: Number(r.api_used), max: Number(r.api_max) || null,
      apex_used: r.apex_used != null ? Number(r.apex_used) : null, apex_max: r.apex_max != null ? Number(r.apex_max) : null,
      bulk_used: r.bulk_used != null ? Number(r.bulk_used) : null, bulk_max: r.bulk_max != null ? Number(r.bulk_max) : null,
    } : null;
  } catch (e) { return null; }
}

// Measured cost of one run across its snapshots: DailyApiRequests + DailyAsyncApexExecutions + Bulk batches.
async function run_api_cost(run_id) {
  try { const pool = await get_pool_p(); const { api_usage } = stores();
    const r = await api_usage.run_cost(pool, run_id);
    if (!r) return { api: null, apex: null, bulk: null };
    return { api: r.cost != null ? Number(r.cost) : null, apex: r.apex_cost != null ? Number(r.apex_cost) : null, bulk: r.bulk_cost != null ? Number(r.bulk_cost) : null };
  } catch (e) { return { api: null, apex: null, bulk: null }; }
}

// One history row per processed set, for the report's Merges tab.
async function history_for_runs(run_ids) {
  if (!run_ids || !run_ids.length) return [];
  const q = db(); const ph = run_ids.map(() => '?').join(',');
  const rows = await q('SELECT run_id, queue_id, source_key, survivor_account, survivor_name, loser_count, child_total, result, reason, dossier_id '
    + 'FROM `salesforce_merge_history` WHERE run_id IN (' + ph + ') ORDER BY id', run_ids);
  return rows || [];
}

async function run_sequence(o, stamp) {
  const { mrun } = stores();
  const started = Date.now();
  const isExec = o.mode === 'execute';
  console.log(`\n=== STRESS TEST · ${o.env} · ${o.mode.toUpperCase()} · source=${o.source === 'merge_id' ? 'merge-id' : 'duplicate'} · count=${o.count} · batch=${o.batch} · seed=${o.seed} ===`);

  if (o.do_clear) { console.log('\n[1/5] Clearing run tables…'); const c = await clear_run_tables(); console.log('      cleared: ' + c.join(', ')); }
  else console.log('\n[1/5] Skipping clear (keeping existing run tables).');

  console.log('\n[2/5] Selecting targets + queuing…');
  const sel = await select_targets(o, stamp);
  console.log(`      pool ${sel.pool} in size ${o.min_size || '-'}..${o.max_size || '-'} → sampled ${sel.sampled} → resolvable ${sel.entries.length}`);
  if (!sel.entries.length) { console.log('      nothing resolvable to queue — aborting.'); process.exit(1); }
  console.log('      selected sets (survivor · losers · cluster):');
  console.log(format_selection(sel.entries));
  const ids = await queue_and_approve(sel.entries);
  console.log(`      queued + approved ${ids.length} sets`);

  console.log(`\n[3/5] Processing (${o.mode}) in batches of ${o.batch}…${VERBOSE ? '' : '  (compact — --verbose for per-set detail)'}`);
  const batches = plan_batches(ids, o.batch);
  const api_before = await api_snapshot(o.env);
  const runs = [];
  const totalSets = ids.length; const seqStart = Date.now();
  let globalDone = 0; let lastHb = Date.now();
  const pauseRl = o.pause_batches ? require('readline').createInterface({ input: process.stdin, output: process.stdout }) : null;
  for (let bi = 0; bi < batches.length; bi += 1) {
    const batch = batches[bi];
    if (VERBOSE) console.log(`      batch ${bi + 1}/${batches.length} — enqueue ${batch.length} sets…`);
    const batchStart = Date.now();
    const { run_id } = await mrun.enqueue({ kind: 'merge', mode: o.mode,
      environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null, created_by: 'stress-test',
      params: { ids: batch, opts: { mode: o.mode, confirm: 'MERGE', dry_run: !isExec, ack_drift: true, stamp_merged: o.stamp, attach_dossier: o.dossier, created_by: 'stress-test' } } });
    const run = await poll_run(run_id, { total: batch.length, onTick: ({ done, now }) => {
      if (VERBOSE || now - lastHb < HEARTBEAT_MS) return;             // periodic global heartbeat only
      lastHb = now;
      const g = globalDone + done; const elapsed = (now - seqStart) / 1000;
      const pct = totalSets ? Math.round((g / totalSets) * 100) : 0;
      const eta = g > 0 ? (totalSets - g) * (elapsed / g) : 0;
      console.log(`        … ${g}/${totalSets} sets · ${pct}% · elapsed ${fmt_hms(elapsed)}${eta ? ' · ETA ~' + fmt_hms(eta) : ''}`);
    } });
    const c = await run_api_cost(run_id);
    const cost = c ? c.api : null;
    const snap = await api_snapshot(o.env);   // checkpoint the org's API + Apex + Bulk usage after this batch
    globalDone += batch.length;
    const bsec = Math.round((Date.now() - batchStart) / 1000);
    const apexLeft = (snap && snap.apex_max != null && snap.apex_used != null) ? (snap.apex_max - snap.apex_used) : null;
    // One compact line per batch + a running budget checkpoint (async Apex is the binding limit).
    console.log(`      batch ${bi + 1}/${batches.length} · ${batch.length} set(s) · ${run ? run.status : 'unknown'}${cost != null ? ' · ' + cost + ' API' : ''} · ${fmt_hms(bsec)} · [${globalDone}/${totalSets} done]${apexLeft != null ? ' · Apex left ' + apexLeft.toLocaleString() : ''}`);
    runs.push({ run_id, batch: batch.length, status: run ? run.status : 'unknown', cost, apex: c ? c.apex : null, bulk: c ? c.bulk : null, bsec, snap });
    lastHb = Date.now();
    if (pauseRl && bi < batches.length - 1) {
      const ans = await new Promise((res) => pauseRl.question(`      ↳ batch ${bi + 1}/${batches.length} done` + (apexLeft != null ? ` · Apex left ${apexLeft.toLocaleString()}` : '') + ' · continue to next batch? (Y/n): ', (a2) => res((a2 || '').trim().toLowerCase())));
      if (['n', 'no', 's', 'stop', 'q', 'quit'].includes(ans)) { console.log(`      Stopping after batch ${bi + 1}/${batches.length} — ${batches.length - bi - 1} batch(es) left approved (re-run option 30 to finish).`); break; }
    }
    if (o.pace_ms) await sleep(o.pace_ms);
  }
  if (pauseRl) pauseRl.close();
  const api_after = await api_snapshot(o.env);
  const merge_seconds = Math.round((Date.now() - seqStart) / 1000);   // total time in the merge batches

  let restore = null; let restore_seconds = 0;
  if (o.restore) {
    console.log('\n[4/5] Restoring…');
    const rStart = Date.now();
    const { run_id } = await mrun.enqueue({ kind: 'restore', mode: o.mode,
      environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null, created_by: 'stress-test',
      params: { ids, opts: { mode: o.mode, confirm: 'RESTORE', ack_post_merge: true, created_by: 'stress-test' } } });
    const r = await poll_run(run_id, { total: ids.length });
    restore_seconds = Math.round((Date.now() - rStart) / 1000);
    console.log(`      restore ${run_id} → ${r ? r.status : 'unknown'} in ${fmt_hms(restore_seconds)}`);
    const rhist = await history_for_runs([run_id]);   // attach per-set history so write_report emits the Restores tab
    restore = { run_id, status: r ? r.status : 'unknown', hist: rhist, seconds: restore_seconds };
  } else console.log('\n[4/5] Skipping restore.');

  console.log('\n[5/5] Writing report…');
  const seconds = Math.round((Date.now() - started) / 1000);
  const hist = await history_for_runs(runs.map((r) => r.run_id));
  const by = (r) => hist.filter((h) => h.result === r).length;
  const outcomes = { done: by('done'), simulated: by('simulated'), failed: by('failed'), held: by('held'), skipped: by('skipped') };
  const api_cost = runs.reduce((a, r) => a + (Number(r.cost) || 0), 0) || ((api_before && api_after) ? (api_after.used - api_before.used) : null);
  // Async Apex fires AFTER the merge (rollups queue as async jobs), so per-batch start/end deltas miss
  // it. The whole-run before/after delta is the reliable measure; fall back to the per-batch sum only if
  // we have no before/after snapshot.
  const apex_delta = (api_before && api_after && api_after.apex_used != null && api_before.apex_used != null) ? (api_after.apex_used - api_before.apex_used) : null;
  const apex_cost = apex_delta != null ? apex_delta : (runs.reduce((a, r) => a + (Number(r.apex) || 0), 0) || null);
  const bulk_delta = (api_before && api_after && api_after.bulk_used != null && api_before.bulk_used != null) ? (api_after.bulk_used - api_before.bulk_used) : null;
  const bulk_cost = bulk_delta != null ? bulk_delta : (runs.reduce((a, r) => a + (Number(r.bulk) || 0), 0) || null);
  const per_merge = (api_cost != null && hist.length) ? Math.round((api_cost / hist.length) * 10) / 10 : null;
  const apex_per_merge = (apex_cost != null && hist.length) ? Math.round((apex_cost / hist.length) * 10) / 10 : null;
  const remaining = (api_after && api_after.max != null) ? (api_after.max - api_after.used) : null;
  const apex_remaining = (api_after && api_after.apex_max != null && api_after.apex_used != null) ? (api_after.apex_max - api_after.apex_used) : null;
  const per_min = Math.round((hist.length / Math.max(0.001, seconds)) * 60 * 10) / 10;
  const data = { o, sel, runs, restore, seconds, merge_seconds, restore_seconds, per_min, hist, outcomes, api_cost, per_merge, remaining, apex_cost, apex_per_merge, apex_remaining, bulk_cost, api_before, api_after, stamp };
  print_summary(data);
  try { const f = await write_report(data); console.log('      report: ' + f); }
  catch (e) {
    console.log('      (report write skipped: ' + e.message + ')');
    if (restore && restore.hist && restore.hist.length) {
      try {
        const path = require('path'); const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
        const rf = await write_standalone_restore(path.join(determineOSPathSync(), 'usat_salesforce_merge_stress'), restore, seconds);
        console.log('      restore report (fallback): ' + rf);
      } catch (e2) { console.log('      (restore fallback also skipped: ' + e2.message + ')'); }
    }
  }
  try {
    const path = require('path'); const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
    const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
    const band = (o.min_size || '-') + '..' + (o.max_size || '-');
    const sf = await append_sweep_row(base, [now_local(), o.env, o.mode, o.source === 'merge_id' ? 'merge-id' : 'duplicate', band,
      o.count, o.batch, o.seed, hist.length, outcomes.done, outcomes.failed, per_min, api_cost, per_merge, apex_cost, apex_per_merge, fmt_hms(seconds), restore ? restore.status : 'skipped']);
    console.log('      sweep:  ' + sf);
  } catch (e) { console.log('      (sweep row skipped: ' + e.message + (/EBUSY|EPERM|EACCES|locked/i.test(e.message) ? ' — is _sweep_comparison.xlsx open in Excel? close it and re-run' : '') + ')'); }
  console.log('\n=== done ===\n');
  process.exit(0);
}

function print_summary(d) {
  console.log('\n  Summary:');
  console.log(`    sets processed     ${d.hist.length} (queued ${d.runs.reduce((s, r) => s + r.batch, 0)}, batches ${d.runs.length})`);
  console.log(`    outcomes           done ${d.outcomes.done} · simulated ${d.outcomes.simulated} · failed ${d.outcomes.failed} · held ${d.outcomes.held} · skipped ${d.outcomes.skipped}`);
  console.log(`    throughput         ${d.per_min}/min over ${fmt_hms(d.seconds)}`);
  console.log(`    merge time         ${fmt_hms(d.merge_seconds || 0)}${d.restore ? '   ·   restore time  ' + fmt_hms(d.restore_seconds || 0) : '   (restore skipped)'}`);
  console.log(`    API calls          ${d.api_cost != null ? d.api_cost.toLocaleString() : '(n/a)'}${d.per_merge != null ? ' · ~' + d.per_merge + '/merge' : ''}${d.remaining != null ? ' · ' + d.remaining.toLocaleString() + ' left today' : ''}`);
  console.log(`    Async Apex         ${d.apex_cost != null ? d.apex_cost.toLocaleString() : '(n/a)'}${d.apex_per_merge != null ? ' · ~' + d.apex_per_merge + '/merge' : ''}${d.apex_remaining != null ? ' · ' + d.apex_remaining.toLocaleString() + ' of ' + (d.api_after && d.api_after.apex_max ? d.api_after.apex_max.toLocaleString() : '?') + ' left today' : ''}`);
  console.log(`    restore            ${d.restore ? d.restore.status : 'skipped'}`);
}

function autosize(ws) {
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell({ includeEmpty: true }, (cell) => { const v = cell.value == null ? '' : String(cell.value); if (v.length > max) max = v.length; });
    col.width = Math.min(60, max + 2);
  });
}
function style_table(ws, headerRow) {
  const hr = headerRow || 1;
  ws.getRow(hr).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: hr }];
  autosize(ws);
}
function style_kv(ws) { ws.getColumn(1).font = { bold: true }; autosize(ws); }
function now_local() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Rolling batch-size sweep comparison: one row per run in _sweep_comparison.xlsx so 5 vs 10 vs 20 vs 50 line up.
async function append_sweep_row(base, row) {
  const path = require('path'); const fs = require('fs'); const ExcelJS = require('exceljs');
  const file = path.join(base, '_sweep_comparison.xlsx');
  const HEADER = ['When (MT)', 'Env', 'Mode', 'Source', 'Size band', 'Count', 'Batch', 'Seed', 'Sets', 'Done', 'Failed', 'Throughput/min', 'API total', 'API/merge', 'Async Apex', 'Apex/merge', 'Elapsed', 'Restore'];
  const APEX_AT = 14; // 0-based index where the Async Apex + Apex/merge columns were inserted
  const wb = new ExcelJS.Workbook();
  let ws = null;
  if (fs.existsSync(file)) { await wb.xlsx.readFile(file); ws = wb.getWorksheet('Runs'); }
  if (!ws) { ws = wb.addWorksheet('Runs'); ws.addRow(HEADER); }
  else {
    // Self-heal an older sweep: if the header predates the Async-Apex columns, rewrite it and realign any
    // short data rows (insert blanks for the new columns) so Elapsed/Restore don't slide. Idempotent.
    const hdr = (ws.getRow(1).values || []).slice(1);
    if (hdr.length !== HEADER.length) {
      const missing = HEADER.length - hdr.length;
      const dataRows = [];
      ws.eachRow((r, i) => { if (i > 1) dataRows.push({ i, vals: (r.values || []).slice(1) }); });
      if (missing > 0) for (const { i, vals } of dataRows) {
        if (vals.length === HEADER.length - missing) { const nv = vals.slice(); nv.splice(APEX_AT, 0, ...Array(missing).fill(null)); ws.spliceRows(i, 1, nv); }
      }
      ws.spliceRows(1, 1, HEADER);
    }
  }
  ws.addRow(row);
  style_table(ws, 1);
  await wb.xlsx.writeFile(file);
  return file;
}

// Write a standalone restore workbook (used as a fallback whenever we can't append the Restores tab to
// the merge report — so restore info is never lost, whichever menu path ran).
async function write_standalone_restore(base, restore, seconds) {
  const path = require('path'); const fs = require('fs'); const ExcelJS = require('exceljs');
  fs.mkdirSync(base, { recursive: true });
  const hist = (restore && restore.hist) || [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(base, `${ts}_restore_${(restore && restore.run_id) || 'run'}.xlsx`);
  const wb = new ExcelJS.Workbook();
  const rs = wb.addWorksheet('Restores');
  rs.addRow(['Restore run', (restore && restore.run_id) || '']); rs.addRow(['Status', (restore && restore.status) || 'unknown']);
  rs.addRow(['Sets', hist.length]); rs.addRow(['Elapsed (hh:mm:ss)', fmt_hms(seconds || 0)]); rs.addRow([]);
  rs.addRow(['#', 'queue_id', 'source_key', 'survivor', 'survivor_name', 'losers', 'result', 'reason']);
  hist.forEach((h, i) => rs.addRow([i + 1, h.queue_id, h.source_key, h.survivor_account, h.survivor_name, h.loser_count, h.result, h.reason]));
  try { style_table(rs, 6); } catch (e) { /* styling optional */ }
  await wb.xlsx.writeFile(file);
  return file;
}

function latest_report(base) {
  try { const fs = require('fs'); const path = require('path');
    // Skip the rolling '_sweep_comparison.xlsx' (and any '_'-prefixed rolling file) — it's touched at the
    // end of every merge run, so it's always newest; we want the per-run merge report to append into.
    const files = fs.readdirSync(base).filter((f) => f.endsWith('.xlsx') && !f.startsWith('_')).map((f) => ({ f, t: fs.statSync(path.join(base, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    return files.length ? path.join(base, files[0].f) : null;
  } catch (e) { return null; }
}

async function write_report(d) {
  const fs = require('fs'); const path = require('path'); const ExcelJS = require('exceljs');
  const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
  const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
  fs.mkdirSync(base, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const src = d.o.source === 'merge_id' ? 'mergeid' : 'dup';
  const file = path.join(base, `${ts}_${d.o.env}_${d.o.mode}_${src}_c${d.o.count}_b${d.o.batch}.xlsx`);
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  sum.addRows([
    ['Run', d.o.mode + ' · ' + d.o.env], ['Source', src], ['Count', d.o.count], ['Batch', d.o.batch], ['Seed', d.o.seed],
    ['Size band', (d.o.min_size || '-') + '..' + (d.o.max_size || '-')], ['Pool', d.sel.pool], ['Sampled', d.sel.sampled],
    ['Sets processed', d.hist.length], ['Batches', d.runs.length],
    ['Done', d.outcomes.done], ['Simulated', d.outcomes.simulated], ['Failed', d.outcomes.failed], ['Held', d.outcomes.held], ['Skipped', d.outcomes.skipped],
    ['Throughput / min', d.per_min], ['Elapsed total (hh:mm:ss)', fmt_hms(d.seconds)],
    ['Merge time', fmt_hms(d.merge_seconds || 0)], ['Restore time', d.restore ? fmt_hms(d.restore_seconds || 0) : 'skipped'],
    ['API calls total', d.api_cost], ['API per merge', d.per_merge], ['API left today', d.remaining],
    ['Restore', d.restore ? d.restore.status : 'skipped'], ['Dataset org', d.stamp.org_id],
  ]);
  const m = wb.addWorksheet('Merges');
  m.addRow(['#', 'run_id', 'queue_id', 'source_key', 'survivor', 'survivor_name', 'losers', 'children', 'result', 'reason', 'dossier_id']);
  (d.hist || []).forEach((h, i) => m.addRow([i + 1, h.run_id, h.queue_id, h.source_key, h.survivor_account, h.survivor_name, h.loser_count, h.child_total, h.result, h.reason, h.dossier_id]));
  const b = wb.addWorksheet('Batches');
  b.addRow(['#', 'run_id', 'sets', 'status', 'API cost', 'API used (after)', 'API left', 'Apex used (after)', 'Apex left', 'Bulk used', 'Batch time']);
  d.runs.forEach((r, i) => {
    const s2 = r.snap || {};
    const apiLeft = (s2.max != null && s2.used != null) ? (s2.max - s2.used) : null;
    const apexLeft = (s2.apex_max != null && s2.apex_used != null) ? (s2.apex_max - s2.apex_used) : null;
    b.addRow([i + 1, r.run_id, r.batch, r.status, r.cost, s2.used != null ? s2.used : null, apiLeft,
      s2.apex_used != null ? s2.apex_used : null, apexLeft, s2.bulk_used != null ? s2.bulk_used : null,
      r.bsec != null ? fmt_hms(r.bsec) : null]);
  });
  const a = wb.addWorksheet('API');
  a.addRows([['Metric', 'Value'],
    ['API used before', d.api_before ? d.api_before.used : null], ['API used after', d.api_after ? d.api_after.used : null],
    ['API daily max', d.api_after ? d.api_after.max : null], ['API cost (delta)', d.api_cost], ['API per merge', d.per_merge], ['API remaining today', d.remaining],
    ['', ''],
    ['Async Apex used before', d.api_before ? d.api_before.apex_used : null], ['Async Apex used after', d.api_after ? d.api_after.apex_used : null],
    ['Async Apex daily max', d.api_after ? d.api_after.apex_max : null], ['Async Apex cost (delta)', d.apex_cost], ['Async Apex per merge', d.apex_per_merge], ['Async Apex remaining today', d.apex_remaining],
    ['', ''],
    ['Bulk API batches used', d.api_after ? d.api_after.bulk_used : null], ['Bulk API daily max', d.api_after ? d.api_after.bulk_max : null], ['Bulk API cost (delta)', d.bulk_cost],
    ['', ''],
    ['Note 1', 'Async Apex fires after the merge (rollups run async), so it is measured as the whole-run before/after delta — approximate, and best read per-run not per-batch.'],
    ['Note 2', 'Bulk API batches are spent by the Get-Duplicates data pull, NOT by merges — so a merge run\'s Bulk cost is ~0. "Bulk API batches used" is the org\'s current daily usage for context.']]);
  if (d.restore && d.restore.hist && d.restore.hist.length) {
    const rs = wb.addWorksheet('Restores');
    rs.addRow(['#', 'queue_id', 'source_key', 'survivor', 'survivor_name', 'losers', 'result', 'reason']);
    d.restore.hist.forEach((h, i) => rs.addRow([i + 1, h.queue_id, h.source_key, h.survivor_account, h.survivor_name, h.loser_count, h.result, h.reason]));
  }
  const selWs = wb.addWorksheet('Selection');
  selWs.addRow(['#', 'source_key', 'survivor', 'survivor_name', 'losers']);
  (d.sel.entries || []).forEach((e, i) => selWs.addRow([i + 1, e.source_key, e.survivor_account, e.survivor_name,
    Array.isArray(e.loser_accounts) ? e.loser_accounts.length : String(e.loser_accounts || '').split(';').filter(Boolean).length]));
  wb.worksheets.forEach((w) => (w.name === 'Summary' ? style_kv(w) : style_table(w, 1)));
  await wb.xlsx.writeFile(file);
  return file;
}

// Standalone restore: undo the currently-restorable (recently-merged) sets from the CLI + write a report.
async function cmd_restore() {
  const { mrun } = stores();
  const mrestore = require('./store/merge_restore');
  const stamp = await get_dataset_stamp();
  const rows = await mrestore.list_restorable();
  if (!rows || !rows.length) { console.log('\nNothing restorable.\n'); process.exit(0); }
  const ids = rows.map((r) => r.id).filter((v) => v != null);
  const rl = make_rl();
  const c = await ask(rl, `Type RESTORE to restore ${ids.length} merged set(s) in ${stamp.env}`, '');
  rl.close();
  if (c !== 'RESTORE') { console.log('Not confirmed.\n'); process.exit(0); }
  if (process.env.MERGE_ENABLE_EXECUTION !== 'true') { console.log('MERGE_ENABLE_EXECUTION is not true — aborting.\n'); process.exit(1); }
  const started = Date.now();
  console.log(`\nRestoring ${ids.length} set(s) in ${stamp.env}…`);
  const { run_id } = await mrun.enqueue({ kind: 'restore', mode: 'execute', environment: env_label(stamp.env), org_id: stamp.org_id || null, created_by: 'stress-test',
    params: { ids, opts: { mode: 'execute', confirm: 'RESTORE', ack_post_merge: true, created_by: 'stress-test' } } });
  const r = await poll_run(run_id, { total: ids.length });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`  restore run ${run_id} → ${r ? r.status : 'unknown'} in ${fmt_hms(seconds)}`);
  const hist = await history_for_runs([run_id]);
  try {
    const fs = require('fs'); const path = require('path'); const ExcelJS = require('exceljs');
    const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
    const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress'); fs.mkdirSync(base, { recursive: true });
    // Build/replace the Restores tab on a workbook (reused for the append + the standalone fallback).
    const fill = (wb) => {
      const prev = wb.getWorksheet('Restores'); if (prev) wb.removeWorksheet(prev.id);
      const rs = wb.addWorksheet('Restores');
      rs.addRow(['Restore run', run_id]); rs.addRow(['Status', r ? r.status : 'unknown']); rs.addRow(['Sets', ids.length]); rs.addRow(['Elapsed (hh:mm:ss)', fmt_hms(seconds)]); rs.addRow([]);
      rs.addRow(['#', 'queue_id', 'source_key', 'survivor', 'survivor_name', 'losers', 'result', 'reason']);
      hist.forEach((h, i) => rs.addRow([i + 1, h.queue_id, h.source_key, h.survivor_account, h.survivor_name, h.loser_count, h.result, h.reason]));
      try { style_table(rs, 6); } catch (e) { /* styling optional */ }
    };
    const existing = latest_report(base);           // consolidate into the most recent merge-run workbook
    let wrote = null;
    if (existing) {
      // Append to the merge report — but if it's open in Excel (locked), don't lose the data.
      try { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(existing); fill(wb); await wb.xlsx.writeFile(existing); wrote = { file: existing, appended: true }; }
      catch (e) { console.log('  (could not append to ' + path.basename(existing) + ': ' + e.message + (/EBUSY|EPERM|EACCES/i.test(e.message) ? ' — is it open in Excel?' : '') + ' — writing a standalone restore file instead)'); }
    }
    if (!wrote) {                                    // no report yet, or the append failed — always land a file
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(base, `${ts}_${stamp.env}_restore_n${ids.length}.xlsx`);
      const wb = new ExcelJS.Workbook(); fill(wb); await wb.xlsx.writeFile(file); wrote = { file, appended: false };
    }
    console.log('  report: ' + wrote.file + (wrote.appended ? '  (appended Restores tab to the merge report)' : '  (standalone restore report)'));
  } catch (e) { console.log('  (report skipped: ' + e.message + ')'); }
  // Log a one-row activity entry in the rolling sweep file (Runs tab) so it shows ALL activity — a
  // restore row lands alongside the merge rows (Mode = 'restore'; merge-only columns show '-').
  try {
    const path = require('path'); const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
    const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
    const restored = hist.filter((h) => h.result === 'restored').length;
    const failed = hist.filter((h) => h.result === 'failed').length;
    const c = await run_api_cost(run_id); const cost = c ? c.api : null;
    const per_min = Math.round((ids.length / Math.max(0.001, seconds)) * 60 * 10) / 10;
    const sf = await append_sweep_row(base, [now_local(), stamp.env, 'restore', '-', '-', ids.length, '-', '-',
      ids.length, restored, failed, per_min, cost != null ? cost : '-', '-', '-', '-', fmt_hms(seconds), r ? r.status : 'unknown']);
    console.log('  sweep:  ' + sf);
  } catch (e) { console.log('  (sweep row skipped: ' + e.message + (/EBUSY|EPERM|EACCES|locked/i.test(e.message) ? ' — is _sweep_comparison.xlsx open in Excel? close it and re-run' : '') + ')'); }
  console.log('');
  process.exit(0);
}

// ---- interactive prompts -----------------------------------------------------------------------
function make_rl() { return require('readline').createInterface({ input: process.stdin, output: process.stdout }); }
function ask(rl, q, def) { return new Promise((res) => rl.question(`${q}${def != null ? ' [' + def + ']' : ''}: `, (a) => res(((a || '').trim()) || (def != null ? String(def) : '')))); }

async function cmd_run(full) {
  const rl = make_rl();
  const env = (await ask(rl, 'Environment (sandbox/production)', 'sandbox')).toLowerCase().startsWith('prod') ? 'production' : 'sandbox';
  const stamp = await get_dataset_stamp();
  if (stamp.env !== env) { console.log(`\n! Loaded dataset is ${stamp.env}, not ${env}. Re-run the finder against ${env} first.\n`); rl.close(); process.exit(1); }
  const clearDef = env === 'sandbox' ? 'Y' : 'N';
  const do_clear = (await ask(rl, 'Clear run tables first? (Y/N)', clearDef)).toUpperCase().startsWith('Y');
  const source = (await ask(rl, 'Source (duplicate/merge-id)', 'duplicate')).toLowerCase().startsWith('merge') ? 'merge_id' : 'group';
  const min_size = source === 'group' ? await ask(rl, 'Min cluster size', '2') : null;
  const max_size = source === 'group' ? await ask(rl, 'Max cluster size', '4') : null;
  const count = Math.max(1, Number(await ask(rl, 'How many merges (count)', '20')) || 20);
  const batch = Math.max(1, Number(await ask(rl, 'Batch size', '10')) || 10);
  const pause_batches = (batch < count) ? (await ask(rl, 'Pause between batches (choose continue/stop each)? (y/N)', 'N')).toUpperCase().startsWith('Y') : false;
  const seed = Number(await ask(rl, 'Random seed', String(Date.now() % 100000))) || 1;
  const restore = (await ask(rl, 'Restore afterward? (Y/N)', full ? 'Y' : 'N')).toUpperCase().startsWith('Y');
  const dossier = (await ask(rl, 'Attach dossier? (y/N)', 'N')).toUpperCase().startsWith('Y');
  const stampS = (await ask(rl, 'Stamp survivor? (y/N)', 'N')).toUpperCase().startsWith('Y');
  const mode = (await ask(rl, 'Mode (simulate/execute)', 'simulate')).toLowerCase().startsWith('exec') ? 'execute' : 'simulate';
  if (mode === 'execute') {
    const c = await ask(rl, `Type MERGE to run ${count} REAL merges against ${env}`, '');
    if (c !== 'MERGE') { console.log('Not confirmed — aborting.\n'); rl.close(); process.exit(1); }
    if (env === 'production' && process.env.MERGE_ENABLE_EXECUTION !== 'true') { console.log('MERGE_ENABLE_EXECUTION is not true — aborting.\n'); rl.close(); process.exit(1); }
  }
  rl.close();
  await run_sequence({ env, do_clear, source, min_size, max_size, count, batch, seed, restore, dossier, stamp: stampS, mode, pace_ms: 0, full, pause_batches }, stamp);
}

async function cmd_clear() {
  const rl = make_rl();
  const c = await ask(rl, 'Type CLEAR to empty the merge run/queue tables (finder data untouched)', '');
  rl.close();
  if (c !== 'CLEAR') { console.log('Not confirmed.\n'); process.exit(0); }
  const done = await clear_run_tables();
  console.log('cleared: ' + done.join(', ') + '\n');
  process.exit(0);
}

async function main() {
  const cmd = (process.argv[2] || '').toLowerCase();
  if (cmd === 'distribution' || cmd === 'dist') {
    const want = resolve_env(process.argv.slice(2));
    const stamp = await get_dataset_stamp();
    console.log(`\nDataset loaded: ${stamp.env} · as of ${stamp.as_of || '(unknown)'} · ${stamp.records.toLocaleString()} records · org ${stamp.org_id || '(unknown)'}`);
    if (stamp.env !== want) console.log(`\n! You selected ${want}, but the loaded dataset is ${stamp.env}. Re-run the finder against ${want} first.\n`);
    const dist = await get_distribution();
    console.log(`\nDuplicate cluster-size distribution (${stamp.env}):\n`);
    console.log(format_distribution(dist));
    console.log('\nPick a min/max size band from this to avoid unrepresentative extremes.\n');
    process.exit(0);
  }
  if (cmd === 'open') {
    const path = require('path');
    const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
    const dir = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
    require('fs').mkdirSync(dir, { recursive: true });
    console.log('Opening: ' + dir);
    const opener = process.platform === 'win32' ? 'explorer' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    try { require('child_process').spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { console.log('(could not open: ' + e.message + ')'); }
    process.exit(0);
  }
  if (cmd === 'clear') return cmd_clear();
  if (cmd === 'restore') return cmd_restore();
  if (cmd === 'run') return cmd_run(false);
  if (cmd === 'sequence' || cmd === 'all') return cmd_run(true);
  console.log('usage: node src/usat_apps/modules/salesforce_merge/stress_test.js <distribution|clear|run|restore|sequence|open> [--env production]');
  process.exit(0);
}

module.exports = { build_distribution, format_distribution, in_size_range, mulberry32, sample, get_distribution, resolve_env, normalize_env, get_dataset_stamp, plan_batches, summarize, format_selection, fmt_hms };

if (require.main === module) main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
