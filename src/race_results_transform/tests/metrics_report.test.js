'use strict';
// Regression test for "Last User Activity" on the /metrics dashboard.
//
// The top-right Last-User-Activity chip (health.latest) and the Top Users
// "Last activity" column (top_users.last_seen) must reflect REAL activity only,
// excluding the server-side `dashboard_view` event that fires on each /metrics
// open — otherwise merely viewing the dashboard bumps the date. The whole-table
// row count (rows_total) must stay UNFILTERED (it's a DB-size health figure).
//
// build_report() only ever calls pool.query(), so we drive it with a fake pool
// that records every SQL string and returns empty rows. No DB needed.
const { test } = require('node:test');
const assert = require('node:assert');
const report = require('../metrics/metrics_report');

function make_fake_pool() {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push(String(sql));
      return [[]]; // mysql2 shape: [rows, fields] — empty result set
    }
  };
}

// The query that produces the chip: it selects the whole-table row count AND the
// latest activity timestamp in one statement.
function find_health_sql(seen) {
  return seen.find(function (s) { return /rows_total/.test(s) && /latest/.test(s); });
}
// The Top Users query: aggregates per visitor_id and selects last_seen.
function find_top_users_sql(seen) {
  return seen.find(function (s) { return /last_seen/.test(s) && /GROUP BY visitor_id/.test(s); });
}

test('Last User Activity chip excludes dashboard_view but keeps row count unfiltered', async function () {
  const pool = make_fake_pool();
  await report.build_report(pool, { days: 7 });

  const health = find_health_sql(pool.seen);
  assert.ok(health, 'expected a health query selecting rows_total + latest');

  // The latest-activity timestamp must be guarded against dashboard_view.
  assert.match(health, /MAX\(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END\)/,
    'latest activity must exclude dashboard_view events');

  // The row count must NOT be filtered — it counts every row in the table.
  assert.match(health, /COUNT\(\*\)\s+rows_total/, 'rows_total must remain a plain whole-table COUNT(*)');
});

test('Top Users last activity column excludes dashboard_view', async function () {
  const pool = make_fake_pool();
  await report.build_report(pool, { days: 7 });

  const top = find_top_users_sql(pool.seen);
  assert.ok(top, 'expected a top-users query with last_seen + GROUP BY visitor_id');
  assert.match(top, /MAX\(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END\)/,
    'per-user last_seen must exclude dashboard_view events');
});

test('Top Users last activity is formatted in SQL (true MTN, not JS-shifted to UTC)', async function () {
  const pool = make_fake_pool();
  await report.build_report(pool, { days: 7 });

  const top = find_top_users_sql(pool.seen);
  assert.ok(top, 'expected a top-users query with last_seen');
  // Must wrap the MAX(...) in DATE_FORMAT so MySQL returns a plain MTN string. Returning the raw
  // DATETIME and calling toISOString() in JS would shift the displayed time to UTC.
  assert.match(top, /DATE_FORMAT\(MAX\(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END\), '%Y-%m-%d %l:%i %p'\)\s+last_seen/,
    'last_seen must be formatted in SQL via DATE_FORMAT (12-hour, AM/PM) to stay true MTN');
});
