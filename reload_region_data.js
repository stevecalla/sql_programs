'use strict';
// reload_region_data.js — reload the region_data reference table from the CSV(s) in the usat_region_data
// folder (drop → recreate → LOAD DATA). Run this after editing the region CSV (e.g. adding lat/lng or a
// state's region). Keep exactly ONE .csv in that folder — every .csv there is loaded.
//   node reload_region_data.js
const { execute_load_region_data } = require('./src/sales_data_v2/step_2a_load_region_table');

execute_load_region_data()
  .then(() => { console.log('\n✅ region_data reloaded from the source CSV.'); process.exit(0); })
  .catch((e) => { console.error('\n❌ region_data reload FAILED:', e && e.message ? e.message : e); process.exit(1); });
