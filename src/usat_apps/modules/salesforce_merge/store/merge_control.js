'use strict';
// In-process cancellation registry for merge/restore runs. The run loop checks is_cancelled() at safe
// boundaries (between sets); a Stop request flags the run id. The run loop and the cancel HTTP handler
// live in the SAME Node process, so an in-memory Set is sufficient (no DB round-trip needed). A run id
// is unique per run, so flags never collide; clear() is called when a run ends to avoid growth.
const _cancelled = new Set();

// Flag a run for cancellation. The run loop will stop at the next set boundary.
function request(runId) { if (runId) _cancelled.add(String(runId)); return { run_id: runId || null }; }

// Has this run been asked to stop?
function is_cancelled(runId) { return runId != null && _cancelled.has(String(runId)); }

// Drop the flag (call when a run finishes, however it ends).
function clear(runId) { if (runId != null) _cancelled.delete(String(runId)); }

module.exports = { request, is_cancelled, clear };
