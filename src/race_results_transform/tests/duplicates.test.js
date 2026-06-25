'use strict';
// duplicates.js — cross-row duplicate detection (e.g. a Member Number listed more than once). Pure, no DOM.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const dup = require('../src/duplicates');

// rows: [ member, name ] — col 0 is the member number
function rows_of() { return Array.prototype.slice.call(arguments); }

describe('duplicates.find_duplicates', () => {
  test('flags every row of a repeated value; leaves singletons alone', () => {
    const rows = rows_of(['101', 'A'], ['202', 'B'], ['101', 'C'], ['303', 'D']);
    const r = dup.find_duplicates(rows, 0);
    assert.equal(r.row_count, 2, 'two rows share member 101');
    assert.equal(r.group_count, 1, 'one repeated value');
    assert.deepEqual(Object.keys(r.dup_set).map(Number).sort(function (a, b) { return a - b; }), [0, 2]);
    assert.deepEqual(r.groups['101'], [0, 2]);
    assert.ok(!r.dup_set[1] && !r.dup_set[3], 'singletons are not duplicates');
  });

  test('placeholders (blank / 1-day / valid) are never duplicates', () => {
    const rows = rows_of(['1-day', 'A'], ['', 'B'], ['1-day', 'C'], ['Valid', 'D'], ['', 'E']);
    const r = dup.find_duplicates(rows, 0);
    assert.equal(r.row_count, 0, 'no real member numbers repeat');
    assert.equal(r.group_count, 0);
  });

  test('compares the trimmed normalized value (so equal-after-normalize collide)', () => {
    const rows = rows_of(['12345', 'A'], [' 12345', 'B'], ['12345 ', 'C']);
    const r = dup.find_duplicates(rows, 0);
    assert.equal(r.row_count, 3, 'all three are the same trimmed member');
    assert.equal(r.group_count, 1);
  });

  test('multiple independent duplicate groups + a custom column', () => {
    const rows = rows_of(['x', '7'], ['y', '7'], ['z', '9'], ['w', '7']);  // col 1 repeats: 7 (x3)
    const r = dup.find_duplicates(rows, 1);
    assert.equal(r.row_count, 3);
    assert.equal(r.group_count, 1);
    assert.deepEqual(r.groups['7'], [0, 1, 3]);
  });

  test('empty / out-of-range is safe', () => {
    assert.equal(dup.find_duplicates([], 0).row_count, 0);
    assert.equal(dup.find_duplicates(rows_of(['a'], ['a']), 5).row_count, 0, 'missing column -> blank -> placeholder');
  });

  test('a custom is_placeholder predicate is honored', () => {
    const rows = rows_of(['SKIP', 'A'], ['SKIP', 'B'], ['5', 'C'], ['5', 'D']);
    const r = dup.find_duplicates(rows, 0, { is_placeholder: function (v) { return String(v).trim() === 'SKIP'; } });
    assert.equal(r.row_count, 2, 'only the 5s count');
    assert.deepEqual(r.groups['5'], [2, 3]);
  });
});
