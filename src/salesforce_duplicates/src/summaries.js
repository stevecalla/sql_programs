/**
 * summaries.js — Final run-summary block printed at the end of a run.
 *
 * Pure formatting/printing; takes the already-computed counts and timings.
 */

'use strict';

const { colorize } = require('./log');
const { format_duration, format_timestamp_utc } = require('./fmt');

function log_run_summary({
    run_id,
    script_start_date,
    script_end_date,
    script_duration_ms,
    query_start_date,
    query_end_date,
    query_duration_ms,
    fuzzy_start_date,
    fuzzy_end_date,
    fuzzy_duration_ms,
    created_at_mtn,
    created_at_utc,
    total_records_scanned,
    salesforce_total_size,
    is_test,
    max_fetch,
    fuzzy_threshold,
    exact_groups_size,
    exact_duplicate_groups_found,
    exact_duplicate_record_ids_excluded,
    records_after_exact_exclusion_count,
    records_excluded_missing_rule_fields,
    fuzzy_candidate_records_count,
    rule_blocks_created,
    pairs_compared,
    pairs_skipped_exact_clean_name,
    pairs_skipped_below_threshold,
    pairs_skipped_not_strict_rule,
    fuzzy_pair_matches_found,
    fuzzy_groups_found,
    exact_output_path,
    fuzzy_pair_output_path,
    fuzzy_group_output_path,
}) {
    console.log("");
    console.log(colorize("bright", "Summary"));
    console.log(colorize("bright", "-------"));
    console.log(`run_id: ${run_id}`);
    console.log(`Script start time: ${format_timestamp_utc(script_start_date)}`);
    console.log(`Script end time: ${format_timestamp_utc(script_end_date)}`);
    console.log(`Script duration: ${format_duration(script_duration_ms)}`);
    console.log(`Query start time: ${format_timestamp_utc(query_start_date)}`);
    console.log(`Query end time: ${format_timestamp_utc(query_end_date)}`);
    console.log(`Query duration: ${format_duration(query_duration_ms)}`);
    console.log(`Fuzzy start time: ${format_timestamp_utc(fuzzy_start_date)}`);
    console.log(`Fuzzy end time: ${format_timestamp_utc(fuzzy_end_date)}`);
    console.log(`Fuzzy duration: ${format_duration(fuzzy_duration_ms)}`);
    console.log(`created_at_mtn: ${created_at_mtn}`);
    console.log(`created_at_utc: ${created_at_utc}`);
    console.log(`Total records scanned: ${total_records_scanned}`);
    console.log(`Salesforce total matching records: ${salesforce_total_size}`);
    console.log(`Run mode: ${is_test ? "TEST (dev sandbox)" : "PRODUCTION"}`);
    console.log(`MAX_FETCH: ${max_fetch}`);
    console.log(`FUZZY_THRESHOLD: ${fuzzy_threshold}`);
    console.log(`Unique exact duplicate-check groups: ${exact_groups_size}`);
    console.log(`Exact duplicate groups found: ${exact_duplicate_groups_found}`);
    console.log(`Exact duplicate record IDs excluded from fuzzy files: ${exact_duplicate_record_ids_excluded}`);
    console.log(`Records after exact duplicate exclusion: ${records_after_exact_exclusion_count}`);
    console.log(`Records excluded from fuzzy because missing gender/birthdate/zip: ${records_excluded_missing_rule_fields}`);
    console.log(`Fuzzy candidate records scanned after exact exclusion and required-rule filters: ${fuzzy_candidate_records_count}`);
    console.log(`Fuzzy rule blocks created: ${rule_blocks_created}`);
    console.log(`Fuzzy pairs compared: ${pairs_compared.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - exact cleaned first/last name: ${pairs_skipped_exact_clean_name.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - below threshold: ${pairs_skipped_below_threshold.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - not strict gender/birthdate/zip rule: ${pairs_skipped_not_strict_rule.toLocaleString()}`);
    console.log(colorize("green", `Fuzzy pair matches found: ${fuzzy_pair_matches_found.toLocaleString()}`));
    console.log(colorize("green", `Fuzzy groups found: ${fuzzy_groups_found.toLocaleString()}`));
    console.log(`Exact duplicate Salesforce import output written to: ${exact_output_path}`);
    console.log(`Fuzzy pair Salesforce import output written to: ${fuzzy_pair_output_path}`);
    console.log(`Fuzzy group Salesforce import output written to: ${fuzzy_group_output_path}`);
}

module.exports = { log_run_summary };
