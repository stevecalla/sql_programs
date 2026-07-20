'use strict';
// Pure pre-flight estimator for a merge run's Daily API Requests cost. Mirrors the engine's batching:
// W.merge_one processes 2 losers per call, so a set with L losers costs max(1, ceil(L/2)) merge calls
// (exactly the engine's own `ceil2` op model). Each set also costs read overhead (re-fetch + child
// snapshot + validate) and, optionally, one survivor "stamp" update. OVERHEAD_PER_SET is a conservative
// starting default — calibrate it from captured run_cost (Phase 2/3 data) once real runs exist.
const OVERHEAD_PER_SET = 3;
// Async Apex per set: merges trigger managed-package rollups (dlrs, Cirrus) that run as async Apex.
// DailyAsyncApexExecutions (~250K/day) is far tighter than Daily API Requests, so this is the binding
// limit. Calibrated to ~100/merge (measured ~74/merge over a 100-merge sandbox run + margin for the
// deferred async that a run-total under-counts); override with MERGE_APEX_PER_SET as data refines.
const APEX_PER_SET = Number(process.env.MERGE_APEX_PER_SET) || 100;

function merge_calls_for(loser_count) { return Math.max(1, Math.ceil((Number(loser_count) || 0) / 2)); }

// entries: [{ loser_count }]; opts: { overhead_per_set, stamp_merged }
function estimate_run_calls(entries, opts) {
  opts = opts || {};
  const overhead = opts.overhead_per_set == null ? OVERHEAD_PER_SET : Number(opts.overhead_per_set);
  const stampPer = opts.stamp_merged ? 1 : 0;
  let merge_calls = 0;
  let sets = 0;
  (entries || []).forEach(function (e) { sets += 1; merge_calls += merge_calls_for(e.loser_count); });
  return {
    sets: sets,
    merge_calls: merge_calls,
    overhead_calls: sets * overhead,
    stamp_calls: sets * stampPer,
    total: merge_calls + sets * (overhead + stampPer),
    apex_total: sets * APEX_PER_SET,
  };
}

module.exports = { merge_calls_for, estimate_run_calls, OVERHEAD_PER_SET, APEX_PER_SET };
