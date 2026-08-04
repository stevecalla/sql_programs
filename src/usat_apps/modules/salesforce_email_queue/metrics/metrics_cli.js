'use strict';
// metrics_cli.js — tiny command-line for the Email Queue analytics table, used by the admin Operations
// console + the module CLI menu. Ported from the standalone metrics_cli, re-homed onto the platform pool
// (store/db) + this module's metrics_report + metrics/ask. Commands:
//   stats | size | purge-test | cleanup | purge-all | ask "<question>" [--model <id>] | guard
// The purge/cleanup commands require --yes (the console always passes it; the panel gates the destructive
// ones). `guard` needs no DB and no AI key; `ask` needs both.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const db = require('../../../store/db');
const analytics = require('./events');
const report = require('./metrics_report');
const askmod = require('./ask');

function has_yes() { return process.argv.indexOf('--yes') >= 0; }

// `ask "<question>" [--model <id>]` — parse the positional question + optional --model flag.
function parse_ask_args() {
  const rest = process.argv.slice(3);
  let model = '';
  const q = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--model' || rest[i] === '--provider') { model = rest[i + 1] || ''; i++; }
    else q.push(rest[i]);
  }
  return { question: q.join(' ').trim(), model: model };
}

// `guard` — demonstrate the read-only SQL guard on ACCEPT/REJECT examples. No DB, no key.
function run_guard() {
  const T = askmod.TABLE;
  const accept = [
    'SELECT provider, COUNT(*) c FROM ' + T + ' GROUP BY provider',
    'SELECT * FROM ' + T + ' LIMIT 5',
    'SELECT event_name, COUNT(*) n FROM ' + T + ' WHERE is_test=0 GROUP BY event_name ORDER BY n DESC LIMIT 10',
  ];
  const reject = [
    'DELETE FROM ' + T,
    'SELECT * FROM users',
    'SELECT 1; DROP TABLE ' + T,
    'UPDATE ' + T + ' SET is_test=1',
  ];
  console.log('Read-only SQL guard demo — table `' + T + '`, max LIMIT ' + askmod.MAX_LIMIT + '\n');
  console.log('ACCEPT:');
  accept.forEach(function (q) {
    try { console.log('  ✓ ' + q + '\n      -> ' + askmod.assert_safe_select(q)); }
    catch (e) { console.log('  ✗ (unexpected reject) ' + q + '  ::  ' + e.message); }
  });
  console.log('\nREJECT:');
  reject.forEach(function (q) {
    try { askmod.assert_safe_select(q); console.log('  ✗ (LEAK — accepted!) ' + q); }
    catch (e) { console.log('  ✓ blocked: ' + q + '\n      -> ' + e.message); }
  });
}

async function main() {
  const cmd = (process.argv[2] || 'stats').toLowerCase();

  if (cmd === 'guard') { run_guard(); return; }   // no DB / no key

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
  } else if (cmd === 'ask') {
    const a = parse_ask_args();
    if (!a.question) { console.log('usage: metrics_cli.js ask "<question>" [--model <id>]'); }
    else {
      const r = await askmod.ask(pool, { question: a.question, model: a.model || undefined });
      console.log('Q:      ' + r.question);
      console.log('SQL:    ' + r.sql);
      console.log('Rows:   ' + r.row_count + '   (model: ' + r.model + ', provider: ' + r.provider + ')');
      console.log('Answer: ' + r.answer);
    }
  } else {
    console.log('usage: metrics_cli.js stats | size | purge-test --yes | cleanup --yes | purge-all --yes | ask "<question>" [--model <id>] | guard');
  }
  try { if (db.end) await db.end(); } catch (e) { /* ignore */ }
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
