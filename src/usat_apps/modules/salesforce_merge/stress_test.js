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
// A worker's claim token is `w<pid>-<time>-<rand>`; the `w<pid>` prefix identifies the actual pm2
// process. Count DISTINCT prefixes among rows still running so "N workers active" = concurrent workers,
// not the number of batches claimed over the run.
function active_worker_count(rows) {
  const ids = (rows || []).filter((r) => r && r.status === 'running').map((r) => String(r.claimed_by || '').split('-')[0]).filter(Boolean);
  return new Set(ids).size;
}
// The pm2 worker that ran a run (the `w<pid>` prefix of its claim token), for the parallel Batches sheet.
function worker_of(row) { return row && row.claimed_by ? String(row.claimed_by).split('-')[0] : null; }
// A batch's actual WORK time in seconds: claimed_at → finished_at (excludes queue-wait, so it reflects
// what one worker spent on the batch). Both are DATETIME (same field type) so the delta is tz-agnostic.
function work_seconds(row) {
  if (!row || !row.claimed_at || !row.finished_at) return null;
  const ms = new Date(row.finished_at).getTime() - new Date(row.claimed_at).getTime();
  return ms >= 0 ? Math.round(ms / 1000) : null;
}
// The reliable per-merge SERVICE time: median of (batch work-time ÷ its set count) across batches.
// Concurrency-proof — a batch's own claimed→finished duration doesn't move with other workers, so this
// is the per-merge number to trust regardless of worker count. null if no batch has a timing.
function median_sec_per_merge(runs) {
  const rates = (runs || []).map((r) => (r.bsec != null && r.batch) ? r.bsec / r.batch : null).filter((x) => x != null).sort((a, b) => a - b);
  if (!rates.length) return null;
  const mid = Math.floor(rates.length / 2);
  const m = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  return Math.round(m * 10) / 10;
}
// One-line load split across the pm2 workers that ran the batches, e.g.
// "worker split: w28136 3 batch(es)/6 set(s)/01:42 · w1140 2 batch(es)/4 set(s)/01:08".
function format_worker_balance(runs) {
  const by = new Map();
  (runs || []).forEach((r) => {
    const w = r.worker || '(unclaimed)';
    const a = by.get(w) || { batches: 0, sets: 0, secs: 0 };
    a.batches += 1; a.sets += Number(r.batch) || 0; a.secs += Number(r.bsec) || 0;
    by.set(w, a);
  });
  if (!by.size) return 'worker split: (none)';
  const parts = [...by.entries()].sort((x, y) => x[0] < y[0] ? -1 : 1)
    .map(([w, a]) => `${w} ${a.batches} batch(es)/${a.sets} set(s)/${fmt_hms(a.secs)}`);
  return 'worker split: ' + parts.join(' · ');
}
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
  const { reviews } = stores();
  const isMergeId = o.source === 'merge_id';
  const view = isMergeId ? 'merge-id' : 'duplicates';
  // Reuse the EXACT Select-Merges filter machinery: pick from the full pool of keys that match the same
  // filters (o.filters -> filter_cols, o.colFilters -> filter_map). Legacy CLI fields (min/max_size,
  // foundation) fold into filters for back-compat. No parallel filter code here.
  const filters = { ...(o.filters || {}) };
  if (o.min_size && filters.size_min == null) filters.size_min = o.min_size;
  if (o.max_size && filters.size_max == null) filters.size_max = o.max_size;
  if (o.foundation && !filters.foundation_state) filters.foundation_state = o.foundation;
  const allKeys = await reviews.matching_keys(view, { filters, colFilters: o.colFilters || {} }, q);
  const pool = allKeys.length;
  const picked = sample(allKeys, o.count, o.seed);
  const resolved = isMergeId
    ? await reviews.resolve_merge_groups({ keys: picked }, q)
    : await reviews.resolve_duplicate_groups({ keys: picked }, q);
  return build_entries(resolved, isMergeId ? 'merge_id' : 'group', o, stamp, pool, picked.length);
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
    return { api: r.cost != null ? Number(r.cost) : null, apex: r.apex_cost != null ? Number(r.apex_cost) : null, bulk: r.bulk_cost != null ? Number(r.bulk_cost) : null,
      end_api: r.end_used != null ? Number(r.end_used) : null, end_apex: r.end_apex != null ? Number(r.end_apex) : null, end_bulk: r.end_bulk != null ? Number(r.end_bulk) : null };
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
  if (o.parallel) {
    // PARALLEL: enqueue EVERY batch run up front so a pm2 worker CLUSTER (menu item 2) drains them side
    // by side. Poll them all together; the per-batch checkpoint doesn't apply (batches overlap in time).
    console.log(`      PARALLEL — enqueuing all ${batches.length} batch runs at once (make sure 2 workers are running: menu item 2)…`);
    const enq = [];
    for (let bi = 0; bi < batches.length; bi += 1) {
      const batch = batches[bi];
      const q = await mrun.enqueue({ kind: 'merge', mode: o.mode,
        environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null, created_by: 'stress-test',
        params: { ids: batch, opts: { mode: o.mode, confirm: 'MERGE', dry_run: !isExec, ack_drift: true, stamp_merged: o.stamp, attach_dossier: o.dossier, created_by: 'stress-test' } } });
      enq.push({ run_id: q.run_id, batch: batch.length });
    }
    console.log(`      ${enq.length} batches queued — draining with whatever workers are online…`);
    let hb = 0;
    for (let i = 0; i < 1000000; i += 1) {
      const rows = await Promise.all(enq.map((e) => mrun.get(e.run_id)));
      const finished = rows.filter((r) => r && r.status !== 'queued' && r.status !== 'running').length;
      const setsDone = rows.reduce((a, r) => a + ((r && r.completed_sets) || 0), 0);
      const workers = active_worker_count(rows);
      const now = Date.now();
      if (now - hb >= 5000 || finished >= enq.length) { hb = now; console.log(`        … ${finished}/${enq.length} batches · ${setsDone}/${totalSets} sets · ${workers} worker(s) active · elapsed ${fmt_hms((now - seqStart) / 1000)}`); }
      if (finished >= enq.length) break;
      await sleep(2000);
    }
    const maxes = await api_snapshot(o.env);   // daily API/Apex/Bulk limits (stable) — combined with per-run end usage below
    for (const e of enq) {
      const row = await mrun.get(e.run_id);
      const c = await run_api_cost(e.run_id);
      // In parallel mode batches overlap, so an org-wide "latest" snapshot can't be attributed to one
      // batch. Use the per-RUN end usage instead, and the batch's own claimed→finished work time.
      const snap = { used: c.end_api, max: maxes ? maxes.max : null, apex_used: c.end_apex, apex_max: maxes ? maxes.apex_max : null, bulk_used: c.end_bulk, bulk_max: maxes ? maxes.bulk_max : null };
      runs.push({ run_id: e.run_id, batch: e.batch, status: row ? row.status : 'unknown', cost: c ? c.api : null, apex: c ? c.apex : null, bulk: c ? c.bulk : null, bsec: work_seconds(row), snap, worker: worker_of(row) });
    }
    console.log('      ' + format_worker_balance(runs));
  } else {
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
    runs.push({ run_id, batch: batch.length, status: run ? run.status : 'unknown', cost, apex: c ? c.apex : null, bulk: c ? c.bulk : null, bsec, snap, worker: worker_of(run) });
    lastHb = Date.now();
    if (pauseRl && bi < batches.length - 1) {
      const ans = await new Promise((res) => pauseRl.question(`      ↳ batch ${bi + 1}/${batches.length} done` + (apexLeft != null ? ` · Apex left ${apexLeft.toLocaleString()}` : '') + ' · continue to next batch? (Y/n): ', (a2) => res((a2 || '').trim().toLowerCase())));
      if (['n', 'no', 's', 'stop', 'q', 'quit'].includes(ans)) { console.log(`      Stopping after batch ${bi + 1}/${batches.length} — ${batches.length - bi - 1} batch(es) left approved (re-run option 30 to finish).`); break; }
    }
    if (o.pace_ms) await sleep(o.pace_ms);
  }
  if (pauseRl) pauseRl.close();
  }
  const api_after = await api_snapshot(o.env);
  const merge_seconds = Math.round((Date.now() - seqStart) / 1000);   // total time in the merge batches

  let restore = null; let restore_seconds = 0;
  if (o.restore) {
    console.log('\n[4/5] Restoring…');
    const rStart = Date.now();
    if (o.parallel) {
      // PARALLEL restore too: split into batches and enqueue them all so both workers contend on the
      // undelete/re-point path (not just merges).
      const rbatches = plan_batches(ids, o.batch);
      console.log(`      PARALLEL restore — enqueuing all ${rbatches.length} restore batches at once…`);
      const renq = [];
      for (const rb of rbatches) {
        const q = await mrun.enqueue({ kind: 'restore', mode: o.mode,
          environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null, created_by: 'stress-test',
          params: { ids: rb, opts: { mode: o.mode, confirm: 'RESTORE', ack_post_merge: true, created_by: 'stress-test' } } });
        renq.push(q.run_id);
      }
      let rhb = 0;
      for (let i = 0; i < 1000000; i += 1) {
        const rows = await Promise.all(renq.map((rid) => mrun.get(rid)));
        const fin = rows.filter((r) => r && r.status !== 'queued' && r.status !== 'running').length;
        const doneSets = rows.reduce((a, r) => a + ((r && r.completed_sets) || 0), 0);
        const workers = active_worker_count(rows);
        const now = Date.now();
        if (now - rhb >= 5000 || fin >= renq.length) { rhb = now; console.log(`        … ${fin}/${renq.length} restore batches · ${doneSets}/${ids.length} sets · ${workers} worker(s) active · elapsed ${fmt_hms((now - rStart) / 1000)}`); }
        if (fin >= renq.length) break;
        await sleep(2000);
      }
      restore_seconds = Math.round((Date.now() - rStart) / 1000);
      const statuses = await Promise.all(renq.map((rid) => mrun.get(rid)));
      const allDone = statuses.every((r) => r && r.status === 'done');
      const rhist = await history_for_runs(renq);
      console.log(`      restore ${renq.length} batches → ${allDone ? 'done' : 'mixed'} in ${fmt_hms(restore_seconds)}`);
      restore = { run_id: renq[0], status: allDone ? 'done' : 'mixed', hist: rhist, seconds: restore_seconds };
    } else {
      const { run_id } = await mrun.enqueue({ kind: 'restore', mode: o.mode,
        environment: o.env === 'production' ? 'Production' : 'Sandbox', org_id: stamp.org_id || null, created_by: 'stress-test',
        params: { ids, opts: { mode: o.mode, confirm: 'RESTORE', ack_post_merge: true, created_by: 'stress-test' } } });
      const r = await poll_run(run_id, { total: ids.length });
      restore_seconds = Math.round((Date.now() - rStart) / 1000);
      console.log(`      restore ${run_id} → ${r ? r.status : 'unknown'} in ${fmt_hms(restore_seconds)}`);
      const rhist = await history_for_runs([run_id]);   // attach per-set history so write_report emits the Restores tab
      restore = { run_id, status: r ? r.status : 'unknown', hist: rhist, seconds: restore_seconds };
    }
  } else console.log('\n[4/5] Skipping restore.');

  console.log('\n[5/5] Writing report…');
  const seconds = Math.round((Date.now() - started) / 1000);
  const hist = await history_for_runs(runs.map((r) => r.run_id));
  const by = (r) => hist.filter((h) => h.result === r).length;
  // Count 'restored' as done so a restore report shows real counts (not "Done 0").
  const outcomes = { done: by('done') + by('restored'), simulated: by('simulated'), failed: by('failed'), held: by('held'), skipped: by('skipped') };
  // API total: PREFER the whole-run before/after delta (the true org-wide total). In PARALLEL mode the
  // per-run deltas DOUBLE-COUNT — DailyApiRequests is one org-wide counter, so each concurrent run's
  // max-min also captures the other workers' calls; summing them overstates badly (e.g. 12k vs the real
  // ~7k). In serial mode the two agree. Fall back to the per-run sum only if we have no before/after snap.
  const whole_run_api = (api_before && api_after && api_after.used != null && api_before.used != null) ? (api_after.used - api_before.used) : null;
  const summed_api = runs.reduce((a, r) => a + (Number(r.cost) || 0), 0) || null;
  const api_cost = whole_run_api != null ? whole_run_api : summed_api;
  // Any org-wide daily counter is APPROXIMATE per-merge: it also moves with other workers + background
  // org activity during the window. True per-merge API is best read from a SERIAL run (batch=count, 1 worker).
  const api_approx = !!o.parallel;
  // Async Apex fires AFTER the merge (rollups queue as async jobs), so per-batch start/end deltas miss
  // it. The whole-run before/after delta is the reliable measure; fall back to the per-batch sum only if
  // we have no before/after snapshot.
  const apex_delta = (api_before && api_after && api_after.apex_used != null && api_before.apex_used != null) ? (api_after.apex_used - api_before.apex_used) : null;
  const apex_cost = apex_delta != null ? apex_delta : (runs.reduce((a, r) => a + (Number(r.apex) || 0), 0) || null);
  const bulk_delta = (api_before && api_after && api_after.bulk_used != null && api_before.bulk_used != null) ? (api_after.bulk_used - api_before.bulk_used) : null;
  const bulk_cost = bulk_delta != null ? bulk_delta : (runs.reduce((a, r) => a + (Number(r.bulk) || 0), 0) || null);
  const per_merge = (api_cost != null && hist.length) ? Math.round((api_cost / hist.length) * 10) / 10 : null;
  const apex_per_merge = (apex_cost != null && apex_cost > 0 && hist.length) ? Math.round((apex_cost / hist.length) * 10) / 10 : null;   // rolling 24h counter -> negatives aren't a per-merge cost
  const remaining = (api_after && api_after.max != null) ? (api_after.max - api_after.used) : null;
  const apex_remaining = (api_after && api_after.apex_max != null && api_after.apex_used != null) ? (api_after.apex_max - api_after.apex_used) : null;
  const per_min = Math.round((hist.length / Math.max(0.001, seconds)) * 60 * 10) / 10;
  // RELIABLE per-merge cost (concurrency-proof): the median batch's own claimed→finished work time
  // divided by its set count. Unlike the API counter, batch time isn't polluted by other workers, so
  // this is the number to trust + report across serial and parallel alike.
  const sec_per_merge = median_sec_per_merge(runs);
  const data = { o, sel, runs, restore, seconds, merge_seconds, restore_seconds, per_min, sec_per_merge, hist, outcomes, api_cost, api_approx, per_merge, remaining, apex_cost, apex_per_merge, apex_remaining, bulk_cost, api_before, api_after, stamp };
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
      o.count, o.batch, o.seed, hist.length, outcomes.done, outcomes.failed, per_min, api_cost, per_merge, apex_cost, apex_per_merge, fmt_hms(seconds), restore ? restore.status : 'skipped', o.job_id || '-']);
    console.log('      sweep:  ' + sf);
  } catch (e) { console.log('      (sweep row skipped: ' + e.message + (/EBUSY|EPERM|EACCES|locked/i.test(e.message) ? ' — is _sweep_comparison.xlsx open in Excel? close it and re-run' : '') + ')'); }
  console.log('\n=== done ===\n');
  process.exit(0);
}

