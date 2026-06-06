'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const split = require('../src/split');

describe('split', () => {
test('groups in first-appearance order with counts and indices', () => {
  const g = split.group_by_key(['Elite', 'Age Group', 'Elite', 'Open', 'Age Group', 'Elite']);
  assert.deepEqual(g.map((x) => x.value), ['Elite', 'Age Group', 'Open']);
  assert.deepEqual(g.map((x) => x.count), [3, 2, 1]);
  assert.deepEqual(g[0].indices, [0, 2, 5]);
  assert.deepEqual(g[1].indices, [1, 4]);
});

test('blank / null / whitespace collapse into one empty-value group', () => {
  const g = split.group_by_key(['A', '', null, '   ', 'A']);
  assert.deepEqual(g.map((x) => x.value), ['A', '']);
  assert.equal(g[1].count, 3);
  assert.deepEqual(g[1].indices, [1, 2, 3]);
});

test('keys are trimmed so spacing does not split a group', () => {
  const g = split.group_by_key([' Open', 'Open ', 'Open']);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 3);
});

test('every row lands in exactly one group', () => {
  const keys = ['x', 'y', 'x', 'z', 'y', '', 'x'];
  const g = split.group_by_key(keys);
  const total = g.reduce((n, x) => n + x.indices.length, 0);
  assert.equal(total, keys.length);
});

test('merge_named combines entries that share a group name (first-appearance order)', () => {
  const out = split.merge_named([
    { name: 'Sprint', indices: [0, 1] },
    { name: 'Olympic', indices: [2] },
    { name: 'Sprint', indices: [5] },
    { name: 'Olympic', indices: [7, 8] }
  ]);
  assert.deepEqual(out.map((g) => g.value), ['Sprint', 'Olympic']);
  assert.deepEqual(out[0].indices, [0, 1, 5]);
  assert.deepEqual(out[1].indices, [2, 7, 8]);
});

test('merge_named trims names and skips blank group names', () => {
  const out = split.merge_named([
    { name: ' A ', indices: [0] },
    { name: 'A', indices: [1] },
    { name: '', indices: [2] },
    { name: '   ', indices: [3] }
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].indices, [0, 1]);
});
});
