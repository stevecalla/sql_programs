'use strict';
// One-off, idempotent — ensure created_at_mtn + created_at_utc exist on the four merge tables
// (salesforce_merge_run / _queue / _history / _premerge_snapshot). Matches the event-table convention:
// two wall-clock DATETIME columns (Denver local + UTC), written by the app at insert. The web + worker
// both call ensure_table() on boot, so this is only for a deliberate manual migration.
require('dotenv').config();

const stores = [
  ['salesforce_merge_run', require('../../usat_apps/modules/salesforce_merge/store/merge_run')],
  ['salesforce_merge_queue', require('../../usat_apps/modules/salesforce_merge/store/merge_queue')],
  ['salesforce_merge_history', require('../../usat_apps/modules/salesforce_merge/store/merge_history')],
  ['salesforce_merge_premerge_snapshot', require('../../usat_apps/modules/salesforce_merge/store/merge_snapshot')],
];
const db = require('../../usat_apps/store/db');

(async function () {
  try {
    for (const [name, s] of stores) {
      await s.ensure_table();
      console.log(name + ': created_at_mtn / created_at_utc ensured.');
    }
    await db.end();
    process.exit(0);
  } catch (e) {
    console.error('failed:', (e && e.message) || e);
    process.exit(1);
  }
})();
