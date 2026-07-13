'use strict';
// Minimal Phase 3 smoke — no UI, no Salesforce, no writes. Enqueues a SIMULATE run with zero sets,
// runs ONE worker tick (claim + execute + finish), and prints the run row. Proves the pipeline
// enqueue -> claim -> run -> done -> result against the real DB. Run: npm run salesforce_merge_worker_smoke
require('dotenv').config();
const run = require('../usat_apps/modules/salesforce_merge/store/merge_run');
const loop = require('./loop');

(async function () {
  const e = await run.enqueue({ kind: 'merge', mode: 'simulate', created_by: 'smoke-test', params: { ids: [], opts: { mode: 'simulate' } } });
  console.log('1) enqueued            ->', e.run_id, '(' + e.status + ')');
  const before = await run.get(e.run_id);
  console.log('   status before tick   :', before && before.status);
  const did = await loop.tick();
  console.log('2) worker tick ran a job:', did);
  const after = await run.get(e.run_id);
  console.log('3) status after tick    :', after && after.status);
  console.log('   result stored (parity):', after && after.result);
  const ok = !!did && after && after.status === 'done' && !!after.result;
  console.log(ok ? '\n✓ PHASE 3 SMOKE PASS — enqueue -> claim -> run -> done -> result parity'
                 : '\n✗ PHASE 3 SMOKE FAIL — check DB env / worker logs');
  process.exit(ok ? 0 : 1);
})().catch(function (err) { console.error('smoke error:', err && err.message); process.exit(1); });
