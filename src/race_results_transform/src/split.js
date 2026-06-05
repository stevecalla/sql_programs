/**
 * split.js — group row indices by a per-row key, for "split & download by column".
 *
 * group_by_key(keys) takes an array of string keys (one per row; null/blank allowed)
 * and returns the distinct groups in first-appearance order:
 *
 *   [ { value: 'Elite', count: 12, indices: [0, 3, 9, ...] }, ... ]
 *
 * Blank / null / whitespace-only keys collapse into a single group whose value is ''
 * (the UI shows it as "(blank)").
 *
 * merge_named(entries) supports manual grouping: combine [{ name, indices }] entries
 * that share a (trimmed, non-blank) name into [{ value: name, indices }].
 *
 * Pure + isomorphic; no DOM, no dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.split = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function norm_key(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function group_by_key(keys) {
    var order = [], by = {};
    for (var i = 0; i < keys.length; i++) {
      var k = norm_key(keys[i]);
      if (!Object.prototype.hasOwnProperty.call(by, k)) { by[k] = { value: k, count: 0, indices: [] }; order.push(k); }
      by[k].count++;
      by[k].indices.push(i);
    }
    return order.map(function (k) { return by[k]; });
  }

  function merge_named(entries) {
    var order = [], by = {};
    for (var i = 0; i < entries.length; i++) {
      var name = norm_key(entries[i].name);
      if (name === '') continue;
      if (!Object.prototype.hasOwnProperty.call(by, name)) { by[name] = { value: name, indices: [] }; order.push(name); }
      by[name].indices = by[name].indices.concat(entries[i].indices || []);
    }
    return order.map(function (n) { return by[n]; });
  }

  return { group_by_key: group_by_key, merge_named: merge_named, norm_key: norm_key };
}));
