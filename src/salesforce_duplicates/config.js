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

// Ceiling for a FULL dev-sandbox run (--test --full): dev login + Bulk API, but
// capped here as a guardrail. Default = same as prod (effectively "all"); lower it
// to limit how many sandbox records a full run pulls.
const TEST_FULL_MAX_FETCH = 1_000_000;

// Cap for a PRODUCTION PARTIAL run (--prod --partial): a quick capped sample of
// production so you can try the prod path (login, fields, output) before committing
// to the full ~700k pull. Uses a fast capped REST fetch.
const PROD_PARTIAL_MAX_FETCH = 5_000;

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

// --full forces a FULL fetch (Bulk API, uncapped to TEST_FULL_MAX_FETCH) regardless
// of org. Combine with --test to run ALL records against the dev sandbox.
function resolve_is_full(argv = process.argv) {
    return argv.includes("--full");
}

// --partial caps the fetch to a small REST sample regardless of org. Combine with
// --prod to TRY a production run (a small sample) before the full pull.
function resolve_is_partial(argv = process.argv) {
    return argv.includes("--partial");
}

// Single source of truth for the fetch plan, derived from the run-mode flags.
// Used by BOTH the orchestrator (max_fetch) and the Salesforce module (fetch path),
// and unit-tested, so the run-mode matrix can't silently drift.
//   max_fetch : row cap        use_rest : REST autoFetch (capped) vs Bulk API
//   ordered   : deterministic SOQL sort (only the plain --test sample)
function resolve_fetch_plan(is_test, is_full, is_partial) {
    const max_fetch = is_partial
        ? PROD_PARTIAL_MAX_FETCH
        : (is_full ? TEST_FULL_MAX_FETCH : (is_test ? TEST_MAX_FETCH : PROD_MAX_FETCH));
    const use_rest = is_partial || (is_test && !is_full);
    const ordered = is_test && !is_full && !is_partial; // deterministic SOQL only for the plain --test sample
    return { max_fetch, use_rest, use_bulk: !use_rest, ordered };
}

const FUZZY_THRESHOLD = 90;
const PROGRESS_LOG_EVERY_RECORDS = 1_000;
const PROGRESS_LOG_EVERY_PAIRS = 25_0000;

// --- Nickname matching + consolidated output (additive; see README_NICKNAME.md) ---
// Master switch for the new nickname view (c) and consolidated view (d). When
// false, the run produces only the three baseline files and behaves exactly as
// before. The three baseline files are never changed either way.
const ENABLE_NICKNAME_MATCHING = true;

// On the nickname path the first name is relaxed (Bob ~ Robert) but the last name
// must still agree: an exact cleaned match OR a fuzzy score >= this value. Keeping
// it equal to FUZZY_THRESHOLD means "nicknames relax only the first name."
const NICKNAME_LAST_NAME_MIN_SCORE = FUZZY_THRESHOLD;

// When a reporting request asks to "run" but the most recent output files are
// younger than this many minutes, the server returns the latest files instead
// of re-running the full Salesforce pipeline (avoids hammering Salesforce).
const FRESH_OUTPUT_WINDOW_MINUTES = 30;

const EXACT_OUTPUT_FILE = "account_duplicates_sf_import.csv";
const FUZZY_PAIR_OUTPUT_FILE = "account_fuzzy_name_matches_sf_import.csv";
const FUZZY_GROUP_OUTPUT_FILE = "account_fuzzy_name_groups_sf_import.csv";

// New (additive) outputs. (c) is the single-signal nickname view; its group
// companion clusters those pairs; (d) is the reconciled consolidated view (the
// authoritative file). Review-only for now, but the columns use Salesforce __c
// naming so a future import is plug-and-play.
const NICKNAME_OUTPUT_FILE = "account_nickname_name_matches_sf_import.csv";
const NICKNAME_GROUP_OUTPUT_FILE = "account_nickname_name_groups_sf_import.csv";
const CONSOLIDATED_OUTPUT_FILE = "account_consolidated_duplicates_sf_import.csv";

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

// Reviewable record of which nickname relationships fired (first-name A <-> B ->
// count), written to the meta folder alongside the ZIP-trim mapping. Lets a
// reviewer sanity-check the nickname dictionary like the ZIP trim. Overwritten
// each run.
const NICKNAME_FIRE_MAPPING_FILE = "nickname_fire_mapping.csv";

const REVIEW_STATUS_DEFAULT = "New";

module.exports = {
    resolve_is_test,
    resolve_is_full,
    resolve_is_partial,
    resolve_fetch_plan,
    TEST_MAX_FETCH,
    PROD_MAX_FETCH,
    TEST_FULL_MAX_FETCH,
    PROD_PARTIAL_MAX_FETCH,
    FUZZY_THRESHOLD,
    PROGRESS_LOG_EVERY_RECORDS,
    PROGRESS_LOG_EVERY_PAIRS,
    FRESH_OUTPUT_WINDOW_MINUTES,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
    ENABLE_NICKNAME_MATCHING,
    NICKNAME_LAST_NAME_MIN_SCORE,
    NICKNAME_OUTPUT_FILE,
    NICKNAME_GROUP_OUTPUT_FILE,
    CONSOLIDATED_OUTPUT_FILE,
    NICKNAME_FIRE_MAPPING_FILE,
    OUTPUT_DIR_NAME,
    ARCHIVE_DIR_NAME,
    META_DIR_NAME,
    RUN_SUMMARY_FILE,
    ZIP_TRIM_MAPPING_FILE,
    REVIEW_STATUS_DEFAULT,
};
