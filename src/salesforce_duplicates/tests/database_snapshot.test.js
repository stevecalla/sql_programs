/**
 * database_snapshot.test.js — Phase 0 SQL backbone loader (no live MySQL).
 *
 * Uses a fake executor that records (sql, params) calls, so the load logic is fully
 * tested without a database. Run from src/salesforce_duplicates via:
 *   node --test tests/database_snapshot.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    COLUMNS,
    to_snapshot_row,
    create_table_sql,
    recreate_table,
    add_indexes,
    build_insert,
    insert_batch,
    load_snapshot,
    record_from_row,
    read_records,
    count_rows,
    write_meta,
    read_meta,
} = require('../src/database_snapshot');
const { make_exact_duplicate_key, make_rule_key } = require('../src/normalize');
const { SNAPSHOT_TABLE_NAME } = require('../config');

function rec(id, first, last, extra = {}) {
    return {
        Id: id,
        FirstName: first,
        LastName: last,
        cfg_Member_Number__pc: `m${id}`,
        cfg_Gender_Identity__pc: 'Male',
        usat_Foundation_Constituent__c: '',
        usat_Salesforce_Merge_Id__pc: `mg${id}`,
        PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80919-1234',
        PersonMailingPostalCode: '',
        ...extra,
    };
}

// Fake executor: records every call, returns [].
function fake_executor() {
    const calls = [];
    const executor = async (sql, params) => { calls.push({ sql, params }); return []; };
    return { executor, calls };
}

const col = (name) => COLUMNS.indexOf(name);

describe('to_snapshot_row', () => {
    test('row has one value per column, in column order', () => {
        const row = to_snapshot_row(rec('1', 'Bob', 'Smith'));
        assert.equal(row.length, COLUMNS.length);
        assert.equal(row[col('salesforce_account_id')], '1');
        assert.equal(row[col('member_number')], 'm1');
        assert.equal(row[col('salesforce_merge_id')], 'mg1');
    });

    test('keys are computed by normalize.js (parity guarantee)', () => {
        const r = rec('1', '  bob ', 'smith');
        const row = to_snapshot_row(r);
        assert.equal(row[col('exact_duplicate_key')], make_exact_duplicate_key(r));
        assert.equal(row[col('rule_block_key')], make_rule_key(r));
    });

    test('composite ZIP is trimmed to five digits', () => {
        const row = to_snapshot_row(rec('1', 'Bob', 'Smith', { BillingPostalCode: '80919-1234' }));
        assert.equal(row[col('composite_zip_five_digit')], '80919');
    });

    test('blank fields become empty strings, not undefined', () => {
        const row = to_snapshot_row({ Id: '9' });
        for (let i = 0; i < COLUMNS.length - 1; i++) { // last col is loaded_at (a Date)
            assert.notEqual(row[i], undefined);
        }
    });
});

describe('create_table_sql', () => {
    test('names the configured table and binary-collates the key columns', () => {
        const sql = create_table_sql();
        assert.ok(sql.includes(`CREATE TABLE \`${SNAPSHOT_TABLE_NAME}\``));
        assert.ok(/exact_duplicate_key\s+VARCHAR\(\d+\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/.test(sql));
        assert.ok(/rule_block_key\s+VARCHAR\(\d+\)\s+CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/.test(sql));
        assert.ok(/salesforce_account_id\s+VARCHAR\(\d+\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/.test(sql));
        assert.ok(sql.includes('PRIMARY KEY (salesforce_account_id)'));
    });
});

describe('recreate_table', () => {
    test('drops then creates (in that order)', async () => {
        const { executor, calls } = fake_executor();
        await recreate_table(executor);
        assert.equal(calls.length, 2);
        assert.ok(calls[0].sql.startsWith('DROP TABLE IF EXISTS'));
        assert.ok(calls[1].sql.startsWith('CREATE TABLE'));
    });
});

describe('add_indexes', () => {
    test('uses prefix indexes on the key columns (under InnoDB 3072-byte limit)', async () => {
        const { executor, calls } = fake_executor();
        await add_indexes(executor);
        assert.equal(calls.length, 2);
        assert.ok(/CREATE INDEX .*exact_duplicate_key\(255\)/.test(calls[0].sql), calls[0].sql);
        assert.ok(/CREATE INDEX .*rule_block_key\(255\)/.test(calls[1].sql), calls[1].sql);
    });
});

describe('build_insert', () => {
    test('one placeholder group per row, params flattened in column order', () => {
        const rows = [to_snapshot_row(rec('1', 'Bob', 'Smith')), to_snapshot_row(rec('2', 'Bob', 'Smith'))];
        const { sql, params } = build_insert(rows);
        assert.ok(sql.startsWith(`INSERT INTO \`${SNAPSHOT_TABLE_NAME}\``));
        assert.equal((sql.match(/\(\?/g) || []).length, 2); // two value groups
        assert.equal(params.length, COLUMNS.length * 2);
        assert.equal(params[0], '1'); // first column of first row
        assert.equal(params[COLUMNS.length], '2'); // first column of second row
    });
});

describe('insert_batch', () => {
    test('no-op on empty batch', async () => {
        const { executor, calls } = fake_executor();
        const n = await insert_batch(executor, []);
        assert.equal(n, 0);
        assert.equal(calls.length, 0);
    });
});

describe('load_snapshot', () => {
    test('recreate, then batched inserts, then indexes; returns row count', async () => {
        const { executor, calls } = fake_executor();
        const records = ['1', '2', '3', '4', '5'].map((id) => rec(id, 'Bob', 'Smith'));
        const loaded = await load_snapshot(records, { executor, batch_size: 2 });

        assert.equal(loaded, 5);

        const drops = calls.filter((c) => c.sql.startsWith('DROP TABLE'));
        const creates = calls.filter((c) => c.sql.startsWith('CREATE TABLE'));
        const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO'));
        const indexes = calls.filter((c) => c.sql.startsWith('CREATE INDEX'));

        assert.equal(drops.length, 1);
        assert.equal(creates.length, 1);
        assert.equal(inserts.length, 3); // 2 + 2 + 1
        assert.equal(indexes.length, 2);

        // order: drop -> create -> inserts... -> indexes
        assert.ok(calls[0].sql.startsWith('DROP TABLE'));
        assert.ok(calls[1].sql.startsWith('CREATE TABLE'));
        assert.ok(calls[calls.length - 1].sql.startsWith('CREATE INDEX'));

        // total params across inserts == 5 rows * columns
        const totalParams = inserts.reduce((s, c) => s + c.params.length, 0);
        assert.equal(totalParams, 5 * COLUMNS.length);
    });

    test('throws without an executor', async () => {
        await assert.rejects(() => load_snapshot([], {}), /requires an executor/);
    });

    test('on_progress fires at the configured cadence with (loaded, total)', async () => {
        const { executor } = fake_executor();
        const records = Array.from({ length: 25 }, (_, i) => rec(String(i + 1), 'Bob', 'Smith'));
        const marks = [];
        await load_snapshot(records, {
            executor, batch_size: 1, progress_every: 10,
            on_progress: (loaded, total) => marks.push(`${loaded}/${total}`),
        });
        assert.deepEqual(marks, ['10/25', '20/25']); // fires crossing 10 and 20
    });

    test('skips Bulk header artifacts (Id==="Id"), blank Ids, and duplicate Ids', async () => {
        const { executor, calls } = fake_executor();
        const records = [
            rec('1', 'Bob', 'Smith'),
            { Id: 'Id', FirstName: 'FirstName', LastName: 'LastName' }, // Bulk CSV header leak
            rec('1', 'Bob', 'Smith'),                                   // duplicate Id
            rec('2', 'Jane', 'Doe'),
            { Id: '', FirstName: 'x' },                                  // blank Id
        ];
        const loaded = await load_snapshot(records, { executor, batch_size: 10 });
        assert.equal(loaded, 2); // only ids '1' and '2'
        const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO'));
        const totalRows = inserts.reduce((s, c) => s + c.params.length, 0) / COLUMNS.length;
        assert.equal(totalRows, 2);
    });
});


describe('record_from_row (DB -> record shape)', () => {
    test('round-trips the raw fields from to_snapshot_row', () => {
        const r = rec('1', 'Bob', 'Smith');
        const row = to_snapshot_row(r);
        const dbRow = {};
        COLUMNS.forEach((col, i) => { dbRow[col] = row[i]; });
        const back = record_from_row(dbRow);
        for (const f of ['Id', 'FirstName', 'LastName', 'cfg_Gender_Identity__pc', 'PersonBirthdate',
                         'BillingPostalCode', 'PersonMailingPostalCode', 'cfg_Member_Number__pc',
                         'usat_Salesforce_Merge_Id__pc', 'usat_Foundation_Constituent__c']) {
            assert.equal(back[f], r[f] || '');
        }
    });

    test('null DB values become empty strings', () => {
        const back = record_from_row({ salesforce_account_id: '9', first_name: null, last_name: null });
        assert.equal(back.FirstName, '');
        assert.equal(back.LastName, '');
        assert.equal(back.Id, '9');
    });
});

describe('read_records', () => {
    test('SELECTs the raw columns and maps each row to a record', async () => {
        const captured = [];
        const executor = async (sql, params) => {
            captured.push(sql);
            return [
                { salesforce_account_id: '1', first_name: 'Bob', last_name: 'Smith', gender_identity: 'Male',
                  person_birthdate: '1990-01-01', billing_postal_code: '80301', person_mailing_postal_code: '',
                  member_number: 'm1', salesforce_merge_id: 'mg1', foundation_constituent: '' },
            ];
        };
        const records = await read_records(executor);
        assert.ok(captured[0].startsWith('SELECT'));
        assert.equal(records.length, 1);
        assert.equal(records[0].FirstName, 'Bob');
        assert.equal(records[0].cfg_Gender_Identity__pc, 'Male');
    });
});

describe('count_rows', () => {
    test('returns the COUNT(*) value as a number', async () => {
        const executor = async () => [{ n: 42 }];
        assert.equal(await count_rows(executor), 42);
    });
});

describe('snapshot meta table', () => {
    test('write_meta drops, creates, and inserts one row with the right params', async () => {
        const { executor, calls } = fake_executor();
        await write_meta(executor, {
            fetched_at: '2026-06-12T00:00:00Z', mode: 'test', is_full: false, is_partial: true,
            max_fetch: 5000, record_count: 4, salesforce_total_size: 9,
        });
        assert.equal(calls.length, 3);
        assert.ok(calls[0].sql.startsWith('DROP TABLE'));
        assert.ok(calls[1].sql.startsWith('CREATE TABLE'));
        assert.ok(calls[2].sql.startsWith('INSERT INTO'));
        // params: fetched_at, mode, is_full(0), is_partial(1), max_fetch, record_count, total
        assert.deepEqual(calls[2].params, ['2026-06-12T00:00:00Z', 'test', 0, 1, 5000, 4, 9]);
    });

    test('read_meta returns the normalized row, or null when missing', async () => {
        const present = async () => [{ fetched_at: 'x', mode: 'prod', is_full: 1, is_partial: 0,
                                       max_fetch: 1000000, record_count: 700000, salesforce_total_size: 700000 }];
        const meta = await read_meta(present);
        assert.equal(meta.mode, 'prod');
        assert.equal(meta.is_full, true);
        assert.equal(meta.record_count, 700000);

        const empty = async () => [];
        assert.equal(await read_meta(empty), null);

        const missingTable = async () => { throw new Error("Table 'x' doesn't exist"); };
        assert.equal(await read_meta(missingTable), null);
    });
});
