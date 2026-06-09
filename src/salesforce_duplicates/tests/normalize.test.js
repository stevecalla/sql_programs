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
    trim_zip5,
    composite_zip_raw,
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

describe('trim_zip5', () => {
    test('plain 5-digit ZIP is unchanged', () => {
        assert.equal(trim_zip5('80919'), '80919');
    });
    test('ZIP+4 with hyphen keeps first five', () => {
        assert.equal(trim_zip5('80919-1234'), '80919');
    });
    test('9-digit ZIP without hyphen keeps first five', () => {
        assert.equal(trim_zip5('809191234'), '80919');
    });
    test('surrounding whitespace is trimmed before testing', () => {
        assert.equal(trim_zip5('  80919-1234 '), '80919');
    });
    test('non-US / alphanumeric codes are left untouched', () => {
        assert.equal(trim_zip5('K1A 0B1'), 'K1A 0B1'); // Canadian postal code
        assert.equal(trim_zip5('SW1A 1AA'), 'SW1A 1AA'); // UK postcode
    });
    test('short / non-conforming values pass through unchanged', () => {
        assert.equal(trim_zip5('2134'), '2134');   // 4-digit (leading zero lost upstream)
        assert.equal(trim_zip5(''), '');
        assert.equal(trim_zip5(null), '');
        assert.equal(trim_zip5(undefined), '');
    });
});

describe('composite_zip_raw', () => {
    test('prefers billing, falls back to mailing, else empty — NO trimming', () => {
        assert.equal(composite_zip_raw({ BillingPostalCode: '80919-1234', PersonMailingPostalCode: '99999' }), '80919-1234');
        assert.equal(composite_zip_raw({ BillingPostalCode: '', PersonMailingPostalCode: '99999-0001' }), '99999-0001');
        assert.equal(composite_zip_raw({}), '');
    });
});

describe('composite_zip', () => {
    test('prefers billing, falls back to mailing, else empty', () => {
        assert.equal(composite_zip({ BillingPostalCode: '80301', PersonMailingPostalCode: '99999' }), '80301');
        assert.equal(composite_zip({ BillingPostalCode: '', PersonMailingPostalCode: '99999' }), '99999');
        assert.equal(composite_zip({}), '');
    });
    test('trims the chosen ZIP to its first five digits (ZIP+4 -> 5)', () => {
        assert.equal(composite_zip({ BillingPostalCode: '80919-1234' }), '80919');
        assert.equal(composite_zip({ BillingPostalCode: '', PersonMailingPostalCode: '809191234' }), '80919');
    });
    test('leaves non-US postal codes untouched', () => {
        assert.equal(composite_zip({ BillingPostalCode: 'K1A 0B1' }), 'K1A 0B1');
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
    test('keys use the trimmed (first-5) ZIP, so ZIP+4 matches plain 5-digit', () => {
        const plain = make_exact_duplicate_key(row);                       // ...|80301
        const zip4 = make_exact_duplicate_key({ ...row, BillingPostalCode: '80301-1234' });
        assert.equal(zip4, plain);
        assert.equal(make_rule_key({ ...row, BillingPostalCode: '80301-1234' }), 'MALE|1990-01-01|80301');
    });
});
