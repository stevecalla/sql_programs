/**
 * sweep.js — Criteria tuning engine (pure, no I/O, no network).
 *
 * Replays the duplicate matching over a SAVED set of records under many different
 * "criteria" (threshold, nickname on/off, which of gender/birthdate/ZIP are
 * required, ZIP trim length, name weighting) so you can compare duplicate counts
 * side by side. The production pipeline (exact.js / fuzzy.js / consolidate.js) is
 * NOT touched — this module has its own parameterized matching loop that reuses
 * the same low-level scoring primitives (similarity_score, nickname equivalence,
 * ZIP trim) so the numbers line up with production at the baseline criteria.
 *
 *   expand_grid(grid)               -> list of labeled criteria profiles
 *   run_profile(records, criteria)  -> counts + edges + clusters for one profile
 *   diff_profiles(a_edges, b_edges) -> added / removed / common matched pairs
 */

'use strict';

const { norm, clean_name, composite_zip_raw } = require('./normalize');
const { similarity_score } = require('./matcher');
const { are_nickname_equivalents } = require('./nicknames');
const { UnionFind } = require('./grouping');

const RULE_FIELD_KEYS = ['gender', 'birthdate', 'zip'];

// Today's production logic, expressed as a criteria object (the baseline).
const BASELINE_CRITERIA = {
    fuzzy_threshold: 90,
    weight_first: 0.45,
    weight_last: 0.55,
    nickname_enabled: true,
    nickname_last_name_min_score: 90,
    zip_trim_len: 5,
    rule_fields: ['gender', 'birthdate', 'zip'],
};

// Variable-length ZIP trim (len 0/null = no trim / full value).
function trim_zip(zip, len) {
    const t = (zip || '').trim();
    if (!len) return t;
    const m = t.match(new RegExp(`^(\\d{${len}})`));
    return m ? m[1] : t;
}

function field_value(row, field, criteria) {
    if (field === 'gender') return norm(row.cfg_Gender_Identity__pc);
    if (field === 'birthdate') return norm(row.PersonBirthdate);
    if (field === 'zip') return norm(trim_zip(composite_zip_raw(row), criteria.zip_trim_len));
    return '';
}

function rule_key(row, criteria) {
    return criteria.rule_fields.map((f) => field_value(row, f, criteria)).join('|');
}

function is_eligible(row, criteria) {
    return criteria.rule_fields.every((f) => field_value(row, f, criteria) !== '');
}

function fields_abbrev(rule_fields) {
    return RULE_FIELD_KEYS.filter((f) => rule_fields.includes(f)).map((f) => f[0]).join('') || 'none';
}

function profile_label(c) {
    return `t${c.fuzzy_threshold}_nick${c.nickname_enabled ? 'ON' : 'OFF'}_z${c.zip_trim_len}_${fields_abbrev(c.rule_fields)}`;
}

function criteria_equal(a, b) {
    return a.fuzzy_threshold === b.fuzzy_threshold
        && a.weight_first === b.weight_first
        && a.weight_last === b.weight_last
        && a.nickname_enabled === b.nickname_enabled
        && a.nickname_last_name_min_score === b.nickname_last_name_min_score
        && a.zip_trim_len === b.zip_trim_len
        && fields_abbrev(a.rule_fields) === fields_abbrev(b.rule_fields);
}

// Expand a grid (each key an array of values) into the cartesian product of
// labeled criteria profiles. Always prepends the baseline (today's logic).
function expand_grid(grid = {}) {
    const axes = {
        fuzzy_threshold: grid.fuzzy_threshold || [BASELINE_CRITERIA.fuzzy_threshold],
        weight_first: grid.weight_first || [BASELINE_CRITERIA.weight_first],
        weight_last: grid.weight_last || [BASELINE_CRITERIA.weight_last],
        nickname_enabled: grid.nickname_enabled || [BASELINE_CRITERIA.nickname_enabled],
        nickname_last_name_min_score: grid.nickname_last_name_min_score || [BASELINE_CRITERIA.nickname_last_name_min_score],
        zip_trim_len: grid.zip_trim_len || [BASELINE_CRITERIA.zip_trim_len],
        rule_fields: grid.rule_fields || [BASELINE_CRITERIA.rule_fields],
    };

    let combos = [{}];
    for (const [key, values] of Object.entries(axes)) {
        const next = [];
        for (const combo of combos) for (const v of values) next.push({ ...combo, [key]: v });
        combos = next;
    }

    const profiles = [];
    const seen = new Set();
    // baseline first
    const base = { ...BASELINE_CRITERIA, label: 'baseline', is_baseline: true };
    profiles.push(base);
    seen.add(profile_label(base));

    for (const c of combos) {
        const label = profile_label(c);
        if (seen.has(label)) continue; // skip the dup of baseline if present
        seen.add(label);
        profiles.push({ ...c, label, is_baseline: false });
    }
    return profiles;
}

