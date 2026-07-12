'use strict';
// Phase 3 (one-off, idempotent) — ensure `salesforce_merge_run` has the worker columns:
//   claimed_by, claimed_at, cancel_requested, params  (the 'queued' status is just a value, no DDL).
// The web + worker both call ensure_table() on boot, so this is only for a deliberate manual migration.
require('dotenv').config();
const run = require('../../usat_apps/modules/salesforce_merge/store/merge_run');
(async function () {
  try { await run.ensure_table(); console.log('salesforce_merge_run: worker columns ensured.'); process.exit(0); }
  catch (e) { console.error('failed:', (e && e.message) || e); process.exit(1); }
})();
