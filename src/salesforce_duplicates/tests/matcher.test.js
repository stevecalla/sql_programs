/**
 * matcher.test.js — Unit tests for src/matcher.js (pure fuzzy scoring).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/matcher.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    levenshtein_distance,
    similarity_score,
    get_rule_flags,
    get_fuzzy_match_reason,
} = require('../src/matcher');

describe('levenshtein_distance', () => {
    test('identical strings = 0', () => {
        assert.equal(levenshtein_distance('abc', 'abc'), 0);
    });
    test('classic kitten -> sitting = 3', () => {
        assert.equal(levenshtein_distance('kitten', 'sitting'), 3);
    });
    test('empty operands fall back to other length', () => {
        assert.equal(levenshtein_distance('', 'abc'), 3);
        assert.equal(levenshtein_distance('abc', ''), 3);
    });
});

describe('similarity_score', () => {
    test('identical cleaned names = 100', () => {
        assert.equal(similarity_score('Jon', 'jon'), 100);
    });
    test('close names score high, far names score low', () => {
        assert.ok(similarity_score('Jon', 'John') >= 70);
        assert.ok(similarity_score('Jon', 'Zachary') < 50);
    });
    test('empty input scores 0', () => {
        assert.equal(similarity_score('', 'Jon'), 0);
    });
});

describe('get_rule_flags', () => {
    const a = { cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' };

    test('all three matching -> strict match, count 3', () => {
        const flags = get_rule_flags(a, { ...a });
        assert.equal(flags.strict_rule_match_flag, 1);
        assert.equal(flags.rule_match_count, 3);
    });
    test('one field differs -> not strict, count 2', () => {
        const flags = get_rule_flags(a, { ...a, BillingPostalCode: '99999' });
        assert.equal(flags.strict_rule_match_flag, 0);
        assert.equal(flags.rule_match_count, 2);
        assert.equal(flags.same_composite_zip_flag, 0);
    });
    test('empty field never counts as a match', () => {
        const blank = { cfg_Gender_Identity__pc: '', PersonBirthdate: '', BillingPostalCode: '' };
        const flags = get_rule_flags(blank, { ...blank });
        assert.equal(flags.rule_match_count, 0);
    });
});

describe('get_fuzzy_match_reason', () => {
    test('returns a reason object citing the threshold', () => {
        const a = { FirstName: 'Jon', LastName: 'Snow', cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' };
        const b = { FirstName: 'John', LastName: 'Snow', cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01', BillingPostalCode: '80301' };
        const out = get_fuzzy_match_reason({
            row_a: a, row_b: b,
            first_name_score: 86, last_name_score: 100, combined_name_score: 93,
            rule_flags: get_rule_flags(a, b),
        });
        assert.ok(typeof out.fuzzy_match_reason === 'string' && out.fuzzy_match_reason.includes('threshold'));
        assert.ok(out.first_name_difference_reason.includes('First names'));
        assert.ok(out.rule_match_reason.includes('Strict rule match'));
    });
});
