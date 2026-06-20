#!/usr/bin/env node
'use strict';
// CLI for the email-queue analytics — mirrors the race_results_transform metrics CLI.
// Commands: stats [days] | size | purge-test | purge-all | cleanup | ask "<question>" [--provider openai|claude] | guard
// Read-only except the explicit purge/cleanup commands. No Salesforce access.
const report = require('./metrics_report');

async function with_pool(fn) {
  let pool;
  try { pool = await report.get_pool(); }
  catch (e) { console.error('Analytics DB not available: ' + e.message); process.exit(1); }
  try { await fn(pool); } finally { try { await pool.end(); } catch (e) {} }
}

async function main() {
  const cmd = (process.argv[2] || 'stats').toLowerCase();
  const arg = process.argv[3];

  if (cmd === 'guard') {                                   // pure — no DB needed
    const guard = require('./ask/sql_guard'); const T = report.TABLE;
    ['SELECT ai_provider, COUNT(*) n FROM ' + T + ' GROUP BY 1', 'DELETE FROM ' + T, 'SELECT * FROM secret; DROP TABLE x']
      .forEach(function (q) { try { console.log('ACCEPT  ' + guard.assert_safe_select(q)); } catch (e) { console.log('REJECT  ' + q + '   -> ' + e.message); } });
    return;
  }
  if (cmd === 'ask') {                                     // ask manages its own read-only pool (ask/db)
    const question = process.argv.slice(3).filter(function (a) { return a.indexOf('--') !== 0; }).join(' ');
    if (!question) { console.log('usage: metrics_cli.js ask "<question>" [--provider openai|claude]'); return; }
    const pi = process.argv.indexOf('--provider'); const provider = pi > 0 ? process.argv[pi + 1] : undefined;
    const r = await require('./ask/ask').ask(question, { provider: provider });
    if (r.sql) console.log('SQL: ' + r.sql);
    console.log('\n' + (r.answer || '(no answer)'));
    try { await require('./ask/db').close_pool(); } catch (e) {}
    return;
  }

  await with_pool(async function (pool) {
    if (cmd === 'stats') { console.log(await report.report_text(pool, { days: Number(arg) || 7 })); }
    else if (cmd === 'size') { console.log(JSON.stringify(await report.size(pool), null, 2)); }
    else if (cmd === 'purge-test') { const r = await report.purge_test(pool); console.log('Deleted ' + r.deleted + ' test row(s) (is_test=1; would=' + r.would_delete + ').'); }
    else if (cmd === 'purge-all') { const r = await report.purge_all(pool); console.log('Deleted ' + r.deleted + ' row(s) (ALL).'); }
    else if (cmd === 'cleanup') { const r = await report.cleanup(pool, {}); console.log('Deleted ' + r.deleted + ' old row(s) (kept >= cutoff year ' + r.cutoff_year + ').'); }
    else { console.log('usage: metrics_cli.js [stats [days] | size | purge-test | purge-all | cleanup | ask "<q>" | guard]'); }
  });
}
main();
