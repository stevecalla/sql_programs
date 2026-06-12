/**
 * sql_backbone_parity.test.js — Phase 2 byte-identical guarantee.
 *
 * Proves the finder's detection is IDENTICAL whether records come straight from the
 * fetch or are round-tripped through the DB snapshot (load -> read). The DB read
 * returns rows in primary-key order, so order is only preserved by the load_sequence
 * ordinal + `ORDER BY load_sequence`. This test simulates that round-trip (no MySQL):
 * it stores rows, SHUFFLES them (as a clustered-index scan would), then restores fetch
 * order via load_sequence — and asserts the order-sensitive exact-duplicate output
 * (including the positional record_ids / member_numbers lists) is unchanged.
 *
 *   node --test tests/sql_backbone_parity.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { COLUMNS, to_snapshot_row, record_from_row } = require('../src/database_snapshot');
const { detect_exact_duplicates } = require('../src/exact');

function rec(id, first, last, extra = {}) {
    return {
        Id: id, FirstName: first, LastName: last,
        cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80301', PersonMailingPostalCode: '',
        cfg_Member_Number__pc: `m${id}`, usat_Salesforce_Merge_Id__pc: `mg${id}`,
        usat_Foundation_Constituent__c: '', ...extra,
    };
}

// Simulate the DB round-trip: map each record to its stored row (with load_sequence),
// SHUFFLE (as MySQL's PK-order scan would reorder), then restore fetch order via
// load_sequence and map back to records — exactly what read_records does.
function db_round_trip(records) {
    let seq = 0;
    const rows = records.map((r) => {
        const row = to_snapshot_row(r, new Date(), seq++);
        const obj = {};
        COLUMNS.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
    });
    // shuffle (reverse) as a clustered-index scan might, then restore fetch order
    // via load_sequence — exactly what read_records does with ORDER BY load_sequence.
    const shuffled = [...rows].reverse();
    shuffled.sort((a, b) => a.load_sequence - b.load_sequence);
    return shuffled.map(record_from_row);
}

describe('Phase 2 parity: detection is identical on DB-round-tripped records', () => {
    // A pool with a 3-record exact group (so within-group ORDER matters) + others.
    const records = [
        rec('A1', 'Robert', 'Smith'),
        rec('B1', 'Jane', 'Doe', { BillingPostalCode: '10001' }),
        rec('A2', 'Robert', 'Smith'),
        rec('C1', 'Mike', 'Vale', { BillingPostalCode: '20002' }),
        rec('A3', 'Robert', 'Smith'),
        rec('B2', 'Jane', 'Doe', { BillingPostalCode: '10001' }),
    ];

    test('exact groups (and positional lists) are byte-identical', () => {
        const a = detect_exact_duplicates(records, {});
        const b = detect_exact_duplicates(db_round_trip(records), {});
        assert.deepEqual(b.exact_duplicate_groups, a.exact_duplicate_groups);
        assert.deepEqual([...b.exact_duplicate_record_ids], [...a.exact_duplicate_record_ids]);
        assert.equal(b.exact_groups_size, a.exact_groups_size);
    });

    test('the 3-record group keeps its record_ids in fetch order (A1;A2;A3)', () => {
        const b = detect_exact_duplicates(db_round_trip(records), {});
        const smithGroup = b.exact_duplicate_groups.find((g) => g.record_ids.length === 3);
        assert.deepEqual(smithGroup.record_ids, ['A1', 'A2', 'A3']);
        assert.deepEqual(smithGroup.member_numbers, ['mA1', 'mA2', 'mA3']);
    });
});
