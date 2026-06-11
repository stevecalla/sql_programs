/**
 * salesforce.test.js — pure helpers in src/salesforce.js (no network).
 * Run from src/salesforce_duplicates via: node --test tests/salesforce.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { build_account_soql, account_field_exists, MERGE_ID_FIELD } = require('../src/salesforce');

describe('build_account_soql', () => {
    test('includes the optional merge field only when asked', () => {
        assert.ok(build_account_soql({ include_merge_id: true }).includes(MERGE_ID_FIELD));
        assert.ok(!build_account_soql({ include_merge_id: false }).includes(MERGE_ID_FIELD));
    });

    test('ordered adds ORDER BY; unordered does not', () => {
        assert.ok(build_account_soql({ ordered: true }).includes('ORDER BY LastName, FirstName, Id'));
        assert.ok(!build_account_soql({ ordered: false }).includes('ORDER BY'));
    });

    test('always selects the base fields (even without the merge field)', () => {
        const q = build_account_soql({ include_merge_id: false });
        for (const f of ['Id', 'LastName', 'FirstName', 'cfg_Member_Number__pc', 'cfg_Gender_Identity__pc', 'PersonBirthdate', 'BillingPostalCode', 'PersonMailingPostalCode']) {
            assert.ok(q.includes(f), `missing ${f}`);
        }
    });
});

describe('account_field_exists', () => {
    const fakeConn = (fields) => ({ sobject: () => ({ describe: async () => ({ fields }) }) });

    test('true when the field is present in the describe', async () => {
        const conn = fakeConn([{ name: 'Id' }, { name: MERGE_ID_FIELD }]);
        assert.equal(await account_field_exists(conn, MERGE_ID_FIELD), true);
    });

    test('false when the field is absent (org without it)', async () => {
        const conn = fakeConn([{ name: 'Id' }, { name: 'LastName' }]);
        assert.equal(await account_field_exists(conn, MERGE_ID_FIELD), false);
    });

    test('false (safe) when the describe call throws', async () => {
        const conn = { sobject: () => ({ describe: async () => { throw new Error('no access'); } }) };
        assert.equal(await account_field_exists(conn, MERGE_ID_FIELD), false);
    });
});