function print_summary(d) {
  console.log('\n  Summary:');
  console.log(`    sets processed     ${d.hist.length} (queued ${d.runs.reduce((s, r) => s + r.batch, 0)}, batches ${d.runs.length})`);
  console.log(`    outcomes           done ${d.outcomes.done} · simulated ${d.outcomes.simulated} · failed ${d.outcomes.failed} · held ${d.outcomes.held} · skipped ${d.outcomes.skipped}`);
  console.log(`    throughput         ${d.per_min}/min over ${fmt_hms(d.seconds)}${d.sec_per_merge != null ? '   ·   ~' + d.sec_per_merge + 's/merge (median batch)' : ''}`);
  console.log(`    merge time         ${fmt_hms(d.merge_seconds || 0)}${d.restore ? '   ·   restore time  ' + fmt_hms(d.restore_seconds || 0) : '   (restore skipped)'}`);
  const apxTag = d.api_approx ? ' approx' : '';
  console.log(`    API calls          ${d.api_cost != null ? d.api_cost.toLocaleString() : '(n/a)'}${d.per_merge != null ? ' · ~' + d.per_merge + '/merge' + apxTag : ''}${d.remaining != null ? ' · ' + d.remaining.toLocaleString() + ' left today' : ''}${d.api_approx ? '  (org-wide daily counter — calibrate serially)' : ''}`);
  console.log(`    Async Apex         ${d.apex_cost == null ? '(n/a)' : (d.apex_cost <= 0 ? 'n/a — fires after commit (deferred); use a 50-100 run' : d.apex_cost.toLocaleString() + (d.apex_per_merge != null ? ' · ~' + d.apex_per_merge + '/merge' : ''))}${d.apex_remaining != null ? ' · ' + d.apex_remaining.toLocaleString() + ' of ' + (d.api_after && d.api_after.apex_max ? d.api_after.apex_max.toLocaleString() : '?') + ' left today' : ''}`);
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
  const HEADER = ['When (MT)', 'Env', 'Mode', 'Source', 'Size band', 'Count', 'Batch', 'Seed', 'Sets', 'Done', 'Failed', 'Throughput/min', 'API total', 'API/merge', 'Async Apex', 'Apex/merge', 'Elapsed', 'Restore', 'Job'];
  const APEX_AT = 14; // 0-based index where the Async Apex + Apex/merge columns were inserted
  const wb = new ExcelJS.Workbook();
  let ws = null;
  if (fs.existsSync(file)) { await wb.xlsx.readFile(file); ws = wb.getWorksheet('Runs'); }
  if (!ws) { ws = wb.addWorksheet('Runs'); ws.addRow(HEADER); }
  else {
    // Self-heal an older sweep to the current columns. Handles two additive migrations, in order:
    //   (1) the Async-Apex pair inserted mid-row at APEX_AT (for headers predating it), then
    //   (2) the trailing Job column (right-pad). Idempotent; keeps Elapsed/Restore aligned.
    const hdr = (ws.getRow(1).values || []).slice(1);
    if (hdr.join('') !== HEADER.join('')) {
      const hadApex = hdr.indexOf('Async Apex') >= 0;
      const rows = [];
      ws.eachRow((r, i) => { if (i > 1) rows.push({ i, vals: (r.values || []).slice(1) }); });
      for (const { i, vals } of rows) {
        let nv = vals.slice();
        if (!hadApex) nv.splice(APEX_AT, 0, null, null);      // insert the 2 apex columns mid-row
        while (nv.length < HEADER.length) nv.push(null);       // right-pad new trailing columns (e.g. Job)
        nv.length = HEADER.length;
        ws.spliceRows(i, 1, nv);
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

// Housekeeping: delete per-run report workbooks older than 24h. The cumulative sweep (and anything else
// prefixed '_') is preserved. Best-effort — never throws.
function prune_old_reports(base, maxAgeMs) {
  try {
    const fs = require('fs'); const path = require('path');
    const cutoff = Date.now() - (maxAgeMs || 24 * 60 * 60 * 1000);
    for (const f of fs.readdirSync(base)) {
      if (!f.endsWith('.xlsx') || f.startsWith('_')) continue;   // keep _sweep_comparison.xlsx et al.
      const fp = path.join(base, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch (e) { /* skip */ }
    }
  } catch (e) { /* best-effort */ }
}

async function write_report(d) {
  const fs = require('fs'); const path = require('path'); const ExcelJS = require('exceljs');
  const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
  const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
  fs.mkdirSync(base, { recursive: true });
  prune_old_reports(base);   // keep the folder tidy — drop per-run workbooks older than 24h (sweep is kept)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const src = d.o.source === 'merge_id' ? 'mergeid' : 'dup';
  const file = path.join(base, `${ts}_${d.o.env}_${d.o.mode}_${src}_c${d.o.count}_b${d.o.batch}.xlsx`);
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  // Parallelism, spelled out — a run only fans out when it splits into >1 batch. One batch = no fan-out
  // (parallel off, or the set count fit in a single chunk). "Workers used" = distinct pm2 instances that ran a batch.
  const n_batches = d.runs.length;
  const workers_used = Array.from(new Set((d.runs || []).map((r) => r.worker).filter(Boolean)));
  const ran_as = n_batches > 1
    ? ('parallel — ' + n_batches + ' batches across ' + (workers_used.length || 1) + ' worker(s)')
    : 'single run — 1 batch (no fan-out)';
  sum.addRows([
    ['Run', d.o.mode + ' · ' + d.o.env], ['Job id', d.o.job_id || '-'], ['Source', src], ['Count', d.o.count], ['Batch (requested)', d.o.batch], ['Seed', d.o.seed],
    ['Size band', (d.o.min_size || '-') + '..' + (d.o.max_size || '-')], ['Pool', d.sel.pool], ['Sampled', d.sel.sampled],
    ['Ran as', ran_as], ['Workers used', workers_used.length ? workers_used.join(', ') : '1 (or n/a)'],
    ['Sets processed', d.hist.length], ['Batches (actual)', d.runs.length],
    ['Done', d.outcomes.done], ['Simulated', d.outcomes.simulated], ['Failed', d.outcomes.failed], ['Held', d.outcomes.held], ['Skipped', d.outcomes.skipped],
    ['Throughput / min', d.per_min], ['Sec per merge (median batch — reliable)', d.sec_per_merge != null ? d.sec_per_merge : 'n/a'], ['Elapsed total (hh:mm:ss)', fmt_hms(d.seconds)],
    ['Merge time', fmt_hms(d.merge_seconds || 0)], ['Restore time', d.restore ? fmt_hms(d.restore_seconds || 0) : 'skipped'],
    ['API calls total', d.api_cost], ['API per merge' + (d.api_approx ? ' (approx — org-wide counter)' : ''), d.per_merge], ['API left today', d.remaining],
    ['Restore', d.restore ? d.restore.status : 'skipped'], ['Dataset org', d.stamp.org_id],
  ]);
  const m = wb.addWorksheet('Merges');
  m.addRow(['#', 'run_id', 'queue_id', 'source_key', 'survivor', 'survivor_name', 'losers', 'children', 'result', 'reason', 'dossier_id']);
  (d.hist || []).forEach((h, i) => m.addRow([i + 1, h.run_id, h.queue_id, h.source_key, h.survivor_account, h.survivor_name, h.loser_count, h.child_total, h.result, h.reason, h.dossier_id]));
  const b = wb.addWorksheet('Batches');
  b.addRow(['#', 'run_id', 'worker', 'sets', 'status', d.api_approx ? 'API cost (org-wide, overlaps)' : 'API cost', 'API used (after)', 'API left', 'Apex used (after)', 'Apex left', 'Bulk used', 'Batch time']);
  d.runs.forEach((r, i) => {
    const s2 = r.snap || {};
    const apiLeft = (s2.max != null && s2.used != null) ? (s2.max - s2.used) : null;
    const apexLeft = (s2.apex_max != null && s2.apex_used != null) ? (s2.apex_max - s2.apex_used) : null;
    b.addRow([i + 1, r.run_id, r.worker || null, r.batch, r.status, r.cost, s2.used != null ? s2.used : null, apiLeft,
      s2.apex_used != null ? s2.apex_used : null, apexLeft, s2.bulk_used != null ? s2.bulk_used : null,
      r.bsec != null ? fmt_hms(r.bsec) : null]);
  });
  const a = wb.addWorksheet('API');
  a.addRows([['Metric', 'Value'],
    ['API used before', d.api_before ? d.api_before.used : null], ['API used after', d.api_after ? d.api_after.used : null],
    ['API daily max', d.api_after ? d.api_after.max : null], ['API cost (whole-run delta)', d.api_cost], ['API per merge' + (d.api_approx ? ' (approx)' : ''), d.per_merge], ['API remaining today', d.remaining],
    ['Sec per merge (median batch — RELIABLE)', d.sec_per_merge != null ? d.sec_per_merge : 'n/a'],
    ['', ''],
    ['Async Apex used before', d.api_before ? d.api_before.apex_used : null], ['Async Apex used after', d.api_after ? d.api_after.apex_used : null],
    ['Async Apex daily max', d.api_after ? d.api_after.apex_max : null], ['Async Apex cost (delta)', d.apex_cost], ['Async Apex per merge', d.apex_per_merge], ['Async Apex remaining today', d.apex_remaining],
    ['', ''],
    ['Bulk API batches used', d.api_after ? d.api_after.bulk_used : null], ['Bulk API daily max', d.api_after ? d.api_after.bulk_max : null], ['Bulk API cost (delta)', d.bulk_cost],
    ['', ''],
    ['Note 1 (API)', 'API cost = the whole-run before/after delta of DailyApiRequests — a single ORG-WIDE daily counter. In PARALLEL runs it also moves with the other workers + any background org activity, so per-merge API is APPROXIMATE. For a clean per-merge API figure, run SERIALLY (batch = count, one worker). The per-batch "API cost" column is org-wide during overlapping windows in parallel mode — not a true single-batch cost.'],
    ['Note 2 (best metric)', 'The RELIABLE per-merge cost is "Sec per merge (median batch)" — a batch\'s own claimed→finished time isn\'t polluted by other workers, so it holds across serial and parallel. Use it (and Throughput/min) as the headline; treat the API/Apex counters as daily-headroom context.'],
    ['Note 3 (Async Apex)', 'Async Apex fires AFTER the merge commits (rollups queue as async jobs) and DailyAsyncApexExecutions is a ROLLING 24h counter, so an immediate post-run snapshot usually reads ~0 (the jobs have not run yet) and a short run\'s net delta can even go negative as old executions age out. It only becomes meaningful on a longer run (50-100) where the deferred jobs have time to fire within the window.'],
    ['Note 4 (Bulk)', 'Bulk API batches are spent by the Get-Duplicates data pull, NOT by merges — so a merge run\'s Bulk cost is ~0. "Bulk API batches used" is the org\'s current daily usage for context.']]);
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
      ids.length, restored, failed, per_min, cost != null ? cost : '-', '-', '-', '-', fmt_hms(seconds), r ? r.status : 'unknown', '-']);
    console.log('  sweep:  ' + sf);
  } catch (e) { console.log('  (sweep row skipped: ' + e.message + (/EBUSY|EPERM|EACCES|locked/i.test(e.message) ? ' — is _sweep_comparison.xlsx open in Excel? close it and re-run' : '') + ')'); }
  console.log('');
  process.exit(0);
}

// ---- interactive prompts -----------------------------------------------------------------------
function make_rl() { return require('readline').createInterface({ input: process.stdin, output: process.stdout }); }
function ask(rl, q, def) { return new Promise((res) => rl.question(`${q}${def != null ? ' [' + def + ']' : ''}: `, (a) => res(((a || '').trim()) || (def != null ? String(def) : '')))); }

async function cmd_run(full, parallel) {
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
  const pause_batches = (!parallel && batch < count) ? (await ask(rl, 'Pause between batches (choose continue/stop each)? (y/N)', 'N')).toUpperCase().startsWith('Y') : false;
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
  await run_sequence({ env, do_clear, source, min_size, max_size, count, batch, seed, restore, dossier, stamp: stampS, mode, pace_ms: 0, full, pause_batches, parallel: !!parallel }, stamp);
}

// Poll a whole JOB (Phase 1) until it leaves 'running'/'paused-with-work', printing an aggregate
// heartbeat (batches done, sets done, workers active) built from mrun.job_progress — the same view the
// UI will poll. Returns the final progress object.
async function poll_job(mrun, jobId) {
  let hb = 0; const start = Date.now();
  for (;;) {
    const p = await mrun.job_progress(jobId);
    const now = Date.now();
    if (!p) { await sleep(1500); continue; }
    if (now - hb >= 5000 || p.status !== 'running') {
      hb = now;
      console.log(`        … ${p.runs_done}/${p.runs_total} batches · ${p.completed_sets}/${p.total_sets} sets · ${p.workers_active} worker(s) active · ${p.status}${p.runs_held ? ' · held ' + p.runs_held : ''} · elapsed ${fmt_hms((now - start) / 1000)}`);
    }
    if (p.status !== 'running') return p;
    await sleep(2000);
  }
}

// Build the per-batch `runs` rows the report expects from a list of enqueued chunk-runs [{run_id, batch}].
// Same shape as run_sequence's runs: cost/apex/bulk (per-run delta), work-time, worker pid, end-usage snap.
async function assemble_runs(mrun, enq, maxes) {
  const runs = [];
  for (const e of enq) {
    const row = await mrun.get(e.run_id);
    const c = await run_api_cost(e.run_id);
    const snap = { used: c.end_api, max: maxes ? maxes.max : null, apex_used: c.end_apex, apex_max: maxes ? maxes.apex_max : null, bulk_used: c.end_bulk, bulk_max: maxes ? maxes.bulk_max : null };
    runs.push({ run_id: e.run_id, batch: e.batch, status: row ? row.status : 'unknown', cost: c ? c.api : null, apex: c ? c.apex : null, bulk: c ? c.bulk : null, bsec: work_seconds(row), snap, worker: worker_of(row) });
  }
  return runs;
}

// Print the SAME Summary block as items 30/31 (via the shared print_summary) and write the SAME outputs:
// the per-run .xlsx (write_report) + a sweep row (append_sweep_row). Reuses the shared summary + writers;
// only the derived-field assembly is here (job is always parallel, so API is org-wide/approx).
async function finalize_job(o, sel, runs, restore, timings, stamp, api_before, api_after) {
  const hist = await history_for_runs(runs.map((r) => r.run_id));
  const by = (r) => hist.filter((h) => h.result === r).length;
  // Count 'restored' as done so a restore report shows real counts (not "Done 0").
  const outcomes = { done: by('done') + by('restored'), simulated: by('simulated'), failed: by('failed'), held: by('held'), skipped: by('skipped') };
  const whole_run_api = (api_before && api_after && api_after.used != null && api_before.used != null) ? (api_after.used - api_before.used) : null;
  const api_cost = whole_run_api != null ? whole_run_api : (runs.reduce((a, r) => a + (Number(r.cost) || 0), 0) || null);
  const api_approx = true;
  const apex_delta = (api_before && api_after && api_after.apex_used != null && api_before.apex_used != null) ? (api_after.apex_used - api_before.apex_used) : null;
  const apex_cost = apex_delta != null ? apex_delta : (runs.reduce((a, r) => a + (Number(r.apex) || 0), 0) || null);
  const bulk_delta = (api_before && api_after && api_after.bulk_used != null && api_before.bulk_used != null) ? (api_after.bulk_used - api_before.bulk_used) : null;
  const bulk_cost = bulk_delta != null ? bulk_delta : (runs.reduce((a, r) => a + (Number(r.bulk) || 0), 0) || null);
  const per_merge = (api_cost != null && hist.length) ? Math.round((api_cost / hist.length) * 10) / 10 : null;
  const apex_per_merge = (apex_cost != null && apex_cost > 0 && hist.length) ? Math.round((apex_cost / hist.length) * 10) / 10 : null;
  const remaining = (api_after && api_after.max != null) ? (api_after.max - api_after.used) : null;
  const apex_remaining = (api_after && api_after.apex_max != null && api_after.apex_used != null) ? (api_after.apex_max - api_after.apex_used) : null;
  const per_min = Math.round((hist.length / Math.max(0.001, timings.seconds)) * 60 * 10) / 10;
  const sec_per_merge = median_sec_per_merge(runs);
  const data = { o, sel, runs, restore, seconds: timings.seconds, merge_seconds: timings.merge_seconds, restore_seconds: timings.restore_seconds,
    per_min, sec_per_merge, hist, outcomes, api_cost, api_approx, per_merge, remaining, apex_cost, apex_per_merge, apex_remaining, bulk_cost, api_before, api_after, stamp };
  print_summary(data);   // identical Summary block to items 30/31
  let reportPath = null;
  try { reportPath = await write_report(data); console.log('      report: ' + reportPath); }
  catch (e) { console.log('      (report skipped: ' + e.message + ')'); }
  try {
    const path = require('path'); const { determineOSPathSync } = require('../../../../utilities/determineOSPath');
    const base = path.join(determineOSPathSync(), 'usat_salesforce_merge_stress');
    const band = (o.min_size || '-') + '..' + (o.max_size || '-');
    const sf = await append_sweep_row(base, [now_local(), o.env, o.mode, o.source === 'merge_id' ? 'merge-id' : 'duplicate', band,
      o.count, o.batch, o.seed, hist.length, outcomes.done, outcomes.failed, per_min, api_cost, per_merge, apex_cost, apex_per_merge, fmt_hms(timings.seconds), restore ? restore.status : 'skipped', o.job_id || '-']);
    console.log('      sweep:  ' + sf);
  } catch (e) { console.log('      (sweep row skipped: ' + e.message + (/EBUSY|EPERM|EACCES|locked/i.test(e.message) ? ' — is _sweep_comparison.xlsx open in Excel? close it and re-run' : '') + ')'); }
  return reportPath;
}

// Build the SAME Excel workbook + sweep row for a job that was started from the WEB (Process Merges or the
// Merge Ops batch-run), assembling everything from the DB after the fact: per-batch runs (cost/time/worker),
// history, wall time from the chunk-runs' timestamps, and a best-effort API snapshot. Returns the file path.
// Wall time (seconds) across a set of run rows: earliest claim/start → latest finish.
function _wall_seconds(rows) {
  const ms = (v) => (v ? new Date(v).getTime() : 0);
  const s = rows.map((r) => ms(r.claimed_at || r.started_at)).filter(Boolean);
  const e = rows.map((r) => ms(r.finished_at)).filter(Boolean);
  return (s.length && e.length) ? Math.max(0, Math.round((Math.max(...e) - Math.min(...s)) / 1000)) : 0;
}

async function report_job(jobId, opts = {}) {
  const restoreJobId = opts.restore_job_id || null;
  const { mrun, api_usage } = stores();
  const jp = await mrun.job_progress(jobId);
  if (!jp || !jp.runs || !jp.runs.length) return null;
  const stamp = await get_dataset_stamp();
  const rows = (await Promise.all(jp.runs.map((r) => mrun.get(r.run_id)))).filter(Boolean);
  const enq = rows.map((r) => ({ run_id: r.run_id, batch: Number(r.total_sets) || 0 }));
  const merge_seconds = _wall_seconds(rows);
  // Reconstruct the real API/Apex before→after window from the job's recorded usage so those columns fill.
  let pool = null; try { pool = await get_pool_p(); } catch (e) { pool = null; }
  const win = pool ? await api_usage.job_window(pool, enq.map((e) => e.run_id)).catch(() => null) : null;
  const api_before = win ? win.before : null;
  const api_after = win ? win.after : await api_snapshot(stamp.env);
  const runs = await assemble_runs(mrun, enq, api_after);
  const isRestore = jp.kind === 'restore';
  // Restore phase: either this job IS a restore, or a paired restore job to FOLD INTO this one workbook.
  let restore = null; let restore_seconds = 0;
  if (isRestore) { restore = { run_id: jobId, status: jp.status, hist: await history_for_runs(enq.map((e) => e.run_id)) }; restore_seconds = merge_seconds; }
  else if (restoreJobId) {
    const rjp = await mrun.job_progress(restoreJobId);
    if (rjp && rjp.runs && rjp.runs.length) {
      const rrows = (await Promise.all(rjp.runs.map((r) => mrun.get(r.run_id)))).filter(Boolean);
      restore = { run_id: restoreJobId, status: rjp.status, hist: await history_for_runs(rjp.runs.map((r) => r.run_id)) };
      restore_seconds = _wall_seconds(rrows);
    }
  }
  const o = { mode: jp.mode, env: stamp.env, source: isRestore ? 'restore' : 'duplicate',
    count: jp.total_sets, batch: enq[0] ? enq[0].batch : 0, seed: (opts.seed != null && opts.seed !== '') ? opts.seed : '-', min_size: null, max_size: null, job_id: jobId };
  const sel = { pool: null, sampled: jp.total_sets, entries: [] };
  return finalize_job(o, sel, runs, restore, { seconds: merge_seconds + restore_seconds, merge_seconds, restore_seconds }, stamp, api_before, api_after);
}

// Same workbook + sweep row for a SINGLE run (parallel off, or a job that didn't fan out). One run_id.
async function report_run(runId, opts = {}) {
  const { mrun, api_usage } = stores();
  const row = await mrun.get(runId);
  if (!row) return null;
  const stamp = await get_dataset_stamp();
  const enq = [{ run_id: runId, batch: Number(row.total_sets) || 0 }];
  const seconds = _wall_seconds([row]);
  let pool = null; try { pool = await get_pool_p(); } catch (e) { pool = null; }
  const win = pool ? await api_usage.job_window(pool, [runId]).catch(() => null) : null;
  const api_before = win ? win.before : null;
  const api_after = win ? win.after : await api_snapshot(stamp.env);
  const runs = await assemble_runs(mrun, enq, api_after);
  const isRestore = row.kind === 'restore';
  const o = { mode: row.mode, env: stamp.env, source: isRestore ? 'restore' : 'duplicate',
    count: row.total_sets, batch: Number(row.total_sets) || 0, seed: (opts.seed != null && opts.seed !== '') ? opts.seed : '-', min_size: null, max_size: null, job_id: runId };
  const sel = { pool: null, sampled: row.total_sets, entries: [] };
  const restore = isRestore ? { run_id: runId, status: row.status, hist: await history_for_runs([runId]) } : null;
  return finalize_job(o, sel, runs, restore, { seconds, merge_seconds: isRestore ? 0 : seconds, restore_seconds: isRestore ? seconds : 0 }, stamp, api_before, api_after);
}

// JOB test (Phase 1): like `run`/`parallel` but drives the ACTUAL fan-out path — it splits the approved
// sets with the same chunker + settings the POST /merge/process endpoint uses, enqueues N chunk-runs
// sharing a job_id, and polls mrun.job_progress. Needs the worker cluster running (menu item 2).
async function cmd_job() {
  const { plan_job, make_job_id, should_parallelize } = require('./store/chunk');
  const msettings = require('./store/merge_settings');
  const { mrun } = stores();
  const rl = make_rl();
  const env = (await ask(rl, 'Environment (sandbox/production)', 'sandbox')).toLowerCase().startsWith('prod') ? 'production' : 'sandbox';
  const stamp = await get_dataset_stamp();
  if (stamp.env !== env) { console.log(`\n! Loaded dataset is ${stamp.env}, not ${env}. Re-run the finder against ${env} first.\n`); rl.close(); process.exit(1); }
  const do_clear = (await ask(rl, 'Clear run tables first? (Y/N)', env === 'sandbox' ? 'Y' : 'N')).toUpperCase().startsWith('Y');
  const source = (await ask(rl, 'Source (duplicate/merge-id)', 'duplicate')).toLowerCase().startsWith('merge') ? 'merge_id' : 'group';
  const min_size = source === 'group' ? await ask(rl, 'Min cluster size', '2') : null;
  const max_size = source === 'group' ? await ask(rl, 'Max cluster size', '4') : null;
  const count = Math.max(1, Number(await ask(rl, 'How many merges (count)', '12')) || 12);
  const dfltChunk = await msettings.get('chunk_size');
  const chunk = Math.max(1, Number(await ask(rl, 'Chunk size (sets per parallel batch)', String(dfltChunk))) || dfltChunk);
  const seed = Number(await ask(rl, 'Random seed', String(Date.now() % 100000))) || 1;
  const restore = (await ask(rl, 'Restore afterward? (Y/N)', 'N')).toUpperCase().startsWith('Y');
  const dossier = (await ask(rl, 'Attach dossier? (y/N)', 'N')).toUpperCase().startsWith('Y');
  const stampS = (await ask(rl, 'Stamp survivor? (y/N)', 'N')).toUpperCase().startsWith('Y');
  const mode = (await ask(rl, 'Mode (simulate/execute)', 'simulate')).toLowerCase().startsWith('exec') ? 'execute' : 'simulate';
  if (mode === 'execute') {
    const c = await ask(rl, `Type MERGE to run ${count} REAL merges against ${env}`, '');
    if (c !== 'MERGE') { console.log('Not confirmed — aborting.\n'); rl.close(); process.exit(1); }
    if (env === 'production' && process.env.MERGE_ENABLE_EXECUTION !== 'true') { console.log('MERGE_ENABLE_EXECUTION is not true — aborting.\n'); rl.close(); process.exit(1); }
  }
  rl.close();

  const parallel_enabled = await msettings.get('parallel_enabled');
  const srcLabel = source === 'merge_id' ? 'merge-id' : 'duplicate';
  // Header + step labels mirror items 30/31 (run_sequence) so the console reads the same — the only
  // difference is the PROCESS step drives the real /merge/process fan-out into a job of chunk-runs.
  console.log(`\n=== STRESS TEST · JOB FAN-OUT · ${env} · ${mode.toUpperCase()} · source=${srcLabel} · count=${count} · chunk=${chunk} · seed=${seed} · parallel=${parallel_enabled} ===`);
  if (do_clear) { console.log('\n[1/5] Clearing run tables…'); const c = await clear_run_tables(); console.log('      cleared: ' + c.join(', ')); }
  else console.log('\n[1/5] Skipping clear (keeping existing run tables).');

  console.log('\n[2/5] Selecting targets + queuing…');
  const sel = await select_targets({ env, source, min_size, max_size, count, seed }, stamp);
  console.log(`      pool ${sel.pool} in size ${min_size || '-'}..${max_size || '-'} → sampled ${sel.sampled} → resolvable ${sel.entries.length}`);
  if (!sel.entries.length) { console.log('      nothing resolvable to queue — aborting.\n'); process.exit(1); }
  console.log('      selected sets (survivor · losers · cluster):');
  console.log(format_selection(sel.entries));
  const ids = await queue_and_approve(sel.entries);
  console.log(`      queued + approved ${ids.length} sets`);

  // [3/5] Processing — MIRRORS POST /api/salesforce-merge/merge/process (same chunker + settings).
  const envLabel = env === 'production' ? 'Production' : 'Sandbox';
  const opts = { mode, confirm: 'MERGE', dry_run: mode !== 'execute', stamp_merged: stampS, ack_drift: true, attach_dossier: dossier, created_by: 'stress-test' };
  const o = { mode, env, source, count, batch: chunk, seed, min_size, max_size };  // report/sweep shape (batch = chunk)
  const runStart = Date.now();
  const api_before = await api_snapshot(env);
  const enq = [];   // { run_id, batch } per merge chunk-run — feeds the report
  console.log(`\n[3/5] Processing (${mode}) — fan-out into chunk-runs of ${chunk}…`);
  if (should_parallelize(ids.length, chunk, parallel_enabled)) {
    const chunks = plan_job(ids, chunk);
    const jobId = make_job_id();
    o.job_id = jobId;   // record on the report/sweep (Job column)
    console.log(`      FAN-OUT — ${ids.length} sets → ${chunks.length} chunk-run(s) of <=${chunk} · job_id ${jobId}`);
    for (let i = 0; i < chunks.length; i += 1) {
      const q = await mrun.enqueue({ kind: 'merge', mode, environment: envLabel, org_id: stamp.org_id || null, created_by: 'stress-test',
        job_id: jobId, batch_index: i + 1, batch_total: chunks.length, current_label: `Queued (batch ${i + 1}/${chunks.length})`,
        params: { ids: chunks[i], opts, job_id: jobId, batch_index: i + 1, batch_total: chunks.length } });
      enq.push({ run_id: q.run_id, batch: chunks[i].length });
    }
    console.log(`      ${chunks.length} chunk-runs queued — draining with whatever workers are online (start the CLUSTER via menu item 2)…`);
    await poll_job(mrun, jobId);
  } else {
    console.log(`      parallel NOT triggered (parallel=${parallel_enabled}, chunk ${chunk} >= count ${ids.length}) — single run. Lower chunk or raise count to see fan-out.`);
    const r = await mrun.enqueue({ kind: 'merge', mode, environment: envLabel, org_id: stamp.org_id || null, created_by: 'stress-test', params: { ids, opts } });
    await poll_run(r.run_id, { total: ids.length, onTick: () => {} });
    enq.push({ run_id: r.run_id, batch: ids.length });
  }
  const api_after = await api_snapshot(env);
  const merge_seconds = Math.round((Date.now() - runStart) / 1000);
  // Per-batch rows (used for the worker-split line + the report Batches tab) — same as item 31.
  const runs = await assemble_runs(mrun, enq, api_after);
  console.log('      ' + format_worker_balance(runs));

  // [4/5] Optional restore — fan out the SAME way (kind:'restore') so the job path is exercised for restores too.
  let restoreObj = null; let restore_seconds = 0;
  if (restore) {
    console.log('\n[4/5] Restoring…');
    const rStart = Date.now();
    const chunks = plan_job(ids, chunk);
    const rJob = make_job_id();
    console.log(`      RESTORE fan-out — ${chunks.length} chunk-run(s) · job_id ${rJob}`);
    const renq = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const q = await mrun.enqueue({ kind: 'restore', mode, environment: envLabel, org_id: stamp.org_id || null, created_by: 'stress-test',
        job_id: rJob, batch_index: i + 1, batch_total: chunks.length, current_label: `Queued restore (batch ${i + 1}/${chunks.length})`,
        params: { ids: chunks[i], opts: { mode, confirm: 'RESTORE', ack_post_merge: true, created_by: 'stress-test' }, job_id: rJob, batch_index: i + 1, batch_total: chunks.length } });
      renq.push(q.run_id);
    }
    const rp = await poll_job(mrun, rJob);
    restore_seconds = Math.round((Date.now() - rStart) / 1000);
    restoreObj = { run_id: rJob, status: rp.status, hist: await history_for_runs(renq) };  // hist → write_report's Restores tab
    console.log(`      restore ${chunks.length} batches → done in ${fmt_hms(restore_seconds)}`);
  } else { console.log('\n[4/5] Restore skipped.'); }

  // [5/5] Report — same Summary block + Excel workbook + sweep row as items 30/31.
  console.log('\n[5/5] Writing report…');
  const seconds = Math.round((Date.now() - runStart) / 1000);
  await finalize_job(o, sel, runs, restoreObj, { seconds, merge_seconds, restore_seconds }, stamp, api_before, api_after);
  console.log('\n=== done ===\n');
  process.exit(0);
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
  if (cmd === 'parallel') return cmd_run(false, true);
  if (cmd === 'job') return cmd_job();
  if (cmd === 'sequence' || cmd === 'all') return cmd_run(true);
  console.log('usage: node src/usat_apps/modules/salesforce_merge/stress_test.js <distribution|clear|run|parallel|job|restore|sequence|open> [--env production]');
  process.exit(0);
}

module.exports = { build_distribution, format_distribution, in_size_range, mulberry32, sample, get_distribution, resolve_env, normalize_env, get_dataset_stamp, plan_batches, summarize, format_selection, fmt_hms, active_worker_count, worker_of, work_seconds, format_worker_balance, median_sec_per_merge, select_targets, queue_and_approve, report_job, report_run };

if (require.main === module) main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
