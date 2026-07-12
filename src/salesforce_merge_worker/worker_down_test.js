'use strict';
// Phase 3 "worker down" test.
// Proves a merge does NOT fail when the 8021 worker is offline: the job simply
// stays QUEUED (pending) until a worker claims it. Then it simulates the worker
// coming online (one claim+run tick) and confirms the job DRAINS to done with
// a stored result (parity).
//
// Run where the DB tunnel is reachable, with the pm2 worker STOPPED first
// (so nothing drains the queue underneath the test):
//   npm run stop_salesforce_merge_worker   # make sure 8021 is down
//   node src/salesforce_merge_worker/worker_down_test.js

require('dotenv').config();
const run = require('../usat_apps/modules/salesforce_merge/store/merge_run');
const loop = require('./loop');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  // 1) enqueue while the worker is down
  const e = await run.enqueue({
    kind: 'merge', mode: 'simulate', created_by: 'worker-down-test',
    params: { ids: [], opts: { mode: 'simulate' } }
  });
  console.log('1) enqueued            ->', e.run_id, '(' + e.status + ')');

  // 2) with no worker running the job must STAY queued (it must NOT fail)
  await sleep(3000);
  const pending = await run.get(e.run_id);
  const stayedQueued = !!pending && pending.status === 'queued';
  console.log('2) after 3s, no worker  :', pending && pending.status,
    stayedQueued ? '(correct: pending, not failed)' : '(UNEXPECTED - is the worker running?)');

  // 3) simulate the worker coming online: one claim+run tick
  const did = await loop.tick();
  console.log('3) worker online, tick  :', did ? 'claimed + ran a job' : 'nothing to claim');

  // 4) it should now be done, with a result stored (parity)
  const after = await run.get(e.run_id);
  const drained = !!after && after.status === 'done' && !!after.result;
  console.log('4) after worker tick    :', after && after.status,
    drained ? '(drained + result parity)' : '(UNEXPECTED)');

  const ok = stayedQueued && !!did && drained;
  console.log(ok
    ? '\n✓ WORKER-DOWN TEST PASS  merge stays QUEUED when 8021 is down, DRAINS when it returns'
    : '\n✗ WORKER-DOWN TEST FAIL  check DB env / that the pm2 worker was stopped');
  process.exit(ok ? 0 : 1);
})().catch(function (err) { console.error('test error:', err && err.message); process.exit(1); });
