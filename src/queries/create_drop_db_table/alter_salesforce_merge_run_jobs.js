'use strict';
// Phase 1 parallel workers (one-off, idempotent) — ensure `salesforce_merge_run` has the job columns:
//   job_id, batch_index, batch_total  (groups the parallel chunk-runs of one user job).
// ensure_table() also SELF-HEALS column order: if an earlier boot appended these at the tail (past the
// created_at_* wall-clocks), it repositions them after org_id and keeps created_at_* last. The web +
// worker both call ensure_table() on boot, so this script is just for a deliberate manual migration.
require('dotenv').config();
const run = require('../../usat_apps/modules/salesforce_merge/store/merge_run');
(async function () {
  try { await run.ensure_table(); console.log('salesforce_merge_run: job columns ensured + column order normalized (job/batch after org_id, created_at_* last).'); process.exit(0); }
  catch (e) { console.error('failed:', (e && e.message) || e); process.exit(1); }
})();
