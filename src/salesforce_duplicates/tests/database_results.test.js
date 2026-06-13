/**
 * database_results.test.js — Phase 3 run table (no live MySQL; fake executor).
 *   node --test tests/database_results.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    RUN_COLUMNS,
    create_run_table_sql,
    run_row_params,
    write_run,
    read_latest_run,
    write_result_table,
    write_all_result_tables,
} = require('../src/database_results');

function fake_executor() {
    const calls = [];
    const executor = async (sql, params) => { calls.push({ sql, params }); return []; };
    return { executor, calls };
}

describe('create_run_table_sql', () => {
    test('is CREATE IF NOT EXISTS (accumulates) with a run_id primary key', () => {
        const sql = create_run_table_sql();
        assert.ok(/CREATE TABLE IF NOT EXISTS `salesforce_duplicate_detection_run`/.test(sql));
        assert.ok(sql.includes('PRIMARY KEY (run_id)'));
    });
});

describe('run_row_params', () => {
    test('maps a run object to params in column order; counts default to null', () => {
        const params = run_row_params({
            run_id: 'r1', run_type: 'finder', mode: 'test', is_full: false, is_partial: true,
            run_at: '2026-06-12T00:00:00Z', total_records_scanned: 5000, salesforce_total_size: 695828,
            exact_duplicate_groups: 48, fuzzy_pair_matches: 5, fuzzy_groups: 5,
            nickname_pair_matches: 9, nickname_groups: 9, consolidated_clusters: 62,
        });
        assert.equal(params.length, RUN_COLUMNS.length);
        assert.equal(params[RUN_COLUMNS.indexOf('run_id')], 'r1');
        assert.equal(params[RUN_COLUMNS.indexOf('is_partial')], 1);
        assert.equal(params[RUN_COLUMNS.indexOf('exact_duplicate_groups')], 48);
    });

    test('missing detection counts become null (snapshot-only run)', () => {
        const params = run_row_params({ run_id: 's1', run_type: 'snapshot', mode: 'prod', total_records_scanned: 700000 });
        assert.equal(params[RUN_COLUMNS.indexOf('exact_duplicate_groups')], null);
        assert.equal(params[RUN_COLUMNS.indexOf('consolidated_clusters')], null);
        assert.equal(params[RUN_COLUMNS.indexOf('total_records_scanned')], 700000);
    });
});

describe('write_run', () => {
    test('ensures the table then REPLACE INTO with all columns', async () => {
        const { executor, calls } = fake_executor();
        await write_run(executor, { run_id: 'r1', run_type: 'finder', exact_duplicate_groups: 48 });
        assert.equal(calls.length, 2);
        assert.ok(calls[0].sql.startsWith('CREATE TABLE IF NOT EXISTS'));
        assert.ok(calls[1].sql.startsWith('REPLACE INTO'));
        assert.equal(calls[1].params.length, RUN_COLUMNS.length);
    });
});

describe('read_latest_run', () => {
    test('returns the newest row (normalized booleans), or null when empty/missing', async () => {
        const present = async () => [{ run_id: 'r1', run_type: 'finder', mode: 'test', is_full: 0, is_partial: 1,
            run_at: 'x', total_records_scanned: 5000, salesforce_total_size: 1, exact_duplicate_groups: 48,
            fuzzy_pair_matches: 5, fuzzy_groups: 5, nickname_pair_matches: 9, nickname_groups: 9, consolidated_clusters: 62 }];
        const run = await read_latest_run(present);
        assert.equal(run.run_id, 'r1');
        assert.equal(run.is_partial, true);
        assert.equal(run.is_full, false);
        assert.equal(run.exact_duplicate_groups, 48);

        assert.equal(await read_latest_run(async () => []), null);
        assert.equal(await read_latest_run(async () => { throw new Error("Table 'x' doesn't exist"); }), null);
    });

    test('reads ordered by run_at DESC limit 1', async () => {
        let captured;
        await read_latest_run(async (sql) => { captured = sql; return []; });
        assert.ok(/ORDER BY run_at DESC LIMIT 1/.test(captured), captured);
    });
});


describe('write_result_table (Phase 3 result tables; refresh each run)', () => {
    test('non-empty: DROP, CREATE from row keys (TEXT), batched INSERT', async () => {
        const { executor, calls } = fake_executor();
        const rows = [
            { Run_Id__c: 'r', Match_Type__c: 'exact_group', Duplicate_Count__c: 2 },
            { Run_Id__c: 'r', Match_Type__c: 'exact_group', Duplicate_Count__c: 3 },
        ];
        const n = await write_result_table(executor, 'salesforce_duplicate_exact_group', rows, { batch_size: 10 });
        assert.equal(n, 2);
        assert.ok(calls[0].sql.startsWith('DROP TABLE IF EXISTS'));
        assert.ok(calls[1].sql.startsWith('CREATE TABLE'));
        assert.ok(/`Run_Id__c` TEXT/.test(calls[1].sql));
        assert.ok(/`Duplicate_Count__c` TEXT/.test(calls[1].sql));
        const insert = calls[2];
        assert.ok(insert.sql.startsWith('INSERT INTO'));
        assert.equal(insert.params.length, 2 * 3); // 2 rows * 3 columns
        assert.equal(insert.params[0], 'r');
    });

    test('empty view: DROP only, no CREATE, returns 0', async () => {
        const { executor, calls } = fake_executor();
        const n = await write_result_table(executor, 'salesforce_duplicate_nickname_pair', []);
        assert.equal(n, 0);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].sql.startsWith('DROP TABLE IF EXISTS'));
    });

    test('batches large result sets', async () => {
        const { executor, calls } = fake_executor();
        const rows = Array.from({ length: 5 }, (_, i) => ({ a: String(i), b: 'x' }));
        await write_result_table(executor, 't', rows, { batch_size: 2 });
        const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO'));
        assert.equal(inserts.length, 3); // 2 + 2 + 1
    });
});

describe('write_all_result_tables', () => {
    test('writes all six per-view tables and returns per-table counts', async () => {
        const { executor, calls } = fake_executor();
        const counts = await write_all_result_tables(executor, {
            exact_group: [{ a: '1' }],
            fuzzy_pair: [{ a: '1' }, { a: '2' }],
            fuzzy_group: [],
            nickname_pair: [{ a: '1' }],
            nickname_group: [],
            consolidated: [{ a: '1' }, { a: '2' }, { a: '3' }],
        });
        const tables = Object.keys(counts);
        assert.equal(tables.length, 6);
        assert.equal(counts['salesforce_duplicate_exact_group'], 1);
        assert.equal(counts['salesforce_duplicate_fuzzy_pair'], 2);
        assert.equal(counts['salesforce_duplicate_fuzzy_group'], 0);
        assert.equal(counts['salesforce_duplicate_consolidated_cluster'], 3);
        // every table is dropped (refresh), even the empty ones
        const drops = calls.filter((c) => c.sql.startsWith('DROP TABLE'));
        assert.equal(drops.length, 6);
    });
});
