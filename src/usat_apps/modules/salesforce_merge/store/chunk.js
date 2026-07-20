'use strict';
// Phase 1 (parallel workers) — the ONE chunker that splits a user's merge/restore job into parallel
// batches. A "job" is enqueued as N runs (one per chunk) that share a job_id; a running pm2 worker
// cluster drains them side by side. Pure + unit-tested; no DB / network.

// Split ids into contiguous chunks of at most `size`. size<=0 or ids<=size yields a single chunk
// (the behavior-preserving, non-parallel path). Order is preserved.
function plan_job(ids, size) {
  const list = Array.isArray(ids) ? ids.filter((x) => x != null) : [];
  const n = Math.max(1, Math.floor(Number(size) || 1));
  if (list.length === 0) return [];
  if (list.length <= n) return [list];
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

// A stable, sortable job id shared by all of a job's chunk-runs.
function make_job_id() {
  return 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// Should this job actually fan out? Only when parallel is enabled AND there's more than one chunk's
// worth of sets. Everything else stays a single run (identical to the pre-parallel path).
function should_parallelize(count, size, enabled) {
  return !!enabled && Math.floor(Number(count) || 0) > Math.max(1, Math.floor(Number(size) || 1));
}

module.exports = { plan_job, make_job_id, should_parallelize };
