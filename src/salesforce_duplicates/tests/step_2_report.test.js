/**
 * step_2_report.test.js — Unit tests for step_2_get_duplicate_report.js and
 * step_2a_create_duplicate_message.js. Uses temp dirs (no /data dependency).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/step_2_report.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    execute_get_duplicate_report,
    find_latest_by_base,
    count_data_rows,
} = require('../step_2_get_duplicate_report');
const { create_duplicate_message } = require('../step_2a_create_duplicate_message');

function make_fixture_dir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdup-report-'));
    fs.writeFileSync(path.join(dir, 'account_duplicates_sf_import_2026-06-04_10-00-00.csv'), 'a,b\n1,x\n2,y');           // 2 rows
    fs.writeFileSync(path.join(dir, 'account_fuzzy_name_matches_sf_import_2026-06-04_10-00-00.csv'), 'a,b\n1,x');       // 1 row
    fs.writeFileSync(path.join(dir, 'account_fuzzy_name_groups_sf_import_2026-06-04_10-00-00.csv'), 'a,b');             // 0 rows (header only)
    return dir;
}

function make_meta_dir(total_records_scanned) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdup-meta-'));
    fs.writeFileSync(path.join(dir, 'run_summary.json'), JSON.stringify({ total_records_scanned, salesforce_total_size: 695827 }));
    return dir;
}

describe('count_data_rows', () => {
    test('counts lines minus header; empty file is 0', () => {
        const dir = make_fixture_dir();
        try {
            assert.equal(count_data_rows(path.join(dir, 'account_duplicates_sf_import_2026-06-04_10-00-00.csv')), 2);
            assert.equal(count_data_rows(path.join(dir, 'account_fuzzy_name_groups_sf_import_2026-06-04_10-00-00.csv')), 0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('find_latest_by_base', () => {
    test('picks the most recent match for a base name', () => {
        const dir = make_fixture_dir();
        try {
            fs.writeFileSync(path.join(dir, 'account_duplicates_sf_import_2026-06-04_12-00-00.csv'), 'a,b\n1,x\n2,y\n3,z');
            const latest = find_latest_by_base(dir, 'account_duplicates_sf_import.csv');
            assert.equal(latest.name, 'account_duplicates_sf_import_2026-06-04_12-00-00.csv');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('execute_get_duplicate_report', () => {
    // DB unavailable -> fall back to counting the CSV files (read_db stub returns null).
    const no_db = { read_db: async () => null };

    test('DB unavailable: falls back to file counts + run_summary (counts_source=files)', async () => {
        const dir = make_fixture_dir();
        const meta = make_meta_dir(5000);
        try {
            const all = await execute_get_duplicate_report('all', dir, meta, no_db);
            assert.equal(all.has_output, true);
            assert.equal(all.counts_source, 'files');
            assert.deepEqual(all.counts, { exact: 2, fuzzy_pair: 1, fuzzy_group: 0 });
            assert.equal(all.file_path, null);                 // 'all' uploads the whole dir
            assert.equal(all.total_records_scanned, 5000);     // from run_summary.json
            assert.ok(all.age_minutes >= 0 && all.age_minutes < 5);

            const exact = await execute_get_duplicate_report('exact', dir, meta, no_db);
            assert.ok(exact.file_path.endsWith('account_duplicates_sf_import_2026-06-04_10-00-00.csv'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(meta, { recursive: true, force: true });
        }
    });

    test('DB available: counts + records come from the logbook (counts_source=database)', async () => {
        const dir = make_fixture_dir();   // files have 2/1/0; DB should override them
        const meta = make_meta_dir(5000);
        const read_db = async () => ({
            exact_duplicate_groups: 48, fuzzy_pair_matches: 5, fuzzy_groups: 5,
            total_records_scanned: 695828, salesforce_total_size: 695828,
        });
        try {
            const all = await execute_get_duplicate_report('all', dir, meta, { read_db });
            assert.equal(all.counts_source, 'database');
            assert.deepEqual(all.counts, { exact: 48, fuzzy_pair: 5, fuzzy_group: 5 });
            assert.equal(all.total_records_scanned, 695828);
            assert.equal(all.salesforce_total_size, 695828);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(meta, { recursive: true, force: true });
        }
    });

    test('missing dirs -> has_output false, zero counts, null scanned', async () => {
        const out = await execute_get_duplicate_report(
            'all',
            path.join(os.tmpdir(), 'sfdup-no-out-xyz'),
            path.join(os.tmpdir(), 'sfdup-no-meta-xyz'),
            no_db
        );
        assert.equal(out.has_output, false);
        assert.deepEqual(out.counts, { exact: 0, fuzzy_pair: 0, fuzzy_group: 0 });
        assert.equal(out.age_minutes, null);
        assert.equal(out.total_records_scanned, null);
    });
});

describe('create_duplicate_message', () => {
    test('includes total records scanned, counts, and the generated-ago line', () => {
        const { main_message_text } = create_duplicate_message(
            { exact: 2, fuzzy_pair: 1, fuzzy_group: 0 },
            { file_selector: 'all', age_minutes: 3, mode: 'latest', regenerated: false, total_records_scanned: 695827 }
        );
        assert.ok(main_message_text.includes('Total records scanned: 695,827'));
        assert.ok(main_message_text.includes('Exact duplicate groups: 2'));
        assert.ok(main_message_text.includes('Fuzzy name pair matches: 1'));
        assert.ok(main_message_text.includes('Generated 3 min ago'));
    });

    test('mode=run that returned latest -> clear ⚠️ warning + force option', () => {
        const { main_message_text, warning } = create_duplicate_message(
            { exact: 2, fuzzy_pair: 1, fuzzy_group: 0 },
            { mode: 'run', regenerated: false, age_minutes: 5, fresh_window_minutes: 30 }
        );
        assert.ok(warning, 'warning should be set');
        assert.ok(warning.startsWith('⚠️'), 'warning should lead with ⚠️');
        assert.ok(warning.includes('30 min'), 'warning mentions the window');
        assert.ok(warning.includes('mode=run force=true'), 'warning shows the force option');
        assert.ok(main_message_text.includes('EXISTING files'), 'warning is in the message body');
    });

    test('freshly regenerated -> no warning', () => {
        const { main_message_text, warning } = create_duplicate_message(
            { exact: 2, fuzzy_pair: 1, fuzzy_group: 0 },
            { mode: 'run', regenerated: true, fresh_window_minutes: 30 }
        );
        assert.equal(warning, null);
        assert.ok(main_message_text.includes('Freshly regenerated'));
        assert.ok(!main_message_text.includes('force=true'));
    });

    test('no output -> guidance message, null warning', () => {
        const { main_message_text, warning } = create_duplicate_message({}, { has_output: false });
        assert.equal(warning, null);
        assert.ok(main_message_text.includes('No Salesforce duplicate output'));
    });
});
