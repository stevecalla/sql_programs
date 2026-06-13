/**
 * step_2_get_duplicate_report.js — Locate the latest duplicate-output CSVs and
 * summarize them, for the Slack server's stats / reporting endpoints.
 *
 * Counts come from the DATABASE (the unified run logbook salesforce_duplicate_detection_run)
 * when the SQL backbone is on, instead of counting CSV rows / reading run_summary.json —
 * so the stats link to SQL, not hard files. If the DB is unavailable it falls back to the
 * files, so the report never breaks. The CSV file paths are still located here because the
 * Slack uploads send the actual files (you can't attach a DB table to Slack).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { determineOSPath } = require('../../utilities/determineOSPath');
const {
    OUTPUT_DIR_NAME,
    META_DIR_NAME,
    RUN_SUMMARY_FILE,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
} = require('./config');
const { open_local_executor } = require('./src/database_snapshot');
const { read_latest_run } = require('./src/database_results');

// Base filenames carry a timestamp before the extension, e.g.
// account_duplicates_sf_import_2026-06-04_14-30-05.csv. Match on the
// "<base>_" prefix and return the most recent one.
function find_latest_by_base(file_directory, base_filename) {
    const ext = path.extname(base_filename);
    const prefix = path.basename(base_filename, ext) + '_';

    if (!fs.existsSync(file_directory)) return null;

    const matches = fs.readdirSync(file_directory)
        .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
        .map((f) => {
            const full = path.join(file_directory, f);
            return { name: f, full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));

    return matches[0] || null;
}

// Count data rows in a CSV (total lines minus the header).
function count_data_rows(full_path) {
    const text = fs.readFileSync(full_path, 'utf8');
    if (!text.trim()) return 0;
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    return Math.max(0, lines.length - 1);
}

// Read the per-run summary JSON from the meta dir (or null if absent). Kept as the
// fallback for total-records when the DB is unavailable.
function read_run_summary(meta_dir) {
    const full = path.join(meta_dir, RUN_SUMMARY_FILE);
    if (!fs.existsSync(full)) return null;
    try {
        return JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
        return null;
    }
}

// Read the latest FINDER run row from the unified logbook. Returns null if the DB/table
// is unavailable, so the report falls back to the files and never breaks.
async function read_latest_finder_run() {
    try {
        const { pool, executor } = await open_local_executor();
        try {
            return await read_latest_run(executor, { run_type: 'finder' });
        } finally {
            try { pool.end(); } catch (_) { /* ignore */ }
        }
    } catch {
        return null;
    }
}

const SELECTORS = {
    exact: EXACT_OUTPUT_FILE,
    fuzzy_pair: FUZZY_PAIR_OUTPUT_FILE,
    fuzzy_group: FUZZY_GROUP_OUTPUT_FILE,
};

// Gather the latest report.
//   file_selector  - 'all' (default) | 'exact' | 'fuzzy_pair' | 'fuzzy_group'
//   file_directory - optional override for the CSV output dir (tests)
//   meta_dir       - optional override for the run-summary dir (tests)
//   { read_db }    - injectable latest-finder-run reader (tests pass a stub)
// Returns { file_directory, file_path, counts, counts_source, age_minutes, has_output,
//           latest_names, total_records_scanned, salesforce_total_size }.
async function execute_get_duplicate_report(file_selector = 'all', file_directory = null, meta_dir = null, { read_db = read_latest_finder_run } = {}) {
    if (!file_directory || !meta_dir) {
        const os_path = await determineOSPath();
        if (!file_directory) file_directory = path.join(os_path, OUTPUT_DIR_NAME);
        if (!meta_dir) meta_dir = path.join(os_path, META_DIR_NAME);
    }

    const latest = {
        exact: find_latest_by_base(file_directory, SELECTORS.exact),
        fuzzy_pair: find_latest_by_base(file_directory, SELECTORS.fuzzy_pair),
        fuzzy_group: find_latest_by_base(file_directory, SELECTORS.fuzzy_group),
    };

    // Counts: prefer the DB logbook (latest finder run); fall back to counting the CSVs.
    const db_run = await read_db();
    const counts = db_run ? {
        exact: Number(db_run.exact_duplicate_groups ?? 0),
        fuzzy_pair: Number(db_run.fuzzy_pair_matches ?? 0),
        fuzzy_group: Number(db_run.fuzzy_groups ?? 0),
    } : {
        exact: latest.exact ? count_data_rows(latest.exact.full) : 0,
        fuzzy_pair: latest.fuzzy_pair ? count_data_rows(latest.fuzzy_pair.full) : 0,
        fuzzy_group: latest.fuzzy_group ? count_data_rows(latest.fuzzy_group.full) : 0,
    };
    const counts_source = db_run ? 'database' : 'files';

    const mtimes = Object.values(latest).filter(Boolean).map((x) => x.mtime);
    const has_output = mtimes.length > 0;
    const age_minutes = has_output ? (Date.now() - Math.max(...mtimes)) / 60000 : null;

    // For a specific selector, return that single file path; for 'all', leave
    // file_path null so the upload utility sends every file in the directory.
    let file_path = null;
    if (file_selector && file_selector !== 'all' && latest[file_selector]) {
        file_path = latest[file_selector].full;
    }

    const latest_names = {
        exact: latest.exact ? latest.exact.name : null,
        fuzzy_pair: latest.fuzzy_pair ? latest.fuzzy_pair.name : null,
        fuzzy_group: latest.fuzzy_group ? latest.fuzzy_group.name : null,
    };

    const summary = read_run_summary(meta_dir);
    const total_records_scanned = db_run ? (db_run.total_records_scanned ?? null) : (summary?.total_records_scanned ?? null);
    const salesforce_total_size = db_run ? (db_run.salesforce_total_size ?? null) : (summary?.salesforce_total_size ?? null);

    return {
        file_directory,
        file_path,
        counts,
        counts_source,
        age_minutes,
        has_output,
        latest_names,
        total_records_scanned,
        salesforce_total_size,
    };
}

module.exports = {
    execute_get_duplicate_report,
    find_latest_by_base,
    count_data_rows,
    read_run_summary,
    read_latest_finder_run,
};
