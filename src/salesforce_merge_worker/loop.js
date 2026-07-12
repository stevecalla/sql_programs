'use strict';
// Salesforce merge worker — queue-drain loop (Phase 3). Claims queued `salesforce_merge_run` rows
// (kind merge/restore/recreate) and runs the EXISTING execution code OUT of the usat_apps web process.
// Multi-worker safe: claim_next() is an atomic UPDATE ... LIMIT 1 keyed on a per-tick token. Lifecycle
// (start/stop/signals) is owned by the server entry (server_salesforce_merge_worker_8021.js).
const run = require('../usat_apps/modules/salesforce_merge/store/merge_run');
const mexec = require('../usat_apps/modules/salesforce_merge/store/merge_execute');
const mrestore = require('../usat_apps/modules/salesforce_merge/store/merge_restore');

const POLL_MS = Number(process.env.MERGE_WORKER_POLL_MS) || 3000;
const WORKER_ID = 'w' + process.pid;
function log() { if (process.env.MERGE_LOG !== 'off') console.log.apply(console, ['[merge_worker]'].concat([].slice.call(arguments))); }

// DB-backed cancel control injected into the executors. The in-process merge_control Set only worked
// when the cancel handler and run loop shared a process; now the web sets a flag on the row and the
// worker reads it here. is_cancelled is async -> the executors were updated to await it.
const dbControl = {
  is_cancelled: function (runId) { return run.is_cancelled(runId); },
  clear: function () { },
  request: function (runId) { return run.request_cancel(runId); },
};

let running = false;
const stats = { started_at: null, last_claim_at: null, current_run: null, processed: 0, failed: 0 };

async function tick() {
  const token = WORKER_ID + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  let row;
  try { row = await run.claim_next(['merge', 'restore', 'recreate'], token); }
  catch (e) { log('claim error:', e && e.message); return false; }
  if (!row) return false;
  stats.current_run = row.run_id; stats.last_claim_at = new Date().toISOString();
  let params = {};
  try { params = row.params ? JSON.parse(row.params) : {}; } catch (e) { params = {}; }
  const opts = Object.assign({}, params.opts, { run_id: row.run_id });
  log('claimed', row.run_id, 'kind=' + row.kind, 'by', token);
  try {
    let out = null;
    if (row.kind === 'restore') out = await mrestore.restore(params.ids, opts, { control: dbControl });
    else if (row.kind === 'recreate') out = await mrestore.recreate(params.ids, opts, { control: dbControl });
    else out = await mexec.process(params.ids, opts, { control: dbControl });
    // Parity: store the executor's own result object (minus the big per-set array) on the run row.
    if (out) { const summary = Object.assign({}, out); delete summary.results; try { await run.set_result(row.run_id, summary); } catch (e) { /* ignore */ } }
    stats.processed += 1;
    log('finished', row.run_id);
  } catch (e) {
    stats.failed += 1;
    log('run', row.run_id, 'FAILED:', e && e.message);
    try { await run.finish(row.run_id, { status: 'error', current_label: (e && e.message) || 'worker error' }); } catch (_) { /* ignore */ }
  }
  stats.current_run = null;
  return true;
}

async function main() {
  running = true;
  stats.started_at = new Date().toISOString();
  log('loop started pid=' + process.pid, 'poll=' + POLL_MS + 'ms');
  while (running) {
    let did = false;
    try { did = await tick(); } catch (e) { log('tick error:', e && e.message); }
    if (!did) await new Promise(function (r) { setTimeout(r, POLL_MS); });
  }
  log('loop stopped');
}

function start() { if (!running) main().catch(function (e) { log('loop fatal:', e && e.message); }); }
function stop() { running = false; }
function info() {
  return {
    running: running, poll_ms: POLL_MS, worker_id: WORKER_ID, started_at: stats.started_at,
    last_claim_at: stats.last_claim_at, current_run: stats.current_run, processed: stats.processed, failed: stats.failed
  };
}

module.exports = { main, start, stop, tick, info, dbControl, WORKER_ID };
