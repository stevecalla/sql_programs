/**
 * csv_sniff.js — figure out how a CSV is actually delimited, and detect the "CSV of a CSV" double-encoding
 * where each row was written as ONE quoted field of an inner delimited string (semicolon exports re-saved as
 * a comma-CSV). Pure + isomorphic (no DOM, no ExcelJS); io.js uses it to parse a CSV into the right columns.
 *
 * UMD: require() in Node, window.RRT.csv_sniff in the browser (matches sort.js / view_logic.js / duplicates.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.csv_sniff = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DELIMS = [',', ';', '\t', '|'];
  var NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
  function delim_name(d) { return NAMES[d] || 'custom'; }

  // Quote-aware count of the fields one line would split into for a given delimiter ("" escapes a quote;
  // a delimiter inside "..." is literal).
  function count_fields(line, delim) {
    var n = 1, in_q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (in_q && line[i + 1] === '"') { i++; continue; } in_q = !in_q; continue; }
      if (!in_q && ch === delim) n++;
    }
    return n;
  }

  function non_empty_lines(text) {
    return String(text == null ? '' : text).replace(/^﻿/, '').split(/\r\n|\n|\r/)
      .filter(function (l) { return l !== ''; });
  }
  function modal(nums) {
    var seen = {}, best = nums[0], best_n = 0;
    nums.forEach(function (v) { seen[v] = (seen[v] || 0) + 1; if (seen[v] > best_n) { best_n = seen[v]; best = v; } });
    return best;
  }

  // Best delimiter for `text`: the one that splits the first lines into the most fields, most consistently.
  // Ties (and "nothing splits") fall back to comma, so ordinary comma CSVs are never disturbed.
  function sniff_delimiter(text, delims) {
    delims = delims || DELIMS;
    var lines = non_empty_lines(text).slice(0, 25);
    if (!lines.length) return ',';
    var best = ',', best_score = -1;
    delims.forEach(function (d) {
      var counts = lines.map(function (l) { return count_fields(l, d); });
      var m = modal(counts);
      if (m < 2) return;   // this delimiter doesn't actually split anything
      var consistency = counts.filter(function (c) { return c === m; }).length / counts.length;
      var score = m + consistency;   // field count dominates; consistency breaks ties
      if (score > best_score || (score === best_score && d === ',')) { best_score = score; best = d; }
    });
    return best;
  }

  // Given rows from a FIRST (outer) parse, decide whether the file is double-encoded: nearly every row is a
  // single cell whose content itself splits consistently (>=3 fields) on some delimiter. Returns that inner
  // delimiter to re-parse with, or null (so a legitimately single-column CSV — a plain list — is left alone).
  function looks_double_encoded(rows, delims) {
    if (!rows || rows.length < 2) return null;
    var singles = rows.filter(function (r) { return r.length === 1 && typeof r[0] === 'string' && r[0] !== ''; });
    if (singles.length < rows.length * 0.8) return null;   // most rows must be a single field
    var cells = singles.map(function (r) { return r[0]; });
    var d = sniff_delimiter(cells.join('\n'), delims);
    var counts = cells.slice(0, 25).map(function (c) { return count_fields(c, d); });
    var m = modal(counts);
    var consistency = counts.filter(function (c) { return c === m; }).length / counts.length;
    return (m >= 3 && consistency >= 0.8) ? d : null;
  }

  return {
    DELIMS: DELIMS, delim_name: delim_name, count_fields: count_fields,
    sniff_delimiter: sniff_delimiter, looks_double_encoded: looks_double_encoded
  };
}));
