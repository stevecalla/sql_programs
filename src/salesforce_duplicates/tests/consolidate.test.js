/**
 * consolidate.test.js — Unit tests for src/consolidate.js
 * (complete-pool edge generation + consolidated clustering).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/consolidate.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detect_exact_duplicates } = require('../src/exact');
const { build_match_edges, build_nickname_groups, build_consolidated_clusters, summarize_clusters } = require('../src/consolidate');

function rec(id, first, last, extra = {}) {
    return {
        Id: id,
        FirstName: first,
        LastName: last,
        cfg_Gender_Identity__pc: 'Male',
        PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80301',
        cfg_Member_Number__pc: `m${id}`,
        usat_Foundation_Constituent__c: '',
        ...extra,
    };
}

function lookup(records) {
    const m = new Map();
    for (const r of records) m.set(r.Id, r);
    return m;
}

describe('build_match_edges', () => {
    const records = [
        rec('1', 'Robert', 'Smith'),
        rec('2', 'Robert', 'Smith'),
        rec('3', 'Bob', 'Smith'),
        rec('4', 'Robbert', 'Smith'),
    ];
    const { exact_duplicate_groups } = detect_exact_duplicates(records, {});
    const out = build_match_edges(records, exact_duplicate_groups);

    test('exact group becomes an exact edge', () => {
        const exactEdges = out.edges.filter((e) => e.type === 'exact');
        assert.equal(exactEdges.length, 1); // r1 <-> r2
    });

    test('Bob <-> Robert is a nickname edge (not spelling)', () => {
        const nickEdges = out.edges.filter((e) => e.nickname_flag === 1);
        assert.ok(nickEdges.length >= 1);
        for (const e of nickEdges) assert.equal(e.spelling_flag, 0);
    });

    test('Robbert <-> Robert is a fuzzy spelling edge (not nickname)', () => {
        const spellingEdges = out.edges.filter((e) => e.spelling_flag === 1 && e.nickname_flag === 0);
        assert.ok(spellingEdges.length >= 1);
    });

    test('nickname view lists Bob pairs, flagged in_exact_group, not also-fuzzy', () => {
        assert.equal(out.nickname_pairs.length, 2); // Bob<->each Robert
        for (const p of out.nickname_pairs) {
            assert.equal(p.nickname_match_flag, 1);
            assert.equal(p.in_exact_group_flag, 1); // the Roberts are exact dups
            assert.equal(p.also_clears_fuzzy_flag, 0);
            assert.equal(p.match_path, 'nickname');
        }
    });

    test('overlap counters add up', () => {
        assert.equal(out.counters.pairs_matched_nickname_only, 2);
        assert.equal(out.counters.pairs_matched_spelling_only, 2);
        assert.equal(out.counters.pairs_matched_both, 0);
        assert.equal(out.counters.nickname_pairs_found, 2);
    });

    test('nickname-fire summary tallies bob~robert', () => {
        const hit = out.fire_summary.find((f) => f.first_name_a === 'bob' && f.first_name_b === 'robert');
        assert.ok(hit);
        assert.equal(hit.record_count, 2);
    });
});

describe('build_consolidated_clusters', () => {
    test('exact + fuzzy + nickname merge into ONE cluster (the exact<->nickname merge)', () => {
        const records = [
            rec('1', 'Robert', 'Smith'),
            rec('2', 'Robert', 'Smith'),
            rec('3', 'Bob', 'Smith'),
            rec('4', 'Robbert', 'Smith'),
            rec('5', 'Zelda', 'Jones', { BillingPostalCode: '99999' }),
        ];
        const { exact_duplicate_groups } = detect_exact_duplicates(records, {});
        const { edges } = build_match_edges(records, exact_duplicate_groups);
        const clusters = build_consolidated_clusters(edges, lookup(records));

        assert.equal(clusters.length, 1);
        const c = clusters[0];
        assert.equal(c.group_record_count, 4);
        assert.equal(c.match_composition, 'exact + fuzzy + nickname');
        assert.ok(c.match_link_count > 0);
        assert.ok(c.representative_pair.includes('<->'));
        assert.ok(c.match_link_reasons.includes('<->'));
        assert.equal(c.has_exact_flag, 1);
        assert.equal(c.has_fuzzy_flag, 1);
        assert.equal(c.has_nickname_flag, 1);
        assert.equal(c.confidence_tier, 'exact');
        assert.ok(!c.record_ids.split(';').includes('5'));
    });

    test('nickname requires the last name to agree (gate holds)', () => {
        const records = [
            rec('1', 'Robert', 'Smith'),
            rec('2', 'Bob', 'Xavier'),
        ];
        const { exact_duplicate_groups } = detect_exact_duplicates(records, {});
        const out = build_match_edges(records, exact_duplicate_groups);
        assert.equal(out.nickname_pairs.length, 0);
        const clusters = build_consolidated_clusters(out.edges, lookup(records));
        assert.equal(clusters.length, 0);
    });
});

describe('summarize_clusters', () => {
    test('counts clusters and records by confidence tier', () => {
        const clusters = [
            { confidence_tier: 'exact', group_record_count: 3 },
            { confidence_tier: 'exact', group_record_count: 2 },
            { confidence_tier: 'fuzzy', group_record_count: 2 },
            { confidence_tier: 'nickname', group_record_count: 4 },
        ];
        const s = summarize_clusters(clusters);
        assert.equal(s.total_clusters, 4);
        assert.equal(s.total_records, 11);
        assert.equal(s.by_tier.exact.clusters, 2);
        assert.equal(s.by_tier.exact.records, 5);
        assert.equal(s.by_tier.fuzzy.clusters, 1);
        assert.equal(s.by_tier.nickname.clusters, 1);
        assert.equal(s.by_tier.nickname.records, 4);
    });
});

describe('build_nickname_groups', () => {
    test('Bob/Bobby/Robert collapse into one nickname group', () => {
        const records = [
            rec('1', 'Bob', 'Smith'),
            rec('2', 'Bobby', 'Smith'),
            rec('3', 'Robert', 'Smith'),
        ];
        const { exact_duplicate_groups } = detect_exact_duplicates(records, {});
        const { nickname_pairs } = build_match_edges(records, exact_duplicate_groups);
        const groups = build_nickname_groups(nickname_pairs, lookup(records));
        assert.equal(groups.length, 1);
        assert.equal(groups[0].group_record_count, 3);
        assert.equal(groups[0].record_ids, '1;2;3');
        assert.ok(groups[0].nickname_pair_count_in_group >= 2);
    });
});

describe('merge id flows through every view', () => {
    test('nickname pair, cluster, and nickname group carry usat_Salesforce_Merge_Id__pc', () => {
        const records = [
            rec('1', 'Bob', 'Smith', { usat_Salesforce_Merge_Id__pc: 'mgA' }),
            rec('2', 'Robert', 'Smith', { usat_Salesforce_Merge_Id__pc: 'mgB' }),
        ];
        const { exact_duplicate_groups } = detect_exact_duplicates(records, {});
        const { edges, nickname_pairs } = build_match_edges(records, exact_duplicate_groups);
        assert.equal(nickname_pairs.length, 1);
        assert.equal(nickname_pairs[0].merge_id_1, 'mgA');
        assert.equal(nickname_pairs[0].merge_id_2, 'mgB');

        const clusters = build_consolidated_clusters(edges, lookup(records));
        assert.equal(clusters[0].merge_ids, 'mgA;mgB');

        const groups = build_nickname_groups(nickname_pairs, lookup(records));
        assert.equal(groups[0].merge_ids, 'mgA;mgB');
    });
});
