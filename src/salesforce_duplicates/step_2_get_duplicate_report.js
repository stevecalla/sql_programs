/**
 * step_2_get_duplicate_report.js — Locate the latest duplicate-output CSVs and
 * summarize them, for the Slack server's stats / reporting endpoints.
 *
 * Returns the same { file_directory, file_path, ... } shape the Slack upload
 * utilities expect, plus row counts and the age (in minutes) of the newest
 * output file (used by the server's "run vs. latest" freshness logic).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { determineOSPath } = require('../../utilities/determineOSPath');
const {
    OUTPUT_DIR_NAME,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
} = require('./config');

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
        // newest first by mtime, then by name (filenames carry a sortable
        // timestamp) as a deterministic tiebreaker when mtimes are equal.
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

const SELECTORS = {
    exact: EXACT_OUTPUT_FILE,
    fuzzy_pair: FUZZY_PAIR_OUTPUT_FILE,
    fuzzy_group: FUZZY_GROUP_OUTPUT_FILE,
};

// Gather the latest report.
//   file_selector  - 'all' (default) | 'exact' | 'fuzzy_pair' | 'fuzzy_group'
//   file_directory - optional override (defaults to the /data output dir);
//                    mainly for tests.
// Returns { file_directory, file_path, counts, age_minutes, has_output, latest_names }.
async function execute_get_duplicate_report(file_selector = 'all', file_directory = null) {
    if (!file_directory) {
        const os_path = await determineOSPath();
        file_directory = path.join(os_path, OUTPUT_DIR_NAME);
    }

    const latest = {
        exact: find_latest_by_base(file_directory, SELECTORS.exact),
        fuzzy_pair: find_latest_by_base(file_directory, SELECTORS.fuzzy_pair),
        fuzzy_group: find_latest_by_base(file_directory, SELECTORS.fuzzy_group),
    };

    const counts = {
        exact: latest.exact ? count_data_rows(latest.exact.full) : 0,
        fuzzy_pair: latest.fuzzy_pair ? count_data_rows(latest.fuzzy_pair.full) : 0,
        fuzzy_group: latest.fuzzy_group ? count_data_rows(latest.fuzzy_group.full) : 0,
    };

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

    return { file_directory, file_path, counts, age_minutes, has_output, latest_names };
}

module.exports = {
    execute_get_duplicate_report,
    find_latest_by_base,
    count_data_rows,
};
