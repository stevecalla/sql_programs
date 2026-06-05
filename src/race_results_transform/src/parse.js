/**
 * parse.js — turn a raw IR ({ sheet_name, rows }) into a clean table:
 * detect the header row, collect data rows, and skip noise rows
 * (blank rows and section/divider rows like file 1's "Alpha Sprint").
 *
 * Pure + isomorphic.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.parse = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function non_empty_count(row) {
    var n = 0;
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')) n++;
    }
    return n;
  }

  function looks_like_header(row) {
    // header cells are mostly short text strings, not dates/numbers
    var strings = 0, total = 0;
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
      total++;
      if (typeof v === 'string') strings++;
    }
    return total >= 2 && strings / total >= 0.7;
  }

  function detect_table(ir) {
    var rows = ir.rows || [];
    // Find header: the row within the first 10 with the most non-empty string
    // cells that also looks like a header.
    var header_idx = 0, best = -1;
    var scan = Math.min(rows.length, 10);
    for (var r = 0; r < scan; r++) {
      if (!looks_like_header(rows[r])) continue;
      var c = non_empty_count(rows[r]);
      if (c > best) { best = c; header_idx = r; }
    }
    var raw_headers = rows[header_idx] || [];
    var headers = raw_headers.map(function (h, i) {
      var t = (h === null || h === undefined) ? '' : String(h).trim();
      return t === '' ? ('Column ' + (i + 1)) : t;
    });
    var width = headers.length;

    var data_rows = [];
    var skipped = [];
    for (var i = header_idx + 1; i < rows.length; i++) {
      var row = rows[i];
      var cells = [];
      for (var c2 = 0; c2 < width; c2++) cells.push(c2 < row.length ? row[c2] : null);
      var ne = non_empty_count(cells);
      if (ne === 0) { skipped.push({ index: i, reason: 'blank', preview: '' }); continue; }
      if (ne <= 1) {
        // section / divider row (e.g. a division name spanning the sheet)
        var preview = cells.find(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; });
        skipped.push({ index: i, reason: 'section-divider', preview: preview ? String(preview).trim() : '' });
        continue;
      }
      data_rows.push({ index: i, cells: cells });
    }

    return {
      header_row_index: header_idx,
      headers: headers,
      data_rows: data_rows,
      skipped: skipped,
      sheet_name: ir.sheet_name || 'Sheet1'
    };
  }

  return { detect_table: detect_table, non_empty_count: non_empty_count };
}));
