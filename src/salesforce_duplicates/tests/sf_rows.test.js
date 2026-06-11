/**
 * sf_rows.test.js — Unit tests for src/sf_rows.js (Salesforce import mapping).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/sf_rows.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    to_sf_exact_row,
    to_sf_fuzzy_pair_row,
    to_sf_fuzzy_group_row,
    to_sf_nickname_group_row,
    to_sf_consolidated_row,
} = require('../src/sf_rows');

const base = {
    row_number: 1,
    run_id: 'R1',
    created_at_mtn: 'mtn',
    created_at_utc: 'utc',
    script_start_date: new Date(0),
    query_start_date: new Date(0),
    query_end_date: new Date(0),
    query_duration_ms: 1000,
    fuzzy_start_date: new Date(0),
    fuzzy_end_date: new Date(0),
    fuzzy_duration_ms: 2000,
    source_file_name: 'file.csv',
};

describe('to_sf_exact_row', () => {
    const out = to_sf_exact_row({
        ...base,
        row: {
            duplicate_key: 'k', last_name: 'SNOW', first_name: 'JON', gender: 'MALE',
            birthdate: '1990-01-01', composite_zip: '80301', duplicate_count: 2,
            record_ids: ['1', '2'], member_numbers: ['m1', 'm2'], merge_ids: ['mg1', 'mg2'],
            foundation_constituents: ['A', 'A', 'B'],
        },
    });

    test('maps the exact-group fields incl. merge ids', () => {
        assert.equal(out.Match_Type__c, 'exact_group');
        assert.equal(out.Record_Ids__c, '1;2');
        assert.equal(out.Member_Numbers__c, 'm1;m2');
        assert.equal(out.Merge_Ids__c, 'mg1;mg2');
        assert.equal(out.Foundation_Constituent_Values__c, 'A;A;B'); // positional, one per record
        assert.ok(out.External_Id__c.startsWith('R1|exact_group|'));
    });
});

describe('to_sf_fuzzy_pair_row', () => {
    const out = to_sf_fuzzy_pair_row({
        ...base,
        row: {
            record_id_1: '1', record_id_2: '2', full_name_1: 'Jon Snow', full_name_2: 'John Snow',
            match_score_combined_name: 93, same_gender_flag: 1, strict_rule_match_flag: 1,
            merge_id_1: 'mgA', merge_id_2: 'mgB',
        },
    });

    test('maps the fuzzy-pair fields incl. merge ids', () => {
        assert.equal(out.Match_Type__c, 'fuzzy_pair');
        assert.equal(out.Account_1__c, '1');
        assert.equal(out.Merge_Id_1__c, 'mgA');
        assert.equal(out.Merge_Id_2__c, 'mgB');
        assert.ok(out.External_Id__c.startsWith('R1|fuzzy_pair|'));
    });
});

describe('to_sf_fuzzy_group_row', () => {
    const out = to_sf_fuzzy_group_row({
        ...base,
        row: {
            fuzzy_group_key: '1|2|3', group_record_count: 3, names_in_group: 'Jon Snow;John Snow',
            record_ids: '1;2;3', shared_composite_zip: '80301', merge_ids: 'mg1;mg2;mg3',
        },
    });

    test('maps the fuzzy-group fields incl. merge ids', () => {
        assert.equal(out.Match_Type__c, 'fuzzy_group');
        assert.equal(out.Fuzzy_Group_Key__c, '1|2|3');
        assert.equal(out.Merge_Ids__c, 'mg1;mg2;mg3');
        assert.ok(out.External_Id__c.startsWith('R1|fuzzy_group|'));
    });
});

describe('to_sf_nickname_group_row', () => {
    const out = to_sf_nickname_group_row({
        ...base,
        row: {
            nickname_group_key: '1|2|3', group_record_count: 3,
            names_in_group: 'Bob Smith;Bobby Smith;Robert Smith',
            record_ids: '1;2;3', shared_composite_zip: '80301', merge_ids: 'mg1;mg2',
            nickname_pair_count_in_group: 3, nickname_pair_summary: 'x',
        },
    });

    test('maps the nickname-group fields', () => {
        assert.equal(out.Match_Type__c, 'nickname_group');
        assert.equal(out.Nickname_Group_Key__c, '1|2|3');
        assert.equal(out.Group_Record_Count__c, 3);
        assert.equal(out.Merge_Ids__c, 'mg1;mg2');
        assert.ok(out.External_Id__c.startsWith('R1|nickname_group|'));
    });
});

describe('to_sf_consolidated_row', () => {
    const out = to_sf_consolidated_row({
        ...base,
        row: {
            consolidated_group_key: '1|2|3', group_record_count: 3, confidence_tier: 'exact',
            match_composition: 'exact + nickname',
            has_exact_flag: 1, has_fuzzy_flag: 0, has_nickname_flag: 1,
            exact_link_count: 1, fuzzy_link_count: 0, nickname_link_count: 2, match_link_count: 3,
            names_in_group: 'Robert Smith;Bob Smith;Bobby Smith',
            record_ids: '1;2;3', merge_ids: 'x;y;z',
            best_pair_score: 63, lowest_pair_score: 50,
            representative_pair: 'Robert Smith <-> Bob Smith: nickname (first 17 / last 100 / combined 63)',
            match_link_reasons: 'Robert Smith <-> Bob Smith: nickname [...] — ...',
            consolidated_logic: 'x',
        },
    });

    test('maps consolidated cluster fields (renamed + new)', () => {
        assert.equal(out.Match_Type__c, 'consolidated_cluster');
        assert.equal(out.Consolidated_Group_Key__c, '1|2|3');
        assert.equal(out.Group_Record_Count__c, 3);
        assert.equal(out.Match_Composition__c, 'exact + nickname');
        assert.equal(out.Match_Link_Count__c, 3);
        assert.equal(out.Nickname_Link_Count__c, 2);
        assert.ok(out.Representative_Pair__c.includes('<->'));
        assert.ok(out.Match_Link_Reasons__c.includes('<->'));
        assert.equal(out.Edge_Reasons__c, undefined); // renamed away
        assert.ok(out.External_Id__c.startsWith('R1|consolidated_cluster|'));
    });
});
