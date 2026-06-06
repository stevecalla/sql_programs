/**
 * normalize.test.js — Unit tests for src/normalize.js (pure field helpers).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/normalize.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    norm,
    clean_name,
    unique_join,
    composite_zip,
    make_full_name,
    make_clean_full_name,
    make_exact_duplicate_key,
    make_rule_key,
    has_required_rule_fields,
} = require('../src/normalize');

describe('norm', () => {
    test('trims and uppercases', () => {
        assert.equal(norm('  Smith '), 'SMITH');
    });
    test('null/undefined become empty string', () => {
        assert.equal(norm(null), '');
        assert.equal(norm(undefined), '');
    });
});

describe('clean_name', () => {
    test('strips non-alphanumerics and uppercases', () => {
        assert.equal(clean_name("O'Brien-Smith"), 'OBRIENSMITH');
        assert.equal(clean_name('María 3'), 'MARA3'); // accent stripped, digit kept
    });
});

describe('unique_join', () => {
    test('dedupes, drops blanks/null, joins with semicolons', () => {
        assert.equal(unique_join(['a', 'a', '', null, undefined, 'b']), 'a;b');
    });
});

describe('composite_zip', () => {
    test('prefers billing, falls back to mailing, else empty', () => {
        assert.equal(composite_zip({ BillingPostalCode: '80301', PersonMailingPostalCode: '99999' }), '80301');
        assert.equal(composite_zip({ BillingPostalCode: '', PersonMailingPostalCode: '99999' }), '99999');
        assert.equal(composite_zip({}), '');
    });
});

describe('name builders', () => {
    test('make_full_name joins first + last and trims', () => {
        assert.equal(make_full_name({ FirstName: 'Jon', LastName: 'Snow' }), 'Jon Snow');
        assert.equal(make_full_name({ LastName: 'Snow' }), 'Snow');
    });
    test('make_clean_full_name cleans both parts', () => {
        assert.equal(make_clean_full_name({ FirstName: "Jon.", LastName: "O'Snow" }), 'JON OSNOW');
    });
});

describe('keys + required fields', () => {
    const row = {
        FirstName: 'Jon', LastName: 'Snow',
        cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80301',
    };
    test('make_exact_duplicate_key is pipe-joined normalized fields', () => {
        assert.equal(make_exact_duplicate_key(row), 'SNOW|JON|MALE|1990-01-01|80301');
    });
    test('make_rule_key is gender|birthdate|zip', () => {
        assert.equal(make_rule_key(row), 'MALE|1990-01-01|80301');
    });
    test('has_required_rule_fields needs gender + birthdate + zip', () => {
        assert.equal(has_required_rule_fields(row), true);
        assert.equal(has_required_rule_fields({ ...row, PersonBirthdate: '' }), false);
        assert.equal(has_required_rule_fields({ ...row, BillingPostalCode: '', PersonMailingPostalCode: '' }), false);
    });
});
