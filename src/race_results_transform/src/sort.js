/**
 * sort.js — table-sort comparator, shared by the browser UI and the tests.
 *
 * `compare_text` orders two already-textified cell strings:
 *   - both look like plain numbers  -> numeric order ("9" before "10")
 *   - otherwise                     -> localeCompare with sensitivity 'base'
 *                                      (case- and accent-insensitive) and
 *                                      numeric:true (natural number ordering),
 *                                      so "alice" and "Alice" sort together.
 *
 * Pure + isomorphic; no DOM, no dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.sort = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NUMERIC = /^-?\d+(\.\d+)?$/;

  function compare_text(va, vb) {
    va = va == null ? '' : String(va);
    vb = vb == null ? '' : String(vb);
    if (NUMERIC.test(va) && NUMERIC.test(vb)) return parseFloat(va) - parseFloat(vb);
    return va.localeCompare(vb, undefined, { sensitivity: 'base', numeric: true });
  }

  return { compare_text: compare_text, NUMERIC: NUMERIC };
}));
