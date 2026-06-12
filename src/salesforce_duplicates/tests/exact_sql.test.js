/**
 * exact_sql.test.js — Phase 2b: SQL-based exact grouping is byte-identical to exact.js.
 *
 * A fake executor simulates the GROUP BY (computed from the same records the way MySQL
 * would), and we assert detect_exact_duplicates_sql() deep-equals detect_exact_duplicates()
 * — same groups, same positional lists, same sort order. No live MySQL.
 *
 *   node --test tests/exact_sql.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detect_exact_duplicates } = require('../src/exact');
const { detect_exact_duplicates_sql } = require('../src/exact_sql');
const { make_exact_duplicate_key } = require('../src/normalize');

function rec(id, first, last, extra = {}) {
    return {
        Id: id, FirstName: first, LastName: last,
        cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80301', PersonMailingPostalCode: '',
        cfg_Member_Number__pc: `m${id}`, usat_Salesforce_Merge_Id__pc: `mg${id}`,
        usat_Foundation_Constituent__c: '', ...extra,
    };
}

function lookup(records) {
    const m = new Map();
    for (const r of records) m.set(r.Id, r);
    return m;
}

// Fake executor that answers the three queries detect_exact_duplicates_sql issues,
// computing the GROUP BY from `records` exactly as MySQL would (group by key, ids in
// appearance order, groups ordered by first appearance, HAVING COUNT > 1).
function sql_executor_for(records) {
    return async (sql) => {
        if (/^SET SESSION/i.test(sql)) return [];
        if (/COUNT\(DISTINCT exact_duplicate_key\)/i.test(sql)) {
            const keys = new Set(records.map(make_exact_duplicate_key));
            return [{ n: keys.size }];
        }
        // the GROUP BY query
        const order = [];
        const byKey = new Map();
        for (const r of records) {
            const k = make_exact_duplicate_key(r);
            if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
            byKey.get(k).push(r.Id);
        }
        return order
            .filter((k) => byKey.get(k).length > 1)
            .map((k) => ({ exact_duplicate_key: k, ids: byKey.get(k).join(',') }));
    };
}

describe('detect_exact_duplicates_sql parity with exact.js', () => {
    function check(records) {
        const inmem = detect_exact_duplicates(records, {});
        return detect_exact_duplicates_sql(sql_executor_for(records), lookup(records), {}).then((sqlres) => {
            assert.equal(sqlres.exact_groups_size, inmem.exact_groups_size);
            assert.deepEqual(sqlres.exact_duplicate_groups, inmem.exact_duplicate_groups);
            assert.deepEqual([...sqlres.exact_duplicate_record_ids], [...inmem.exact_duplicate_record_ids]);
        });
    }

    test('mixed pool: a 3-record group, a 2-record group, and singletons', async () => {
        await check([
            rec('A1', 'Robert', 'Smith'),
            rec('B1', 'Jane', 'Doe', { BillingPostalCode: '10001' }),
            rec('A2', 'Robert', 'Smith'),
            rec('C1', 'Mike', 'Vale', { BillingPostalCode: '20002' }),
            rec('A3', 'Robert', 'Smith'),
            rec('B2', 'Jane', 'Doe', { BillingPostalCode: '10001' }),
        ]);
    });

    test('full tie: two groups with same count + same display names, different keys', async () => {
        // Two "John Smith" pairs that differ only by birthdate -> different exact keys,
        // identical (count, last, first). Order must follow first appearance.
        await check([
            rec('X1', 'John', 'Smith', { PersonBirthdate: '1980-01-01' }),
            rec('Y1', 'John', 'Smith', { PersonBirthdate: '1990-02-02' }),
            rec('X2', 'John', 'Smith', { PersonBirthdate: '1980-01-01' }),
            rec('Y2', 'John', 'Smith', { PersonBirthdate: '1990-02-02' }),
        ]);
    });

    test('no duplicates -> empty groups, size counts all distinct keys', async () => {
        await check([
            rec('1', 'Al', 'One'),
            rec('2', 'Bo', 'Two', { BillingPostalCode: '11111' }),
        ]);
    });
});
