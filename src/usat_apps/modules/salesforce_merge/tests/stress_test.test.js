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

test('active_worker_count = distinct pm2 pids among RUNNING rows (not claim tokens)', () => {
  // Two pm2 workers (w28136, w1140); each claim mints a fresh token, but the pid prefix identifies the worker.
  const rows = [
    { status: 'running', claimed_by: 'w28136-mrqxw7ko-3ngie' },
    { status: 'running', claimed_by: 'w1140-mrqxw85j-9po5g' },
    { status: 'done', claimed_by: 'w28136-mrqss4nb-gaxya' },   // finished → not counted
    { status: 'queued', claimed_by: null },                    // not claimed → not counted
  ];
  assert.equal(s.active_worker_count(rows), 2);
  // Same worker holding two running batches counts once.
  assert.equal(s.active_worker_count([
    { status: 'running', claimed_by: 'w1140-aaa-1' },
    { status: 'running', claimed_by: 'w1140-bbb-2' },
  ]), 1);
  assert.equal(s.active_worker_count([]), 0);
  assert.equal(s.active_worker_count(null), 0);
});

test('worker_of extracts the pm2 pid prefix from a claim token', () => {
  assert.equal(s.worker_of({ claimed_by: 'w28136-mrqxw7ko-3ngie' }), 'w28136');
  assert.equal(s.worker_of({ claimed_by: null }), null);
  assert.equal(s.worker_of(null), null);
});

test('work_seconds = claimed_at → finished_at (excludes queue wait), null when incomplete', () => {
  assert.equal(s.work_seconds({ claimed_at: '2026-07-18 22:30:00', finished_at: '2026-07-18 22:31:42' }), 102);
  assert.equal(s.work_seconds({ claimed_at: '2026-07-18 22:30:00' }), null);   // no finish
  assert.equal(s.work_seconds({ finished_at: '2026-07-18 22:31:42' }), null);  // no claim
  assert.equal(s.work_seconds({ claimed_at: '2026-07-18 22:31:42', finished_at: '2026-07-18 22:30:00' }), null); // negative → null
});

test('format_worker_balance rolls batches/sets/time up per worker', () => {
  const runs = [
    { worker: 'w28136', batch: 2, bsec: 60 },
    { worker: 'w28136', batch: 2, bsec: 42 },
    { worker: 'w1140', batch: 2, bsec: 68 },
  ];
  const line = s.format_worker_balance(runs);
  assert.match(line, /w28136 2 batch\(es\)\/4 set\(s\)\/00:01:42/);
  assert.match(line, /w1140 1 batch\(es\)\/2 set\(s\)\/00:01:08/);
  assert.equal(s.format_worker_balance([]), 'worker split: (none)');
});

test('median_sec_per_merge = median of (batch time ÷ set count), concurrency-proof', () => {
  // batches of 2 sets each taking 70/72/68s → per-merge 35/36/34 → median 35
  assert.equal(s.median_sec_per_merge([
    { bsec: 70, batch: 2 }, { bsec: 72, batch: 2 }, { bsec: 68, batch: 2 },
  ]), 35);
  // even count → average of the two middles: rates 30,34,36,40 → (34+36)/2 = 35
  assert.equal(s.median_sec_per_merge([
    { bsec: 60, batch: 2 }, { bsec: 68, batch: 2 }, { bsec: 72, batch: 2 }, { bsec: 80, batch: 2 },
  ]), 35);
  assert.equal(s.median_sec_per_merge([{ batch: 2 }]), null); // no timing
  assert.equal(s.median_sec_per_merge([]), null);
});
