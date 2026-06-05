'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sort = require('../src/sort');

function ordered(arr) { return arr.slice().sort(sort.compare_text); }

test('sort is case-insensitive (caps do not cluster first)', () => {
  assert.deepEqual(
    ordered(['Zebra', 'alice', 'Bob', 'apple', 'Banana']),
    ['alice', 'apple', 'Banana', 'Bob', 'Zebra']
  );
});

test('equal-but-different-case values tie (stable neighbours)', () => {
  assert.equal(sort.compare_text('alice', 'Alice'), 0);
  assert.equal(sort.compare_text('NV', 'nv'), 0);
});

test('plain numbers compare numerically, not lexically', () => {
  assert.ok(sort.compare_text('9', '10') < 0);          // 9 before 10
  assert.ok(sort.compare_text('100', '20') > 0);
  assert.deepEqual(ordered(['10', '2', '1', '20']), ['1', '2', '10', '20']);
});

test('embedded numbers sort naturally', () => {
  assert.deepEqual(
    ordered(['Wave 10', 'Wave 2', 'Wave 1']),
    ['Wave 1', 'Wave 2', 'Wave 10']
  );
});

test('blanks and null sort to the top, no throw', () => {
  assert.equal(sort.compare_text(null, ''), 0);
  assert.ok(sort.compare_text('', 'anything') < 0);
});
