'use strict';
// Guards the analytics ingest: only whitelisted columns are inserted, the two
// canonical timestamps are always stamped, PII-shaped keys are dropped, and a DB
// failure never throws (always 204). Pure — mock pool, no DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { make_event_ingest } = require('../../../utilities/analytics/event_ingest');

function mock_pool() {
  const calls = [];
  return { calls: calls, query: async function (sql, params) { calls.push({ sql: sql, params: params }); return [{}]; } };
}
function mock_res() {
  return { code: 0, ended: false,
    status: function (c) { this.code = c; return this; },
    end: function () { this.ended = true; return this; } };
}

describe('metrics_ingest', () => {
test('inserts only whitelisted columns + stamps created_at_utc/mtn', async () => {
  const pool = mock_pool();
  const handler = make_event_ingest({ pool: pool, table: 't_events', columns: ['event_name', 'file_type', 'row_count'] });
  const res = mock_res();
  await handler({ body: { event_name: 'file_uploaded', file_type: 'csv', row_count: 9, secret_pii: 'nope', drop_me: 'x' } }, res);
  assert.equal(pool.calls.length, 1);
  const sql = pool.calls[0].sql;
  assert.match(sql, /INSERT INTO `t_events`/);
  assert.ok(sql.indexOf('`event_name`') >= 0 && sql.indexOf('`file_type`') >= 0 && sql.indexOf('`row_count`') >= 0);
  assert.ok(sql.indexOf('secret_pii') < 0 && sql.indexOf('drop_me') < 0, 'non-whitelisted keys must be dropped');
  assert.ok(sql.indexOf('`created_at_utc`') >= 0 && sql.indexOf('`created_at_mtn`') >= 0, 'stamps both timestamps');
  assert.ok(sql.indexOf('CONVERT_TZ') < 0, 'timestamps are computed in Node, not via MySQL CONVERT_TZ');
  // bound params: the 3 whitelisted values, then the two stamped timestamps
  assert.deepEqual(pool.calls[0].params.slice(0, 3), ['file_uploaded', 'csv', 9]);
  assert.equal(pool.calls[0].params.length, 5);
  const TS = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/;
  assert.match(String(pool.calls[0].params[3]), TS, 'created_at_utc is a timestamp string');
  assert.match(String(pool.calls[0].params[4]), TS, 'created_at_mtn is a timestamp string');
  assert.equal(res.code, 204);
});

test("empty string becomes NULL; an unknown-only body still 204s with no insert", async () => {
  const pool = mock_pool();
  const handler = make_event_ingest({ pool: pool, table: 't_events', columns: ['event_name', 'file_name'] });
  const res = mock_res();
  await handler({ body: { event_name: 'x', file_name: '' } }, res);
  assert.deepEqual(pool.calls[0].params.slice(0, 2), ['x', null]);   // '' -> null; timestamps appended after
  const res2 = mock_res();
  await handler({ body: { not_allowed: 1 } }, res2);
  assert.equal(pool.calls.length, 1);
  assert.equal(res2.code, 204);
});

test('a DB failure never throws — still 204', async () => {
  const pool = { query: async function () { throw new Error('db down'); } };
  const handler = make_event_ingest({ pool: pool, table: 't', columns: ['event_name'] });
  const res = mock_res();
  await handler({ body: { event_name: 'x' } }, res);
  assert.equal(res.code, 204);
});
});
