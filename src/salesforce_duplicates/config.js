/**
 * config.js — Central configuration for the Salesforce duplicates tool.
 *
 * All tunable constants, output file names, and folder names live here so
 * they can be adjusted in one place and imported by both the entry script
 * and the src/ modules.
 */

'use strict';

const TEST_MAX_FETCH = 5_000;
const PROD_MAX_FETCH = 1_000_000;

// Resolve the run mode from command-line flags. This is cross-platform — it
// works identically in PowerShell, cmd, and bash because the flag is passed
// as a normal process argument (no shell-specific env-var syntax needed):
//   node step_1_find_duplicates.js --test   -> true  (dev sandbox, capped fetch)
//   node step_1_find_duplicates.js --prod   -> false (production, full fetch)
//   node step_1_find_duplicates.js          -> false (defaults to production)
// The resolved boolean is passed into main(is_test); nothing reads process.env
// for mode selection.
function resolve_is_test(argv = process.argv) {
    if (argv.includes("--test")) return true;
    if (argv.includes("--prod") || argv.includes("--production")) return false;
    return false;
}

const FUZZY_THRESHOLD = 90;
const PROGRESS_LOG_EVERY_RECORDS = 1_000;
const PROGRESS_LOG_EVERY_PAIRS = 25_0000;

// When a reporting request asks to "run" but the most recent output files are
// younger than this many minutes, the server returns the latest files instead
// of re-running the full Salesforce pipeline (avoids hammering Salesforce).
const FRESH_OUTPUT_WINDOW_MINUTES = 30;

const EXACT_OUTPUT_FILE = "account_duplicates_sf_import.csv";
const FUZZY_PAIR_OUTPUT_FILE = "account_fuzzy_name_matches_sf_import.csv";
const FUZZY_GROUP_OUTPUT_FILE = "account_fuzzy_name_groups_sf_import.csv";

const OUTPUT_DIR_NAME = "usat_salesforce_duplicates";
const ARCHIVE_DIR_NAME = "usat_salesforce_duplicates_archive";

// Per-run summary (total records scanned, counts, timestamps) lives in its own
// meta folder — NOT the output folder — so it is never swept into the Slack
// file uploads, and is overwritten each run (always reflects the latest run).
const META_DIR_NAME = "usat_salesforce_duplicates_meta";
const RUN_SUMMARY_FILE = "run_summary.json";

// Human-reviewable record of how composite ZIPs were trimmed to 5 digits
// (raw -> trimmed -> count). Lives in the meta folder alongside the run summary
// so it is never swept into the Slack file uploads. Overwritten each run.
const ZIP_TRIM_MAPPING_FILE = "zip_trim_mapping.csv";

const REVIEW_STATUS_DEFAULT = "New";

module.exports = {
    resolve_is_test,
    TEST_MAX_FETCH,
    PROD_MAX_FETCH,
    FUZZY_THRESHOLD,
    PROGRESS_LOG_EVERY_RECORDS,
    PROGRESS_LOG_EVERY_PAIRS,
    FRESH_OUTPUT_WINDOW_MINUTES,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
    OUTPUT_DIR_NAME,
    ARCHIVE_DIR_NAME,
    META_DIR_NAME,
    RUN_SUMMARY_FILE,
    ZIP_TRIM_MAPPING_FILE,
    REVIEW_STATUS_DEFAULT,
};
