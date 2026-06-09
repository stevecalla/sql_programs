/**
 * zip_trim.test.js — Unit tests for src/zip_trim.js (raw -> trimmed ZIP map).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/zip_trim.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { build_zip_trim_mapping } = require('../src/zip_trim');

describe('build_zip_trim_mapping', () => {
    test('counts only records whose ZIP actually changed', () => {
        const records = [
            { BillingPostalCode: '80919-1234' }, // -> 80919 (changed)
            { BillingPostalCode: '80919-5678' }, // -> 80919 (changed, different raw)
            { BillingPostalCode: '80919' },      // unchanged
            { PersonMailingPostalCode: '809191234' }, // -> 80919 (changed, mailing fallback)
            { BillingPostalCode: '' },           // no ZIP at all
            { BillingPostalCode: 'K1A 0B1' },    // non-US, unchanged
        ];

        const out = build_zip_trim_mapping(records);

        assert.equal(out.total_records, 6);
        assert.equal(out.records_with_zip, 5);   // the empty one is excluded
        assert.equal(out.records_trimmed, 3);     // three rows changed
        assert.equal(out.mapping.length, 3);      // three distinct raw values
    });

    test('aggregates duplicate raw values and sorts by count desc', () => {
        const records = [
            { BillingPostalCode: '80919-1111' },
            { BillingPostalCode: '80919-1111' },
            { BillingPostalCode: '80919-1111' },
            { BillingPostalCode: '90210-2222' },
        ];

        const out = build_zip_trim_mapping(records);

        assert.equal(out.mapping.length, 2);
        assert.deepEqual(out.mapping[0], { raw_composite_zip: '80919-1111', trimmed_composite_zip: '80919', record_count: 3 });
        assert.deepEqual(out.mapping[1], { raw_composite_zip: '90210-2222', trimmed_composite_zip: '90210', record_count: 1 });
    });

    test('empty input yields zero counts and an empty mapping', () => {
        const out = build_zip_trim_mapping([]);
        assert.equal(out.total_records, 0);
        assert.equal(out.records_with_zip, 0);
        assert.equal(out.records_trimmed, 0);
        assert.deepEqual(out.mapping, []);
    });
});
