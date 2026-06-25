/**
 * duplicates.js — find rows whose value in a given column repeats (e.g. a Member Number listed more than
 * once). Pure + isomorphic (no DOM), so the cross-row logic is unit-tested; the browser highlights/filters
 * the returned row indices.
 *
 * Comparison is on the (already-normalized) cell value, trimmed to a string — so values that only collide
 * AFTER conversion (USAT-12345 and 12345 both normalize to 12345) group together. Placeholder member values
 * that mean "no member" (blank / 1-day / valid) are never treated as duplicates.
 *
 * UMD: require() in Node, window.RRT.duplicates in the browser (matches view_logic.js / sort.js / split.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.duplicates = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function default_is_placeholder(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '' || s === '1-day' || s === 'valid';
  }

  // rows  : array of row arrays (the converted output grid)
  // col   : the column index to check for repeats (e.g. the Member Number column)
  // opts.is_placeholder(value) : values to ignore (not real members). Defaults to blank / 1-day / valid.
  // Returns:
  //   dup_set     { rowIndex: true } for every row whose value repeats (for highlight + filter)
  //   row_count   total number of duplicate rows (the headline number)
  //   group_count number of distinct values that repeat
  //   groups      { value: [rowIndex, ...] } for each repeated value (in first-seen order)
  function find_duplicates(rows, col, opts) {
    opts = opts || {};
    var is_placeholder = opts.is_placeholder || default_is_placeholder;
    rows = rows || [];

    var by_value = {};   // trimmed string value -> [rowIndex, ...]
    var order = [];      // first-seen value order (stable groups)
    for (var i = 0; i < rows.length; i++) {
      var raw = (rows[i] && rows[i].length > col) ? rows[i][col] : '';
      if (is_placeholder(raw)) continue;
      var key = String(raw == null ? '' : raw).trim();
      if (!Object.prototype.hasOwnProperty.call(by_value, key)) { by_value[key] = []; order.push(key); }
      by_value[key].push(i);
    }

    var dup_set = {}, groups = {}, row_count = 0, group_count = 0;
    for (var k = 0; k < order.length; k++) {
      var val = order[k], idxs = by_value[val];
      if (idxs.length < 2) continue;
      groups[val] = idxs.slice();
      group_count++;
      for (var j = 0; j < idxs.length; j++) { dup_set[idxs[j]] = true; row_count++; }
    }

    return { dup_set: dup_set, row_count: row_count, group_count: group_count, groups: groups };
  }

  return { find_duplicates: find_duplicates, default_is_placeholder: default_is_placeholder };
}));
