/**
 * transform.js — apply a mapping to a parsed table and produce the output grid.
 *
 * For each data row, for each template column (in order), pull the mapped
 * source value, apply any user value-override, else run the normalizer.
 * Collects per-column stats, per-cell review flags, and the set of distinct
 * source values for the enumerated fields (for the value-mapping UI).
 *
 * Pure + isomorphic. Depends on schema.js + normalize.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./schema'), require('./normalize'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.transform = factory(root.RRT.schema, root.RRT.normalize);
  }
}(typeof self !== 'undefined' ? self : this, function (schema, normalize) {
  'use strict';

  // Fields whose values fall into a fixed vocabulary -> exposed in value-mapping UI.
  var ENUM_FIELDS = { gender: true, state: true, category: true, member_number: true };

  function value_key(v) { return normalize.as_text(v).toLowerCase(); }

  /**
   * @param parsed  result of parse.detect_table
   * @param mapping result of match.auto_map (.mapping) — may be user-edited
   * @param opts    { value_overrides: { [key]: { [src_value_lower]: final_string } } }
   */
  function run(parsed, mapping, opts) {
    opts = opts || {};
    var overrides = opts.value_overrides || {};
    var cols = schema.TEMPLATE_SCHEMA;
    var headers = cols.map(function (c) { return c.target; });

    var out_rows = [];
    var stats = {};      // key -> { filled, blank, flagged }
    var flags = [];      // { row, key, code, original }
    var distinct = {};   // key -> { src_lower: { sample, bucket, flag, count } }
    cols.forEach(function (c) {
      stats[c.key] = { filled: 0, blank: 0, flagged: 0 };
      if (ENUM_FIELDS[c.key]) distinct[c.key] = {};
    });

    parsed.data_rows.forEach(function (dr, r_idx) {
      var out_row = [];
      cols.forEach(function (col) {
        var m = mapping[col.key];
        var src_val = (m && m.source_index >= 0) ? dr.cells[m.source_index] : null;
        var ov = overrides[col.key];
        var key = value_key(src_val);
        var result;
        if (ov && Object.prototype.hasOwnProperty.call(ov, key)) {
          result = { value: ov[key], flag: null };
        } else {
          result = normalize.run(col.normalizer, src_val);
        }
        out_row.push(result.value);

        // stats
        if (result.value === '' || result.value === null) stats[col.key].blank++;
        else stats[col.key].filled++;
        if (result.flag) {
          stats[col.key].flagged++;
          flags.push({ row: r_idx, key: col.key, code: result.flag, original: normalize.as_text(src_val) });
        }
        // distinct enum values
        if (ENUM_FIELDS[col.key]) {
          var d = distinct[col.key];
          if (!d[key]) d[key] = { sample: normalize.as_text(src_val), bucket: result.value, flag: result.flag, count: 0 };
          d[key].count++;
        }
      });
      out_rows.push(out_row);
    });

    return {
      headers: headers,
      rows: out_rows,
      stats: stats,
      flags: flags,
      distinct: distinct,
      row_count: out_rows.length,
      mapping: mapping,
      schema: cols
    };
  }

  return { run: run, ENUM_FIELDS: ENUM_FIELDS, value_key: value_key };
}));
