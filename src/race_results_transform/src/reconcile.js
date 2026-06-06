/**
 * reconcile.js — integrity readout + transformation scorecard.
 *
 * Proves nothing was silently lost: every source column is accounted for
 * (mapped / dropped-split / dropped-not-template), the row count ties out,
 * and pass-through fields (Name/Email/Zip) are checksum-compared in vs out.
 * Also computes the per-column status list and the overall success score.
 *
 * Pure + isomorphic. Depends on schema.js + match.js + normalize.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./schema'), require('./match'), require('./normalize'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.reconcile = factory(root.RRT.schema, root.RRT.match, root.RRT.normalize);
  }
}(typeof self !== 'undefined' ? self : this, function (schema, match, normalize) {
  'use strict';

  // ---- column ledger: where did every source header go? --------------------
  function column_ledger(parsed, mapping) {
    var used_by = {}; // source_index -> target_key
    Object.keys(mapping).forEach(function (k) {
      var m = mapping[k];
      if (m && m.source_index >= 0) used_by[m.source_index] = k;
    });
    return parsed.headers.map(function (h, i) {
      if (used_by[i] !== undefined) {
        var col = schema.by_key(used_by[i]);
        return { header: h, disposition: 'mapped', target: col ? col.target : used_by[i] };
      }
      var n = match.norm(h);
      return { header: h, disposition: match.is_split(n) ? 'dropped-split' : 'dropped-not-template', target: null };
    });
  }

  // ---- pass-through preservation check -------------------------------------
  // For columns that should carry values through unchanged, the multiset of
  // non-blank source values must equal the multiset of output values.
  var PASSTHROUGH = ['last_name', 'first_name', 'email', 'zip'];

  function multiset(arr) {
    var m = {};
    arr.forEach(function (v) { var k = normalize.as_text(v); if (k === '') return; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function diff_multiset(a, b) {
    var missing = 0, keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = true; });
    Object.keys(b).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var d = (a[k] || 0) - (b[k] || 0);
      if (d > 0) missing += d;
    });
    return missing;
  }

  function preservation(parsed, mapping, result) {
    var out = [];
    PASSTHROUGH.forEach(function (key) {
      var m = mapping[key];
      if (!m || m.source_index < 0) { out.push({ key: key, mapped: false }); return; }
      if (m.split) { out.push({ key: key, target: schema.by_key(key).target, mapped: true, split: true, ok: true, missing: 0 }); return; }
      var col = schema.by_key(key);
      var col_idx = result.headers.indexOf(col.target);
      var src_vals = parsed.data_rows.map(function (dr) { return dr.cells[m.source_index]; });
      var out_vals = result.rows.map(function (r) { return r[col_idx]; });
      var miss = diff_multiset(multiset(src_vals), multiset(out_vals));
      out.push({ key: key, target: col.target, mapped: true, source_count: Object.keys(multiset(src_vals)).length, missing: miss, ok: miss === 0 });
    });
    return out;
  }

  // ---- per-column scorecard ------------------------------------------------
  function scorecard(parsed, mapping, result) {
    var per_column = result.schema.map(function (col) {
      var st = result.stats[col.key];
      var m = mapping[col.key];
      var mapped = m && m.source_index >= 0;
      var total = result.row_count;
      var status;
      if (!mapped && col.normalizer !== 'member' && col.normalizer !== 'category') {
        // no source and no defaulting rule -> empty column
        status = st.filled > 0 ? 'partial' : 'missing';
      } else if (st.flagged > 0) {
        status = 'review';
      } else if (st.blank > 0 && col.required) {
        status = 'partial';
      } else if (st.filled === total && total > 0) {
        status = 'complete';
      } else if (st.filled > 0) {
        status = 'partial';
      } else {
        status = 'missing';
      }
      return {
        key: col.key, target: col.target, required: !!col.required,
        mapped_from: mapped ? m.source : null, confidence: mapped ? m.confidence : 'none',
        filled: st.filled, blank: st.blank, flagged: st.flagged, total: total, status: status
      };
    });

    // overall score = filled required cells / total required cells
    var req_filled = 0, req_total = 0, any_required_missing = false;
    per_column.forEach(function (p) {
      if (!p.required) return;
      req_total += p.total;
      req_filled += p.filled;
      if (p.status === 'missing') any_required_missing = true;
    });
    var pct = req_total === 0 ? 100 : Math.round((req_filled / req_total) * 100);
    var flagged_cols = per_column.filter(function (p) { return p.status === 'review'; }).length;
    var partial_cols = per_column.filter(function (p) { return p.status === 'partial'; }).length;

    var band, verdict;
    if (any_required_missing || pct < 80) {
      band = 'red';
      verdict = any_required_missing ? 'A required column is missing — map it before uploading.' : 'Many required cells are empty.';
    } else if (flagged_cols > 0 || partial_cols > 0 || pct < 100) {
      band = 'amber';
      verdict = 'Usable — review the flagged columns, then upload.';
    } else {
      band = 'green';
      verdict = 'All required columns mapped and complete.';
    }
    return { per_column: per_column, pct: pct, band: band, verdict: verdict,
             flagged_columns: flagged_cols, partial_columns: partial_cols };
  }

  function build(parsed, mapping, result) {
    var ledger = column_ledger(parsed, mapping);
    return {
      rows: { in: parsed.data_rows.length, out: result.row_count, skipped: parsed.skipped },
      ledger: ledger,
      preservation: preservation(parsed, mapping, result),
      scorecard: scorecard(parsed, mapping, result),
      flag_count: result.flags.length
    };
  }

  return { build: build, column_ledger: column_ledger, preservation: preservation, scorecard: scorecard, PASSTHROUGH: PASSTHROUGH };
}));
