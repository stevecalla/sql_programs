/**
 * file_output.test.js — Verifies the CSV output + archive rotation logic.
 *
 * Covers src/output_files.js (it never logs into Salesforce, so it's fast and
 * free to run). Specifically it asserts:
 *
 *   1. The module exports the file helpers.
 *   2. add_timestamp_to_filename() puts the date/time stamp at the END of
 *      the name, just before the .csv extension.
 *   3. write_csv() writes a real CSV into the directory it's given and
 *      returns the full path.
 *   4. archive_previous_output_files() rotates correctly:
 *        - clears the archive folder first,
 *        - moves the previous run's files from output -> archive,
 *        - leaves only the newest run in the output folder.
 *
 * The rotation test runs against isolated *_test folders inside the /data
 * path (passed in via the function's optional args), so it never touches
 * the real usat_salesforce_duplicates output.
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/file_output.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sf = require('../src/output_files.js');
const { create_directory } = require('../../../utilities/createDirectory');
const { OUTPUT_DIR_NAME, ARCHIVE_DIR_NAME } = require('../config');

// Isolated folder names so the test never touches real production output.
const TEST_OUTPUT_DIR_NAME = 'usat_salesforce_duplicates__test';
const TEST_ARCHIVE_DIR_NAME = 'usat_salesforce_duplicates__test_archive';

function list_csvs(dir) {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
}

describe('exports', () => {
    test('module exposes the file helpers + config dir names', () => {
        assert.equal(typeof sf.add_timestamp_to_filename, 'function');
        assert.equal(typeof sf.write_csv, 'function');
        assert.equal(typeof sf.archive_previous_output_files, 'function');
        assert.equal(typeof OUTPUT_DIR_NAME, 'string');
        assert.equal(typeof ARCHIVE_DIR_NAME, 'string');
    });
});

describe('add_timestamp_to_filename', () => {
    const stamp = '2026-06-04_14-30-05';

    test('appends the stamp at the end, before the .csv extension', () => {
        assert.equal(
            sf.add_timestamp_to_filename('account_duplicates_sf_import.csv', stamp),
            'account_duplicates_sf_import_2026-06-04_14-30-05.csv'
        );
    });

    test('works for all three real output names and keeps .csv last', () => {
        for (const name of [
            'account_duplicates_sf_import.csv',
            'account_fuzzy_name_matches_sf_import.csv',
            'account_fuzzy_name_groups_sf_import.csv',
        ]) {
            const out = sf.add_timestamp_to_filename(name, stamp);
            assert.ok(out.endsWith('.csv'), `should keep .csv extension: ${out}`);
            assert.ok(
                out.includes(`_${stamp}.csv`),
                `stamp should sit at the end before .csv: ${out}`
            );
        }
    });
});

describe('write_csv', () => {
    test('writes a CSV into the given dir and returns the full path', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdup-'));
        try {
            const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
            const written = await sf.write_csv(dir, 'sample.csv', rows);

            assert.equal(written, path.join(dir, 'sample.csv'));
            assert.ok(fs.existsSync(written), 'file should exist');

            const text = fs.readFileSync(written, 'utf8');
            assert.ok(text.includes('a,b'), 'header row should be present');
            assert.ok(text.includes('1,x'), 'first data row should be present');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('archive_previous_output_files rotation', () => {
    test('clears archive, moves prior run to archive, keeps newest in output', async () => {
        // Resolve the isolated test dirs (also creates them).
        const output_dir = await create_directory(TEST_OUTPUT_DIR_NAME);
        const archive_dir = await create_directory(TEST_ARCHIVE_DIR_NAME);

        // Start from a clean slate in case a prior failed run left files.
        for (const dir of [output_dir, archive_dir]) {
            for (const f of list_csvs(dir)) fs.rmSync(path.join(dir, f));
        }

        // RUN 1
        await sf.archive_previous_output_files(TEST_OUTPUT_DIR_NAME, TEST_ARCHIVE_DIR_NAME);
        await sf.write_csv(output_dir, 'run1.csv', [{ k: 'run1' }]);
        assert.deepEqual(list_csvs(output_dir), ['run1.csv']);
        assert.deepEqual(list_csvs(archive_dir), []);

        // RUN 2 — run1 moves to archive; output cleared.
        await sf.archive_previous_output_files(TEST_OUTPUT_DIR_NAME, TEST_ARCHIVE_DIR_NAME);
        assert.deepEqual(list_csvs(archive_dir), ['run1.csv']);
        assert.deepEqual(list_csvs(output_dir), []);

        await sf.write_csv(output_dir, 'run2.csv', [{ k: 'run2' }]);
        assert.deepEqual(list_csvs(output_dir), ['run2.csv']);

        // RUN 3 — archive cleared first, so only the most recent run survives.
        await sf.archive_previous_output_files(TEST_OUTPUT_DIR_NAME, TEST_ARCHIVE_DIR_NAME);
        assert.deepEqual(list_csvs(archive_dir), ['run2.csv']);
        assert.deepEqual(list_csvs(output_dir), []);

        // Cleanup the isolated test folders entirely.
        fs.rmSync(output_dir, { recursive: true, force: true });
        fs.rmSync(archive_dir, { recursive: true, force: true });
    });
});
