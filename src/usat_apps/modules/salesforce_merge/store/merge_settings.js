'use strict';
// Phase 1/2 (parallel workers) — resolve operational merge settings from DB (Phase 2) -> env -> default,
// so an admin can tune them live without env-var round-trips or a redeploy. Phase 1 ships the resolver +
// env fallback; Phase 2 adds the salesforce_merge_settings table as the `source`. Pure + injectable.

// key -> { env: process.env name, def: hard default, coerce+clamp }. bool keys accept true/false/1/0/on/off.
const bool = (v, d) => {
  if (v == null || v === '') return d;
  const s = String(v).toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(s)) return true;
  if (['false', '0', 'off', 'no'].includes(s)) return false;
  return d;
};
const clampInt = (v, lo, hi, d) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};

const SPEC = {
  parallel_enabled: { env: 'MERGE_PARALLEL', def: true, kind: 'bool', coerce: (v, d) => bool(v, d) },
  chunk_size: { env: 'MERGE_CHUNK_SIZE', def: 5, kind: 'int', lo: 1, hi: 50, coerce: (v, d) => clampInt(v, 1, 50, d) },
  // Soft default "max sets per run" (panel/env-tunable). Its real ceiling is max_batch_hard; the static
  // clamp here is just a sanity bound — enforcement min()'s the resolved default against the hard cap.
  max_batch: { env: 'MERGE_MAX_BATCH', def: 100, kind: 'int', lo: 1, hi: 5000, coerce: (v, d) => clampInt(v, 1, 5000, d) },
  // Absolute hard ceiling on sets per Execute — DB → env MERGE_MAX_BATCH_HARD → default 500. One source of
  // truth: every enforcement point clamps to this, and the soft default is min()'d against it so no default
  // can ever exceed the ceiling.
  max_batch_hard: { env: 'MERGE_MAX_BATCH_HARD', def: 500, kind: 'int', lo: 1, hi: 5000, coerce: (v, d) => clampInt(v, 1, 5000, d) },
  worker_target: { env: 'MERGE_WORKER_TARGET', def: 4, kind: 'int', lo: 1, hi: 8, coerce: (v, d) => clampInt(v, 1, 8, d) },
  // Async-Apex circuit breaker: when DailyAsyncApexExecutions used reaches the threshold, a running job
  // PAUSES (remaining batches held; in-flight set finishes) and can be resumed later. Default leaves 50k
  // headroom under the 250k daily cap. Editable live in the Merge Ops panel.
  apex_stop_enabled: { env: 'MERGE_APEX_STOP', def: true, kind: 'bool', coerce: (v, d) => bool(v, d) },
  apex_stop_threshold: { env: 'MERGE_APEX_STOP_AT', def: 200000, kind: 'int', lo: 1000, hi: 250000, coerce: (v, d) => clampInt(v, 1000, 250000, d) },
  // Daily-API circuit breaker (the real-time governor): when DailyApiRequests USED reaches this absolute
  // threshold, a running job PAUSES (resumable). ON by default (like the apex cap). Set the threshold to
  // suit the environment you run against — prod's daily cap is ~410k (300000 ≈ 73%), sandbox is ~5M.
  // Independent of the apex cap — you can run either, both, or neither.
  api_stop_enabled: { env: 'MERGE_API_STOP', def: true, kind: 'bool', coerce: (v, d) => bool(v, d) },
  api_stop_threshold: { env: 'MERGE_API_STOP_AT', def: 300000, kind: 'int', lo: 1000, hi: 5000000, coerce: (v, d) => clampInt(v, 1000, 5000000, d) },
  // Async Apex fires AFTER a merge commits (rollups queue as async jobs), so a snapshot taken right at run
  // end reads ~0 delta. This is how long (seconds) to wait after a run before re-reading usage, so the
  // recorded Apex reflects the fired rollups. 0 disables the settle re-read. Best-effort.
  apex_settle_sec: { env: 'MERGE_APEX_SETTLE_SEC', def: 90, kind: 'int', lo: 0, hi: 600, coerce: (v, d) => clampInt(v, 0, 600, d) },
};

// Circuit-breaker decision (pure): should a job PAUSE now given the current DailyAsyncApexExecutions
// usage? True only when enabled, we have a reading, and used >= threshold. Used by the worker before it
// starts the next batch, and by the enqueue pre-flight to refuse a job that's already over the line.
function apex_should_pause(used, opts = {}) {
  const enabled = opts.enabled !== undefined ? !!opts.enabled : true;
  const threshold = Number(opts.threshold);
  if (!enabled || used == null || !Number.isFinite(threshold)) return false;
  return Number(used) >= threshold;
}

function keys() { return Object.keys(SPEC); }
function spec(key) { return SPEC[key] || null; }

// Coerce+clamp a raw value for a key (used by the admin PUT before persisting, and by resolve()).
function coerce(key, raw) {
  const s = SPEC[key];
  if (!s) return null;
  return s.coerce(raw, s.def);
}

// Resolve one key: DB (via optional async `source(key)`) -> env -> default, then coerce+clamp.
// Returns { value, source: 'db'|'env'|'default' }. `source` is injectable so Phase 2 (the DB table) and
// tests can supply it; when omitted it's env-only.
async function resolve(key, source) {
  const s = SPEC[key];
  if (!s) return { value: null, source: 'unknown' };
  let raw; let from = 'default';
  if (typeof source === 'function') {
    try { const dbv = await source(key); if (dbv != null && dbv !== '') { raw = dbv; from = 'db'; } } catch (e) { /* fall through */ }
  }
  if (raw == null && process.env[s.env] != null && process.env[s.env] !== '') { raw = process.env[s.env]; from = 'env'; }
  if (raw == null) { raw = s.def; from = 'default'; }
  return { value: s.coerce(raw, s.def), source: from };
}

async function get(key, source) { return (await resolve(key, source)).value; }

// Resolve every key -> { <key>: { value, source, def, effective_default, default_source } } for the panel.
// `def` is the raw hardcoded default. `effective_default` is what the value would fall back to WITHOUT a
// saved DB override — i.e. the env var if set, else the code default — resolved by re-running resolve with
// NO db source. `default_source` ('env'|'default') says which of those the effective default came from, so
// the panel can show the accurate fallback (env-aware) instead of the always-hardcoded number.
async function get_all(source) {
  const out = {};
  for (const k of keys()) {
    const r = await resolve(k, source);
    const efd = await resolve(k);   // no source => env -> default only
    out[k] = { ...r, def: SPEC[k].def, kind: SPEC[k].kind, effective_default: efd.value, default_source: efd.source };
  }
  return out;
}

module.exports = { keys, spec, coerce, resolve, get, get_all, apex_should_pause, SPEC };
