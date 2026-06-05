/**
 * match.js — auto-map source headers to template columns.
 *
 * Scoring (per target/header pair):
 *   100  exact alias / target match
 *    82  one string startsWith the other
 *    64  one contains the other
 *   0-48 token-overlap (Jaccard * 48)
 * A tiny penalty for later-listed aliases breaks ties toward the more
 * canonical alias. Greedy assignment: highest-scoring pairs win first; each
 * source header is used at most once. The finish-time column is matched
 * specially so split columns (Leg/Bike/Swim/T1/T2) can never become
 * "Recorded Time".
 *
 * Pure + isomorphic. Depends on schema.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./schema'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.match = factory(root.RRT.schema);
  }
}(typeof self !== 'undefined' ? self : this, function (schema) {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function tokens(s) { return norm(s).split(' ').filter(Boolean); }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var set_b = {}; b.forEach(function (t) { set_b[t] = true; });
    var inter = 0, seen = {};
    a.forEach(function (t) { if (set_b[t] && !seen[t]) { inter++; seen[t] = true; } });
    var union = {}; a.concat(b).forEach(function (t) { union[t] = true; });
    return inter / Object.keys(union).length;
  }

  function pair_score(header_norm, header_tokens, alias_norm) {
    if (!header_norm || !alias_norm) return 0;
    if (header_norm === alias_norm) return 100;
    // header begins with alias (header is the more specific string)
    if (header_norm.indexOf(alias_norm) === 0) return 82;
    // alias begins with header — only trust it for headers >= 4 chars, so a
    // bare "Age" can't latch onto the "age group" alias and steal Category.
    if (alias_norm.indexOf(header_norm) === 0 && header_norm.length >= 4) return 80;
    // substring either way, but require the shorter string be >= 4 chars
    if ((header_norm.indexOf(alias_norm) >= 0 || alias_norm.indexOf(header_norm) >= 0)
        && Math.min(header_norm.length, alias_norm.length) >= 4) return 64;
    return Math.round(jaccard(header_tokens, tokens(alias_norm)) * 48);
  }

  function best_score_for_target(col, header_norm, header_tokens) {
    var best = 0;
    var aliases = col.aliases.concat([norm(col.target)]);
    for (var i = 0; i < aliases.length; i++) {
      // Tiny penalty for later-listed aliases so that, on a tie, the earlier
      // (more canonical) alias wins. e.g. "Age Group" beats "Race / Division"
      // for the Category target.
      var sc = pair_score(header_norm, header_tokens, norm(aliases[i])) - i * 0.1;
      if (sc > best) best = sc;
    }
    return best;
  }

  function is_split(header_norm) {
    for (var i = 0; i < schema.SPLIT_KEYWORDS.length; i++) {
      if (header_norm.indexOf(norm(schema.SPLIT_KEYWORDS[i])) >= 0) return true;
    }
    return false;
  }
  function total_time_bonus(header_norm) {
    for (var i = 0; i < schema.TOTAL_TIME_TOKENS.length; i++) {
      if (header_norm.indexOf(schema.TOTAL_TIME_TOKENS[i]) >= 0) return true;
    }
    return false;
  }

  var THRESHOLD = 55;

  function confidence(score) { return score >= 82 ? 'high' : (score >= 64 ? 'medium' : 'low'); }

  function auto_map(headers) {
    var h_info = headers.map(function (h, i) {
      var n = norm(h);
      return { header: h, index: i, n: n, tokens: tokens(h), used: false, split: is_split(n) };
    });

    var pairs = [];
    schema.TEMPLATE_SCHEMA.forEach(function (col) {
      h_info.forEach(function (h) {
        if (col.is_time_total && h.split) return;
        var sc = best_score_for_target(col, h.n, h.tokens);
        if (col.is_time_total && total_time_bonus(h.n)) sc = Math.min(100, sc + 30);
        if (sc >= THRESHOLD) pairs.push({ key: col.key, h_index: h.index, score: sc });
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score; });

    var mapping = {};
    schema.TEMPLATE_SCHEMA.forEach(function (col) {
      mapping[col.key] = { source: null, source_index: -1, score: 0, confidence: 'none' };
    });

    pairs.forEach(function (p) {
      if (mapping[p.key].source !== null) return;
      if (h_info[p.h_index].used) return;
      mapping[p.key] = {
        source: h_info[p.h_index].header, source_index: p.h_index,
        score: Math.round(p.score), confidence: confidence(p.score)
      };
      h_info[p.h_index].used = true;
    });

    var unused = h_info.filter(function (h) { return !h.used; }).map(function (h) {
      return { header: h.header, index: h.index, reason: h.split ? 'split-time' : 'not-in-template' };
    });

    return { mapping: mapping, unused: unused };
  }

  return { auto_map: auto_map, norm: norm, pair_score: pair_score, is_split: is_split, THRESHOLD: THRESHOLD };
}));
