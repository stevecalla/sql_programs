/**
 * exact.test.js — Unit tests for src/exact.js (detect_exact_duplicates).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/exact.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detect_exact_duplicates } = require('../src/exact');

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

describe('detect_exact_duplicates', () => {
    test('groups exact dupes, leaves singletons out, collects excluded ids', () => {
        const records = [
            rec('1', 'John', 'Smith'),
            rec('2', 'John', 'Smith'), // exact dup of #1
            rec('3', 'Mary', 'Jones', { cfg_Gender_Identity__pc: 'Female', PersonBirthdate: '1985-05-05', BillingPostalCode: '90210' }),
        ];

        const { exact_groups_size, exact_duplicate_groups, exact_duplicate_record_ids } =
            detect_exact_duplicates(records, { script_start_ms: Date.now() });

        assert.equal(exact_groups_size, 2);                 // two unique keys
        assert.equal(exact_duplicate_groups.length, 1);     // only the Smith group has >1
        assert.equal(exact_duplicate_groups[0].duplicate_count, 2);
        assert.deepEqual(exact_duplicate_groups[0].record_ids, ['1', '2']);
        assert.equal(exact_duplicate_record_ids.size, 2);
        assert.ok(exact_duplicate_record_ids.has('1') && exact_duplicate_record_ids.has('2'));
        assert.ok(!exact_duplicate_record_ids.has('3'));
    });

    test('no duplicates -> empty groups + empty excluded set', () => {
        const records = [
            rec('1', 'John', 'Smith'),
            rec('2', 'Mary', 'Jones', { BillingPostalCode: '90210' }),
        ];
        const out = detect_exact_duplicates(records, { script_start_ms: Date.now() });
        assert.equal(out.exact_groups_size, 2);
        assert.equal(out.exact_duplicate_groups.length, 0);
        assert.equal(out.exact_duplicate_record_ids.size, 0);
    });
});
