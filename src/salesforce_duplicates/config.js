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
//   node sf_duplicates_060326.js --test   -> true  (dev sandbox, capped fetch)
//   node sf_duplicates_060326.js --prod   -> false (production, full fetch)
//   node sf_duplicates_060326.js          -> false (defaults to production)
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

const EXACT_OUTPUT_FILE = "account_duplicates_sf_import.csv";
const FUZZY_PAIR_OUTPUT_FILE = "account_fuzzy_name_matches_sf_import.csv";
const FUZZY_GROUP_OUTPUT_FILE = "account_fuzzy_name_groups_sf_import.csv";

const OUTPUT_DIR_NAME = "usat_salesforce_duplicates";
const ARCHIVE_DIR_NAME = "usat_salesforce_duplicates_archive";

const REVIEW_STATUS_DEFAULT = "New";

module.exports = {
    resolve_is_test,
    TEST_MAX_FETCH,
    PROD_MAX_FETCH,
    FUZZY_THRESHOLD,
    PROGRESS_LOG_EVERY_RECORDS,
    PROGRESS_LOG_EVERY_PAIRS,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
    OUTPUT_DIR_NAME,
    ARCHIVE_DIR_NAME,
    REVIEW_STATUS_DEFAULT,
};
