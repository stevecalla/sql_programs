/**
 * view_logic.js — pure (no-DOM) helpers behind the TableView: build a per-row
 * search index, filter rows to the visible set, and compute the render cap.
 *
 * Kept in the isomorphic core so the table's trickiest data logic is unit-tested
 * (the DOM rendering stays in public/js/app.js). `cell_text` is passed in (the
 * browser passes display.cell_text) so this file has no DOM/display dependency.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.view_logic = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEP = '\u0001';   // joins cells so a search can't span a cell boundary

  // One lowercased, separator-joined search string for a row.
  function row_text(row, cell_text) {
    var t = '';
    for (var c = 0; c < row.length; c++) t += cell_text(row[c]) + SEP;
    return t.toLowerCase();
  }

  // A search string per row, in row order.
  function build_search_index(rows, cell_text) {
    return rows.map(function (row) { return row_text(row, cell_text); });
  }

  // Row indices (kept in `order`) that pass the active filter set + search query.
  //   order        : array of row indices in display order
  //   query        : current search text (case-insensitive substring)
  //   search_index : per-row lowercased search strings (build_search_index output)
  //   filter_set   : optional { rowIndex: true } whitelist (e.g. flagged rows)
  //   excluded     : optional { rowIndex: true } blacklist (user-deleted rows — hidden + not downloaded)
  function visible_indices(order, query, search_index, filter_set, excluded) {
    var q = (query == null ? '' : String(query)).toLowerCase(), out = [];
    for (var k = 0; k < order.length; k++) {
      var i = order[k];
      if (excluded && excluded[i]) continue;
      if (filter_set && !filter_set[i]) continue;
      if (q && (search_index[i] || '').indexOf(q) < 0) continue;
      out.push(i);
    }
    return out;
  }

  // How many of the visible rows to actually render (cap unless "show all").
  function page_limit(count, cap, show_all) {
    return show_all ? count : Math.min(count, cap);
  }

  return {
    row_text: row_text, build_search_index: build_search_index,
    visible_indices: visible_indices, page_limit: page_limit, SEP: SEP
  };
}));
