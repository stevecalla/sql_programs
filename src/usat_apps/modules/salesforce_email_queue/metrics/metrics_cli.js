'use strict';
// metrics_cli.js — tiny command-line for the Email Queue analytics table, used by the admin Operations
// console (ids 7–11). Ported from the standalone metrics_cli, re-homed onto the platform pool (store/db)
// + this module's metrics_report. Commands: stats | size | purge-test | cleanup | purge-all. The purge/
// cleanup commands require --yes (the console always passes it; the panel gates the destructive ones).
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const db = require('../../../store/db');
const analytics = require('./events');
const report = require('./metrics_report');

function has_yes() { return process.argv.indexOf('--yes') >= 0; }

async function main() {
  const cmd = (process.argv[2] || 'stats').toLowerCase();
  const pool = await db.get_pool();
  await analytics.ensure(pool);

  if (cmd === 'stats') {
    console.log(await report.report_text(pool, { days: 7 }));
  } else if (cmd === 'size') {
    console.log(JSON.stringify(await report.size(pool), null, 2));
  } else if (cmd === 'purge-test') {
    if (!has_yes()) { console.log('Refusing without --yes. This deletes $0 test rows (is_test=1); cost-bearing test runs are kept.'); }
    else { console.log('Purged $0 test rows:', JSON.stringify(await report.purge_test(pool))); }
  } else if (cmd === 'cleanup') {
    if (!has_yes()) { console.log('Refusing without --yes. This drops rows older than the keep window.'); }
    else { console.log('Cleanup (old years):', JSON.stringify(await report.cleanup(pool, {}))); }
  } else if (cmd === 'purge-all') {
    if (!has_yes()) { console.log('Refusing without --yes. This deletes EVERY analytics row for this app.'); }
    else { console.log('Purged ALL rows:', JSON.stringify(await report.purge_all(pool))); }
  } else {
    console.log('usage: metrics_cli.js stats | size | purge-test --yes | cleanup --yes | purge-all --yes');
  }
  try { if (db.end) await db.end(); } catch (e) { /* ignore */ }
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
