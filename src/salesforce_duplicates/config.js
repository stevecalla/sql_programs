/**
 * config.js — Central configuration for the Salesforce duplicates tool.
 *
 * All tunable constants, output file names, and folder names live here so
 * they can be adjusted in one place and imported by both the entry script
 * and the src/ modules.
 */

'use strict';

// Defaults to false (production). The menu / shell can override per run by
// setting SF_DUP_IS_TEST="true" (dev sandbox, capped fetch) or "false".
const IS_TEST = process.env.SF_DUP_IS_TEST !== undefined
    ? process.env.SF_DUP_IS_TEST === "true"
    : false;

const MAX_FETCH = IS_TEST ? 5_000 : 1_000_000;
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
    IS_TEST,
    MAX_FETCH,
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
