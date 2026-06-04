/**
 * sf_rows.test.js — Unit tests for src/sf_rows.js (Salesforce import mapping).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/sf_rows.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { to_sf_exact_row, to_sf_fuzzy_pair_row, to_sf_fuzzy_group_row } = require('../src/sf_rows');

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
            record_ids: ['1', '2'], member_numbers: ['m1', 'm2'],
            foundation_constituents: ['A', 'A', 'B'],
        },
    });

    test('maps the exact-group fields', () => {
        assert.equal(out.Match_Type__c, 'exact_group');
        assert.equal(out.Source_File_Name__c, 'file.csv');
        assert.equal(out.Review_Status__c, 'New');
        assert.equal(out.Duplicate_Count__c, 2);
        assert.equal(out.Record_Ids__c, '1;2');
        assert.equal(out.Member_Numbers__c, 'm1;m2');
        assert.equal(out.Foundation_Constituent_Values__c, 'A;B'); // unique_join dedupes
        assert.ok(out.External_Id__c.startsWith('R1|exact_group|'));
    });
});

describe('to_sf_fuzzy_pair_row', () => {
    const out = to_sf_fuzzy_pair_row({
        ...base,
        row: {
            record_id_1: '1', record_id_2: '2', full_name_1: 'Jon Snow', full_name_2: 'John Snow',
            match_score_combined_name: 93, same_gender_flag: 1, strict_rule_match_flag: 1,
        },
    });

    test('maps the fuzzy-pair fields', () => {
        assert.equal(out.Match_Type__c, 'fuzzy_pair');
        assert.equal(out.Account_1__c, '1');
        assert.equal(out.Account_2__c, '2');
        assert.equal(out.Match_Score_Combined_Name__c, 93);
        assert.ok(out.External_Id__c.startsWith('R1|fuzzy_pair|'));
    });
});

describe('to_sf_fuzzy_group_row', () => {
    const out = to_sf_fuzzy_group_row({
        ...base,
        row: {
            fuzzy_group_key: '1|2|3', group_record_count: 3, names_in_group: 'Jon Snow;John Snow',
            record_ids: '1;2;3', shared_composite_zip: '80301',
        },
    });

    test('maps the fuzzy-group fields', () => {
        assert.equal(out.Match_Type__c, 'fuzzy_group');
        assert.equal(out.Fuzzy_Group_Key__c, '1|2|3');
        assert.equal(out.Group_Record_Count__c, 3);
        assert.equal(out.Record_Ids__c, '1;2;3');
        assert.ok(out.External_Id__c.startsWith('R1|fuzzy_group|'));
    });
});
