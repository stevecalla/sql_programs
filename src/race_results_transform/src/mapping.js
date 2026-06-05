/**
 * mapping.js — editable mapping helpers + saved profiles.
 *
 * A "profile" remembers, for a given source layout (keyed by a header
 * signature), the chosen column mapping (by header TEXT, so it survives
 * column reordering) and any value-overrides. Next time the same layout is
 * uploaded the profile auto-applies.
 *
 * Storage is injectable: the browser passes window.localStorage; Node tests
 * pass nothing and get an in-memory store.
 *
 * Pure-ish + isomorphic. Depends on schema.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./schema'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.mapping = factory(root.RRT.schema);
  }
}(typeof self !== 'undefined' ? self : this, function (schema) {
  'use strict';

  var STORE_KEY = 'rrt_profiles_v1';

  function header_signature(headers) {
    var norm = headers.map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
    norm.sort();
    var s = norm.join('|');
    // small stable djb2 hash
    var hash = 5381;
    for (var i = 0; i < s.length; i++) { hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0; }
    return 'sig_' + (hash >>> 0).toString(16);
  }

  // mapping (key -> {source, source_index,...}) -> portable {key -> header_text}
  function mapping_to_text(mapping) {
    var out = {};
    Object.keys(mapping).forEach(function (k) {
      out[k] = (mapping[k] && mapping[k].source) ? mapping[k].source : null;
    });
    return out;
  }

  // portable {key -> header_text} + current headers -> mapping object
  function text_to_mapping(text_map, headers) {
    var mapping = {};
    schema.TEMPLATE_SCHEMA.forEach(function (col) {
      var wanted = text_map ? text_map[col.key] : null;
      var idx = wanted ? headers.findIndex(function (h) { return String(h).trim() === String(wanted).trim(); }) : -1;
      mapping[col.key] = idx >= 0
        ? { source: headers[idx], source_index: idx, score: 100, confidence: 'saved' }
        : { source: null, source_index: -1, score: 0, confidence: 'none' };
    });
    return mapping;
  }

  // Manually set/clear one target's source header (used by the UI dropdowns).
  function set_mapping(mapping, key, header_text, headers) {
    var idx = header_text ? headers.findIndex(function (h) { return String(h).trim() === String(header_text).trim(); }) : -1;
    mapping[key] = idx >= 0
      ? { source: headers[idx], source_index: idx, score: 100, confidence: 'manual' }
      : { source: null, source_index: -1, score: 0, confidence: 'none' };
    return mapping;
  }

  // ---- profile store -------------------------------------------------------
  function make_store(backing) {
    var mem = {};
    var ls = backing || null;
    function read_all() {
      if (ls) { try { return JSON.parse(ls.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; } }
      return mem;
    }
    function write_all(obj) {
      if (ls) { try { ls.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) {} }
      else mem = obj;
    }
    return {
      list: function () { return read_all(); },
      get: function (sig) { return read_all()[sig] || null; },
      save: function (sig, profile) { var all = read_all(); all[sig] = profile; write_all(all); return profile; },
      remove: function (sig) { var all = read_all(); delete all[sig]; write_all(all); }
    };
  }

  return {
    header_signature: header_signature,
    mapping_to_text: mapping_to_text,
    text_to_mapping: text_to_mapping,
    set_mapping: set_mapping,
    make_store: make_store,
    STORE_KEY: STORE_KEY
  };
}));
