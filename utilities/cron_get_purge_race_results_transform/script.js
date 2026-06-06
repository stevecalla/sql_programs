// Retention purge for race_results_transform usage analytics. Keeps the current
// + prior calendar year; deletes older rows. Standalone (no server required) —
// uses the same metrics_report helper the CLI uses.
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });   // repo-root .env, CWD-independent
const metrics = require('../../src/race_results_transform/metrics/metrics_report');

(async function () {
  console.log(`\nHello - RUN RACE RESULTS TRANSFORM RETENTION PURGE JOB`);
  console.log("Current Date and Time:", new Date().toLocaleString());
  try {
    const pool = await metrics.get_pool();
    try {
      const r = await metrics.cleanup(pool, {});   // keep_years from metrics_config (current + prior)
      console.log('Purged ' + r.deleted + ' row(s) beyond the kept window (' + metrics.TABLE + ').');
    } finally { await pool.end(); }
  } catch (e) {
    console.error('Retention purge error:', e.message);
    process.exit(1);
  }
})();
