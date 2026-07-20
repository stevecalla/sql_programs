'use strict';
// Phase 4 — pure pre-flight estimator. Mirrors the engine's 2-losers-per-merge-call batching.
const test = require('node:test');
const assert = require('node:assert');
const est = require('../store/api_estimate');

test('merge_calls_for = max(1, ceil(loser/2))', () => {
  assert.strictEqual(est.merge_calls_for(0), 1);
  assert.strictEqual(est.merge_calls_for(1), 1);
  assert.strictEqual(est.merge_calls_for(2), 1);
  assert.strictEqual(est.merge_calls_for(3), 2);
  assert.strictEqual(est.merge_calls_for(4), 2);
  assert.strictEqual(est.merge_calls_for(5), 3);
});

test('estimate_run_calls sums merge calls + per-set overhead', () => {
  const r = est.estimate_run_calls([{ loser_count: 2 }, { loser_count: 4 }], { overhead_per_set: 3 });
  assert.strictEqual(r.sets, 2);
  assert.strictEqual(r.merge_calls, 3);      // ceil(2/2)=1 + ceil(4/2)=2
  assert.strictEqual(r.total, 9);            // 3 merge + 2 sets * 3 overhead
});

test('estimate adds a stamp call per set when stamp_merged', () => {
  const r = est.estimate_run_calls([{ loser_count: 2 }], { overhead_per_set: 3, stamp_merged: true });
  assert.strictEqual(r.total, 5);            // 1 merge + (3 overhead + 1 stamp)
});

test('empty queue estimates zero', () => {
  const r = est.estimate_run_calls([], {});
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.sets, 0);
});


test('estimate_run_calls includes async-Apex estimate (sets * APEX_PER_SET) + calibrated default', () => {
  const r = est.estimate_run_calls([{ loser_count: 1 }, { loser_count: 3 }], {});
  assert.strictEqual(r.sets, 2);
  assert.strictEqual(r.apex_total, 2 * est.APEX_PER_SET);
  assert.strictEqual(est.APEX_PER_SET, 100);   // recalibrated from the 100-merge run (~74/merge + margin)
});
