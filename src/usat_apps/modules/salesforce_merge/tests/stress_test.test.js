'use strict';
// Pure helpers for the merge stress-test harness: size distribution + seeded random sampling.
//   node --test src/usat_apps/modules/salesforce_merge/tests/stress_test.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../stress_test');

test('build_distribution: pct, cumulative, totals, min/max, p95', () => {
  const d = s.build_distribution([{ size: 2, n: 90 }, { size: 3, n: 8 }, { size: 16, n: 2 }]);
  assert.equal(d.total, 100);
  assert.equal(d.records, 2 * 90 + 3 * 8 + 16 * 2);   // 180 + 24 + 32 = 236
  assert.equal(d.min, 2);
  assert.equal(d.max, 16);
  assert.equal(d.rows[0].pct, 90);
  assert.equal(d.rows[0].cum_pct, 90);
  assert.equal(d.rows[1].cum_pct, 98);
  assert.equal(d.p95, 3);                              // 95% of clusters are size <= 3 (the 16s are the tail)
});

test('build_distribution: ignores junk rows and sorts by size', () => {
  const d = s.build_distribution([{ size: 4, n: 1 }, { size: 0, n: 5 }, { size: 2, n: 3 }, { size: 3, n: 0 }]);
  assert.deepEqual(d.rows.map((r) => r.size), [2, 4]);
  assert.equal(d.total, 4);
});

test('format_distribution renders sizes + a total line', () => {
  const out = s.format_distribution(s.build_distribution([{ size: 2, n: 10 }, { size: 5, n: 2 }]));
  assert.match(out, /size/);
  assert.match(out, /total: 12 clusters/);
  assert.match(out, /95% are size <= /);
});

test('in_size_range respects optional bounds', () => {
  assert.equal(s.in_size_range(3, 2, 5), true);
  assert.equal(s.in_size_range(6, 2, 5), false);
  assert.equal(s.in_size_range(1, 2, 5), false);
  assert.equal(s.in_size_range(9, null, null), true);   // no bounds -> all pass
  assert.equal(s.in_size_range(9, 2, null), true);       // only a min
});

test('sample is deterministic per seed, respects count, and reshuffles on a new seed', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const a = s.sample(items, 10, 42);
  const b = s.sample(items, 10, 42);
  const c = s.sample(items, 10, 43);
  assert.equal(a.length, 10);
  assert.deepEqual(a, b);                 // same seed -> identical pick (reproducible run)
  assert.notDeepEqual(a, c);              // different seed -> different pick
  assert.equal(new Set(a).size, 10);      // no duplicates
});

test('resolve_env defaults to sandbox; --env production / --prod switch it', () => {
  assert.equal(s.resolve_env([]), 'sandbox');
  assert.equal(s.resolve_env(['--env', 'sandbox']), 'sandbox');
  assert.equal(s.resolve_env(['--env', 'production']), 'production');
  assert.equal(s.resolve_env(['--env', 'prod']), 'production');
  assert.equal(s.resolve_env(['--prod']), 'production');
});

test('normalize_env maps snapshot env values to sandbox|production', () => {
  assert.equal(s.normalize_env('test'), 'sandbox');
  assert.equal(s.normalize_env('sandbox'), 'sandbox');
  assert.equal(s.normalize_env('prod'), 'production');
  assert.equal(s.normalize_env('production'), 'production');
  assert.equal(s.normalize_env(''), 'sandbox');
});

test('plan_batches splits ids into batches of size (last is the remainder)', () => {
  assert.deepEqual(s.plan_batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(s.plan_batches([], 3), []);
  assert.deepEqual(s.plan_batches([1, 2], 0), [[1], [2]]);   // size clamps to >= 1
});

test('summarize rolls outcomes into totals + throughput', () => {
  const d = s.summarize([{ outcome: 'done' }, { outcome: 'failed' }, { outcome: 'held' }, { outcome: 'done' }], 6000);
  assert.equal(d.total, 4);
  assert.equal(d.done, 2);
  assert.equal(d.failed, 1);
  assert.equal(d.held, 1);
  assert.equal(d.seconds, 6);
  assert.equal(d.per_min, 40);   // 4 sets / 6s * 60
});

test('format_selection lists survivor + loser count + cluster, caps with a "more" line', () => {
  const es = [{ survivor_name: 'A', survivor_account: '001a', loser_accounts: '001x;001y', source_key: 'K1' }];
  const out = s.format_selection(es);
  assert.match(out, /A · survivor 001a · 2 loser\(s\) · K1/);
  const many = Array.from({ length: 30 }, (_, i) => ({ survivor_name: 'n' + i, survivor_account: 'a' + i, loser_accounts: ['x'], source_key: 'k' + i }));
  assert.match(s.format_selection(many, 25), /and 5 more/);
});

test('fmt_hms formats seconds as hh:mm:ss', () => {
  assert.equal(s.fmt_hms(0), '00:00:00');
  assert.equal(s.fmt_hms(329), '00:05:29');
  assert.equal(s.fmt_hms(3661), '01:01:01');
});
