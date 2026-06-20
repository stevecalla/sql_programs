#!/usr/bin/env node
'use strict';
// CLI for the email-queue analytics table — mirrors the race_results_transform metrics CLI.
// Commands: stats [days] | size | purge-test | purge-all | cleanup
// Reuses metrics_report (DB pool + report_text + retention helpers). Read-only except the explicit
// purge/cleanup commands. No Salesforce access.
const report = require('./metrics_report');

async function main() {
  const cmd = (process.argv[2] || 'stats').toLowerCase();
  const arg = process.argv[3];
  let pool;
  try { pool = await report.get_pool(); }
  catch (e) { console.error('Analytics DB not available: ' + e.message); process.exit(1); }
  try {
    if (cmd === 'stats') {
      console.log(await report.report_text(pool, { days: Number(arg) || 7 }));
    } else if (cmd === 'size') {
      console.log(JSON.stringify(await report.size(pool), null, 2));
    } else if (cmd === 'purge-test') {
      const r = await report.purge_test(pool);
      console.log('Deleted ' + r.deleted + ' test row(s) (is_test=1; would=' + r.would_delete + ').');
    } else if (cmd === 'purge-all') {
      const r = await report.purge_all(pool);
      console.log('Deleted ' + r.deleted + ' row(s) (ALL).');
    } else if (cmd === 'cleanup') {
      const r = await report.cleanup(pool, {});
      console.log('Deleted ' + r.deleted + ' old row(s) (kept >= cutoff year ' + r.cutoff_year + ').');
    } else {
      console.log('usage: metrics_cli.js [stats [days] | size | purge-test | purge-all | cleanup]');
    }
  } finally { try { await pool.end(); } catch (e) {} }
}
main();
