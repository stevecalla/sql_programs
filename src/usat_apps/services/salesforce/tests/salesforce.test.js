'use strict';
const test = require('node:test');
const assert = require('node:assert');
const svc = require('../index');

test('exposes connect + generic helpers', function () {
  ['connect', 'run_soql', 'describe_object', 'get_limits', 'parse_limits'].forEach(function (fn) {
    assert.strictEqual(typeof svc[fn], 'function', fn + ' is a function');
  });
});
test('parse_limits reads DailyApiRequests + other limits (no network)', function () {
  const lim = { DailyApiRequests: { Max: 100000, Remaining: 99880 }, DailyBulkV2QueryJobs: { Max: 10000, Remaining: 9998 } };
  const p = svc.parse_limits(lim);
  assert.strictEqual(p.daily.used, 120);
  assert.strictEqual(p.daily.max, 100000);
  assert.strictEqual(p.daily.remaining, 99880);
  assert.strictEqual(p.daily.pct, 0.1);
  assert.ok(p.other.some(function (o) { return o.key === 'DailyBulkV2QueryJobs' && o.used === 2; }));
});
test('parse_limits tolerates missing / garbage', function () {
  assert.strictEqual(svc.parse_limits({}).daily, null);
  assert.deepStrictEqual(svc.parse_limits(null).other, []);
});
