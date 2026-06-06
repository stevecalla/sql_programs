'use strict';
// Guards the retention helpers (mock pool, no DB): purge_keep_years keeps the
// current + prior calendar year via a COALESCE(created_at_mtn, created_at_utc)
// year filter (no CONVERT_TZ), and purge_all deletes every row. Pure SQL-shape checks.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const retention = require('../../../utilities/analytics/retention');

function mock_pool(count) {
  const calls = [];
  return {
    calls: calls,
    query: async function (sql, params) {
      calls.push(sql);
      if (/^SELECT COUNT/i.test(sql)) return [[{ n: count == null ? 5 : count }]];
      return [{ affectedRows: count == null ? 5 : count }];   // DELETE result
    }
  };
}

describe('metrics_retention', () => {
test('purge_keep_years filters by YEAR(COALESCE(...)) < cutoff and never uses CONVERT_TZ', async () => {
  const pool = mock_pool(5);
  const now_year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date()));
  const r = await retention.purge_keep_years(pool, 't_events', 2, 'America/Denver');
  const del = pool.calls.find(function (s) { return /^DELETE/i.test(s); });
  assert.ok(del.indexOf('COALESCE(created_at_mtn, created_at_utc)') >= 0, 'uses COALESCE fallback');
  assert.ok(del.indexOf('CONVERT_TZ') < 0, 'no MySQL CONVERT_TZ dependency');
  assert.ok(del.indexOf('< ' + (now_year - 1)) >= 0, 'keeps current + prior year (cutoff = thisYear-1)');
  assert.equal(r.deleted, 5);
  assert.equal(r.cutoff_year, now_year - 1);
});

test('purge_all deletes every row with no date filter', async () => {
  const pool = mock_pool(80);
  const r = await retention.purge_all(pool, 't_events');
  const del = pool.calls.find(function (s) { return /^DELETE/i.test(s); });
  assert.match(del, /^DELETE FROM `t_events`\s*$/, 'unconditional delete, no WHERE');
  assert.equal(r.deleted, 80);
  assert.equal(r.would_delete, 80);
});
});
