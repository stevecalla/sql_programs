'use strict';
// Hands-on review of the read-only SQL guard (metrics/ASK_DESIGN.md §7). No DB
// connection — pure guard logic. Run:  node metrics/ask/demo_guard.js
// Or test your own query:  node metrics/ask/demo_guard.js "SELECT ... FROM <table>"
const { assert_safe_select } = require('./sql_guard');
const { CATALOG, ALLOWED_TABLES } = require('./db');
const T = require('../metrics_config').TABLE;

const argv = process.argv.slice(2);
const show_header = argv.indexOf('--no-header') < 0;   // menu prints the header itself
const query_args = argv.filter(function (a) { return a !== '--no-header'; });

if (show_header) {
  console.log('\n  Read-only guard demo — tables you may query (allowlist):');
  CATALOG.forEach(function (t) {
    console.log('    • ' + t.name + (t.grain ? '  (' + t.grain + ')' : ''));
    if (t.description) console.log('        ' + t.description);
  });
  console.log('\n  Try your own:  node metrics/ask/demo_guard.js "SELECT event_name, COUNT(*) FROM '
    + ALLOWED_TABLES[0] + ' GROUP BY event_name"');
}

const examples = [
  'SELECT COUNT(DISTINCT visitor_id) FROM ' + T + " WHERE event_name='page_view'",
  'SELECT event_name, COUNT(*) AS n FROM ' + T + ' GROUP BY event_name ORDER BY n DESC',
  'SELECT * FROM ' + T,                          // LIMIT injected
  'SELECT * FROM ' + T + ' LIMIT 50000',         // LIMIT clamped
  'UPDATE ' + T + ' SET event_name=1',           // rejected: write
  'DROP TABLE ' + T,                             // rejected: DDL
  'SELECT * FROM membership_data',               // rejected: off allowlist
  'SELECT 1 FROM ' + T + '; DROP TABLE ' + T,    // rejected: multi-statement
  'SELECT SLEEP(5) FROM ' + T                    // rejected: DoS
];
const queries = query_args.length ? [query_args.join(' ')] : examples;
console.log(query_args.length ? '\n  --- your query ---' : '\n  --- example queries ---');
for (const q of queries) {
  try {
    console.log('\n  ACCEPT  ' + q + '\n      ->  ' + assert_safe_select(q));
  } catch (e) {
    console.log('\n  REJECT  ' + q + '\n      ->  ' + e.message);
  }
}
console.log('');