// Run one criteria profile over the records. Returns counts, the edge list
// (for diffing), and cluster info.
function run_profile(records, criteria, { namer } = {}) {
    const wF = criteria.weight_first;
    const wL = criteria.weight_last;

    // --- Exact groups: all records grouped by name + the required field values ---
    const exact_map = new Map();
    for (const r of records) {
        const key = `${norm(r.LastName)}|${norm(r.FirstName)}|${rule_key(r, criteria)}`;
        if (!exact_map.has(key)) exact_map.set(key, []);
        exact_map.get(key).push(r.Id);
    }
    const exact_groups = [...exact_map.values()].filter((ids) => ids.length > 1);
    const exact_records = exact_groups.reduce((s, ids) => s + ids.length, 0);

    // --- Candidate blocks for fuzzy/nickname: eligible records only ---
    const blocks = new Map();
    let eligible_records = 0;
    for (const r of records) {
        if (!is_eligible(r, criteria)) continue;
        eligible_records += 1;
        const k = rule_key(r, criteria);
        if (!blocks.has(k)) blocks.set(k, []);
        blocks.get(k).push(r);
    }

    const edges = [];
    for (const ids of exact_groups) {
        for (let k = 1; k < ids.length; k++) edges.push({ a: ids[0], b: ids[k], type: 'exact', spelling: 0, nickname: 0 });
    }

    let fuzzy_pairs = 0;
    let nickname_pairs = 0;
    let nickname_only = 0;   // matched by nickname but NOT by spelling (net-new)
    let nickname_both = 0;   // matched by nickname AND spelling
    let pairs_compared = 0;

    for (const rows of blocks.values()) {
        if (rows.length < 2) continue;
        for (let i = 0; i < rows.length; i++) {
            for (let j = i + 1; j < rows.length; j++) {
                pairs_compared += 1;
                const a = rows[i];
                const b = rows[j];
                const fs = similarity_score(a.FirstName, b.FirstName);
                const ls = similarity_score(a.LastName, b.LastName);
                if (fs === 100 && ls === 100) continue; // exact cleaned name -> belongs to exact
                const combined = Math.round(fs * wF + ls * wL);
                const spelling = combined >= criteria.fuzzy_threshold;
                const last_ok = ls === 100 || ls >= criteria.nickname_last_name_min_score;
                const nick = criteria.nickname_enabled && last_ok && are_nickname_equivalents(a.FirstName, b.FirstName, namer);
                if (!spelling && !nick) continue;
                if (spelling) fuzzy_pairs += 1;
                if (nick) nickname_pairs += 1;
                if (nick && spelling) nickname_both += 1;
                if (nick && !spelling) nickname_only += 1;
                edges.push({ a: a.Id, b: b.Id, type: nick ? 'nickname' : 'fuzzy', spelling: spelling ? 1 : 0, nickname: nick ? 1 : 0 });
            }
        }
    }

    // --- Consolidated clusters: union all edges ---
    const uf = new UnionFind();
    for (const e of edges) uf.union(e.a, e.b);
    const cluster_ids = [...uf.groups().values()].filter((ids) => ids.length > 1);

    // tier per cluster (strongest signal present)
    const tier = { exact: 0, fuzzy: 0, nickname: 0 };
    const root_signals = new Map();
    for (const e of edges) {
        const root = uf.find(e.a);
        const s = root_signals.get(root) || { exact: 0, fuzzy: 0, nick: 0 };
        if (e.type === 'exact') s.exact += 1;
        if (e.spelling === 1) s.fuzzy += 1;
        if (e.nickname === 1) s.nick += 1;
        root_signals.set(root, s);
    }
    for (const ids of cluster_ids) {
        const s = root_signals.get(uf.find(ids[0])) || { exact: 0, fuzzy: 0, nick: 0 };
        if (s.exact > 0) tier.exact += 1;
        else if (s.fuzzy > 0) tier.fuzzy += 1;
        else tier.nickname += 1;
    }

    return {
        label: criteria.label,
        criteria,
        counts: {
            total_records: records.length,
            eligible_records,
            rule_blocks: blocks.size,
            exact_groups: exact_groups.length,
            exact_records,
            fuzzy_pairs,
            nickname_pairs,
            nickname_only,
            nickname_both,
            consolidated_clusters: cluster_ids.length,
            tier_exact: tier.exact,
            tier_fuzzy: tier.fuzzy,
            tier_nickname: tier.nickname,
            pairs_compared,
        },
        edges,
        cluster_ids,
    };
}

// Normalized pair key for diffing (order-independent).
function pair_key(e) {
    return e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
}

// Diff two edge lists at the matched-pair level. Returns counts of pairs only in
// A, only in B, and in both (+ the actual added/removed pairs for detail).
function diff_profiles(a_edges, b_edges) {
    const setA = new Map();
    const setB = new Map();
    for (const e of a_edges) setA.set(pair_key(e), e.type);
    for (const e of b_edges) setB.set(pair_key(e), e.type);

    const only_a = [];
    const only_b = [];
    let common = 0;
    for (const [k, type] of setA) {
        if (setB.has(k)) common += 1;
        else only_a.push({ pair: k, type });
    }
    for (const [k, type] of setB) {
        if (!setA.has(k)) only_b.push({ pair: k, type });
    }
    return {
        only_in_a: only_a.length,
        only_in_b: only_b.length,
        common,
        added: only_a,   // in A, not B
        removed: only_b, // in B, not A
    };
}

module.exports = {
    BASELINE_CRITERIA,
    RULE_FIELD_KEYS,
    trim_zip,
    fields_abbrev,
    profile_label,
    criteria_equal,
    expand_grid,
    run_profile,
    diff_profiles,
};
