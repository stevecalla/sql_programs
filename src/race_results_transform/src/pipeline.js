/**
 * pipeline.js — convenience wiring of the whole engine, used by the CLI,
 * the tests, and (optionally) the web app.
 *
 *   convert(ir, opts) -> { parsed, mapping, result, report }
 *
 * opts:
 *   mapping_override_text  portable {key->header_text} to force a mapping
 *   value_overrides       {key->{src_lower->final_string}}
 *
 * Pure + isomorphic. Wires schema/parse/match/transform/reconcile/mapping.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./parse'), require('./match'), require('./transform'),
      require('./reconcile'), require('./mapping')
    );
  } else {
    root.RRT = root.RRT || {};
    root.RRT.pipeline = factory(
      root.RRT.parse, root.RRT.match, root.RRT.transform,
      root.RRT.reconcile, root.RRT.mapping
    );
  }
}(typeof self !== 'undefined' ? self : this, function (parse, match, transform, reconcile, mapping) {
  'use strict';

  function convert(ir, opts) {
    opts = opts || {};
    var parsed = parse.detect_table(ir);
    var map;
    if (opts.mapping_override_text) {
      map = mapping.text_to_mapping(opts.mapping_override_text, parsed.headers);
    } else {
      map = match.auto_map(parsed.headers).mapping;
    }
    var result = transform.run(parsed, map, { value_overrides: opts.value_overrides });
    var report = reconcile.build(parsed, map, result);
    return { parsed: parsed, mapping: map, result: result, report: report };
  }

  return { convert: convert };
}));
