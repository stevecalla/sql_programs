'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { plan_job, make_job_id, should_parallelize } = require('../store/chunk');

test('plan_job splits into contiguous chunks of <= size, order preserved', () => {
  assert.deepStrictEqual(plan_job([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(plan_job([1, 2, 3, 4, 5, 6], 3), [[1, 2, 3], [4, 5, 6]]);
});

test('plan_job returns a single chunk when ids <= size (non-parallel path)', () => {
  assert.deepStrictEqual(plan_job([1, 2], 5), [[1, 2]]);
  assert.deepStrictEqual(plan_job([1, 2, 3], 3), [[1, 2, 3]]);
});

test('plan_job handles empty / bad size', () => {
  assert.deepStrictEqual(plan_job([], 5), []);
  assert.deepStrictEqual(plan_job(null, 5), []);
  assert.deepStrictEqual(plan_job([1, 2, 3], 0), [[1], [2], [3]]); // size floors to 1
});

test('plan_job drops null ids', () => {
  assert.deepStrictEqual(plan_job([1, null, 2, undefined, 3], 2), [[1, 2], [3]]);
});

test('make_job_id is prefixed + unique-ish', () => {
  const a = make_job_id(); const b = make_job_id();
  assert.match(a, /^job-/);
  assert.notStrictEqual(a, b);
});

test('should_parallelize only when enabled AND more than one chunk', () => {
  assert.equal(should_parallelize(10, 5, true), true);   // 10 sets, chunk 5 → 2 chunks
  assert.equal(should_parallelize(5, 5, true), false);   // exactly one chunk
  assert.equal(should_parallelize(3, 5, true), false);   // fewer than a chunk
  assert.equal(should_parallelize(10, 5, false), false); // disabled → never
});
