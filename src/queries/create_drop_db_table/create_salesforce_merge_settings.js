'use strict';
// Phase 2 parallel workers (one-off, idempotent) — create the `salesforce_merge_settings` table that
// backs the live, admin-tunable merge settings (parallel_enabled / chunk_size / max_batch / worker_target
// / apex cap). The API + worker call ensure() lazily on first use, so this is only for a deliberate
// manual pre-create.
require('dotenv').config();
const store = require('../../usat_apps/modules/salesforce_merge/store/merge_settings_store');
(async function () {
  try { await store.ensure(); console.log('salesforce_merge_settings: ensured.'); process.exit(0); }
  catch (e) { console.error('failed:', (e && e.message) || e); process.exit(1); }
})();
