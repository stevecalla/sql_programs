/**
 * grouping.test.js — Unit tests for src/grouping.js (UnionFind + groups).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/grouping.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { UnionFind, build_fuzzy_groups } = require('../src/grouping');

describe('UnionFind', () => {
    test('unioned items share a root; separate items do not', () => {
        const uf = new UnionFind();
        uf.union('a', 'b');
        uf.union('b', 'c');
        uf.add('d');
        assert.equal(uf.find('a'), uf.find('c'));
        assert.notEqual(uf.find('a'), uf.find('d'));
    });
    test('groups() clusters connected items', () => {
        const uf = new UnionFind();
        uf.union('a', 'b');
        uf.union('c', 'd');
        const clusters = [...uf.groups().values()].map((g) => g.sort().join(',')).sort();
        assert.deepEqual(clusters, ['a,b', 'c,d']);
    });
});

describe('build_fuzzy_groups', () => {
    test('builds a connected group from pair matches', () => {
        const record_lookup = new Map([
            ['1', { Id: '1', FirstName: 'Jon', LastName: 'Snow', cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' }],
            ['2', { Id: '2', FirstName: 'John', LastName: 'Snow', cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' }],
            ['3', { Id: '3', FirstName: 'Jonn', LastName: 'Snow', cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' }],
        ]);
        const fuzzy_matches = [
            { record_id_1: '1', record_id_2: '2', match_score_combined_name: 93, full_name_1: 'Jon Snow', full_name_2: 'John Snow' },
            { record_id_1: '2', record_id_2: '3', match_score_combined_name: 90, full_name_1: 'John Snow', full_name_2: 'Jonn Snow' },
        ];

        const groups = build_fuzzy_groups(fuzzy_matches, record_lookup);
        assert.equal(groups.length, 1);

        const g = groups[0];
        assert.equal(g.group_record_count, 3);
        assert.equal(g.fuzzy_group_key, '1|2|3');
        assert.equal(g.record_ids, '1;2;3');
        assert.equal(g.shared_composite_zip, '80301');
        assert.equal(g.best_pair_score, 93);
        assert.equal(g.lowest_pair_score, 90);
        assert.equal(g.fuzzy_pair_count_in_group, 2);
        assert.ok(g.names_in_group.includes('Jon Snow'));
    });

    test('singletons (no pairs) produce no groups', () => {
        assert.deepEqual(build_fuzzy_groups([], new Map()), []);
    });
});
