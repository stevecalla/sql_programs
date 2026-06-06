/**
 * fuzzy.test.js — Unit tests for src/fuzzy.js (run_fuzzy_matching).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/fuzzy.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { run_fuzzy_matching } = require('../src/fuzzy');

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

describe('run_fuzzy_matching', () => {
    test('finds a fuzzy pair that clears threshold + strict rule match', () => {
        const records = [
            rec('10', 'Jonathan', 'Snow'),
            rec('11', 'Johnathan', 'Snow'), // similar first name, same rule fields
        ];

        const out = run_fuzzy_matching(records, new Set(), { script_start_ms: Date.now(), fuzzy_start_ms: Date.now() });

        assert.equal(out.records_after_exact_exclusion.length, 2);
        assert.equal(out.fuzzy_candidate_records.length, 2);
        assert.equal(out.records_excluded_missing_rule_fields, 0);
        assert.equal(out.rule_blocks.size, 1);
        assert.equal(out.pairs_compared, 1);
        assert.equal(out.fuzzy_matches.length, 1);

        const m = out.fuzzy_matches[0];
        assert.equal(m.record_id_1, '10');
        assert.equal(m.record_id_2, '11');
        assert.ok(m.match_score_combined_name >= 90);
        assert.equal(m.strict_rule_match_flag, 1);
    });

    test('excludes records already in the exact set and those missing rule fields', () => {
        const records = [
            rec('10', 'Jonathan', 'Snow'),
            rec('11', 'Johnathan', 'Snow'),
            rec('12', 'Jonny', 'Snow', { BillingPostalCode: '', PersonMailingPostalCode: '' }), // missing zip
        ];

        const out = run_fuzzy_matching(records, new Set(['10']), { script_start_ms: Date.now(), fuzzy_start_ms: Date.now() });

        // #10 excluded as exact; #12 dropped for missing zip; only #11 remains.
        assert.equal(out.records_after_exact_exclusion.length, 2);     // 11 + 12
        assert.equal(out.records_excluded_missing_rule_fields, 1);     // 12
        assert.equal(out.fuzzy_candidate_records.length, 1);           // 11
        assert.equal(out.fuzzy_matches.length, 0);                     // nothing to pair with
    });

    test('identical cleaned names are skipped (they belong in the exact file)', () => {
        const records = [
            rec('10', 'Jon', 'Snow'),
            rec('11', 'Jon', 'Snow'),
        ];
        const out = run_fuzzy_matching(records, new Set(), { script_start_ms: Date.now(), fuzzy_start_ms: Date.now() });
        assert.equal(out.pairs_compared, 1);
        assert.equal(out.pairs_skipped_exact_clean_name, 1);
        assert.equal(out.fuzzy_matches.length, 0);
    });
});
