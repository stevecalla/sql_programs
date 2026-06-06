'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/view_logic');

const ct = function (v) { return v == null ? '' : String(v); };   // stand-in for display.cell_text

describe('view_logic', () => {
  test('row_text lowercases and separates cells (no cross-cell matches)', () => {
    const t = view.row_text(['John', 'Smith'], ct);
    assert.equal(t, 'john' + view.SEP + 'smith' + view.SEP);
    assert.ok(t.indexOf('johnsmith') < 0, 'cells must not run together');
  });

  test('build_search_index returns one lowercased string per row', () => {
    const idx = view.build_search_index([['A', 1], ['b', 2]], ct);
    assert.equal(idx.length, 2);
    assert.equal(idx[0], 'a' + view.SEP + '1' + view.SEP);
  });

  test('visible_indices filters by query (case-insensitive) within current order', () => {
    const rows = [['John', 'Smith'], ['jane', 'DOE'], ['Al', 'Roe']];
    const idx = view.build_search_index(rows, ct);
    assert.deepEqual(view.visible_indices([0, 1, 2], '', idx, null), [0, 1, 2]);
    assert.deepEqual(view.visible_indices([0, 1, 2], 'doe', idx, null), [1]);
    assert.deepEqual(view.visible_indices([0, 1, 2], 'zzz', idx, null), []);
  });

  test('visible_indices honours the order array and a filter set', () => {
    const idx = view.build_search_index([['a'], ['b'], ['c']], ct);
    assert.deepEqual(view.visible_indices([2, 0, 1], '', idx, null), [2, 0, 1]); // order preserved
    assert.deepEqual(view.visible_indices([0, 1, 2], '', idx, { 1: true }), [1]); // only whitelisted
    assert.deepEqual(view.visible_indices([0, 1, 2], 'b', idx, { 0: true }), []); // filter + query intersect
  });

  test('page_limit caps unless show_all', () => {
    assert.equal(view.page_limit(10, 5, false), 5);
    assert.equal(view.page_limit(3, 5, false), 3);
    assert.equal(view.page_limit(10, 5, true), 10);
  });
});
