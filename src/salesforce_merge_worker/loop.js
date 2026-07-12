'use strict';
// Salesforce merge worker — poll loop (Phase 3). Drains queued `salesforce_merge_run` rows (kind
// merge/restore/recreate) and runs the EXISTING execution code OUT of the usat_apps web process.
// Multi-worker safe: claim_next() is an atomic UPDATE ... LIMIT 1 keyed on a per-tick token, so any
// number of instances never double-claim. User-triggered only: it acts on rows the web enqueued.
const run = require('../usat_apps/modules/salesforce_merge/store/merge_run');
const mexec = require('../usat_apps/modules/salesforce_merge/store/merge_execute');
const mrestore = require('../usat_apps/modules/salesforce_merge/store/merge_restore');

const POLL_MS = Number(process.env.MERGE_WORKER_POLL_MS) || 3000;
const WORKER_ID = 'w' + process.pid;
function log() { if (process.env.MERGE_LOG !== 'off') console.log.apply(console, ['[merge_worker]'].concat([].slice.call(arguments))); }

// DB-backed cancel control injected into mexec/mrestore. The in-process merge_control Set only worked
// when the cancel handler and run loop shared a process; now the web sets a flag on the row and the
// worker reads it here. is_cancelled is async -> the executors await it (they were updated to).
const dbControl = {
  is_cancelled: function (runId) { return run.is_cancelled(runId); },
  clear: function () {},
  request: function (runId) { return run.request_cancel(runId); },
};

let running = true;

async function tick() {
  const token = WORKER_ID + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  let row;
  try { row = await run.claim_next(['merge', 'restore', 'recreate'], token); }
  catch (e) { log('claim error:', e && e.message); return false; }
  if (!row) return false;
  let params = {};
  try { params = row.params ? JSON.parse(row.params) : {}; } catch (e) { params = {}; }
  const opts = Object.assign({}, params.opts, { run_id: row.run_id });
  log('claimed', row.run_id, 'kind=' + row.kind, 'by', token);
  try {
    if (row.kind === 'restore') await mrestore.restore(params.ids, opts, { control: dbControl });
    else if (row.kind === 'recreate') await mrestore.recreate(params.ids, opts, { control: dbControl });
    else await mexec.process(params.ids, opts, { control: dbControl });
    log('finished', row.run_id);
  } catch (e) {
    log('run', row.run_id, 'FAILED:', e && e.message);
    try { await run.finish(row.run_id, { status: 'error', current_label: (e && e.message) || 'worker error' }); } catch (_) { /* ignore */ }
  }
  return true;
}

async function main() {
  log('started pid=' + process.pid, 'poll=' + POLL_MS + 'ms');
  while (running) {
    let did = false;
    try { did = await tick(); } catch (e) { log('tick error:', e && e.message); }
    if (!did) await new Promise(function (r) { setTimeout(r, POLL_MS); });
  }
  log('stopped');
}

function stop() { running = false; }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

module.exports = { main, tick, stop, dbControl, WORKER_ID };
