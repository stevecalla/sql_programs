const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const { getCurrentDateTimeForFileNaming } = require("../../utilities/getCurrentDate");

const {
    resolve_is_test,
    TEST_MAX_FETCH,
    PROD_MAX_FETCH,
    FUZZY_THRESHOLD,
    EXACT_OUTPUT_FILE,
    FUZZY_PAIR_OUTPUT_FILE,
    FUZZY_GROUP_OUTPUT_FILE,
} = require("./config");

const { colorize, log_info, log_success, log_warn, log_error } = require("./src/log");
const { format_timestamp_utc, format_timestamp_mtn } = require("./src/fmt");
const { build_fuzzy_groups } = require("./src/grouping");
const { make_run_id } = require("./src/ids");
const { create_step_timer } = require("./src/step_timer");
const { add_timestamp_to_filename, write_csv, archive_previous_output_files, write_run_summary, write_zip_trim_mapping } = require("./src/output_files");
const { to_sf_exact_row, to_sf_fuzzy_pair_row, to_sf_fuzzy_group_row } = require("./src/sf_rows");
const { fetch_salesforce_accounts } = require("./src/salesforce");
const { build_zip_trim_mapping } = require("./src/zip_trim");
const { detect_exact_duplicates } = require("./src/exact");
const { run_fuzzy_matching } = require("./src/fuzzy");
const { log_run_summary, log_zip_trim_summary } = require("./src/summaries");

async function main(is_test = resolve_is_test()) {
    const script_start_date = new Date();
    const script_start_ms = Date.now();
    const timer = create_step_timer(); // per-step stopwatch (live + end timeline)

    const max_fetch = is_test ? TEST_MAX_FETCH : PROD_MAX_FETCH;

    const run_id = make_run_id(script_start_date);
    const created_at_mtn = format_timestamp_mtn(script_start_date);
    const created_at_utc = format_timestamp_utc(script_start_date);

    log_info("Script started.");
    log_info(`run_id: ${run_id}`);
    log_info(`Run mode: ${is_test ? "TEST (dev sandbox)" : "PRODUCTION"}`);
    log_info(`MAX_FETCH: ${max_fetch}`);
    log_info(`FUZZY_THRESHOLD: ${FUZZY_THRESHOLD}`);
    log_info(`created_at_mtn: ${created_at_mtn}`);
    log_info(`created_at_utc: ${created_at_utc}`);

    // ARCHIVE PRIOR OUTPUT AND PREPARE THIS RUN'S TIMESTAMPED FILE NAMES
    log_info("Archiving previous output files...", script_start_ms);
    const output_dir = await archive_previous_output_files();
    const file_timestamp = getCurrentDateTimeForFileNaming();
    const exact_output_file = add_timestamp_to_filename(EXACT_OUTPUT_FILE, file_timestamp);
    const fuzzy_pair_output_file = add_timestamp_to_filename(FUZZY_PAIR_OUTPUT_FILE, file_timestamp);
    const fuzzy_group_output_file = add_timestamp_to_filename(FUZZY_GROUP_OUTPUT_FILE, file_timestamp);
    log_success(`Output directory ready: ${output_dir}`, script_start_ms);
    timer.stage_done("archive prior outputs");

    const { result, query_start_date, query_end_date, query_duration_ms } =
        await fetch_salesforce_accounts({ is_test, max_fetch, script_start_ms });
    timer.stage_done("fetch from Salesforce");

    if (result.records.length === 0) {
        log_warn("No records returned. Ending script.");
        return;
    }

    if (result.records.length >= max_fetch) {
        log_warn(`Run stopped at MAX_FETCH=${max_fetch}. Use --prod (or increase the limit) for a full run.`);
    }

    const record_lookup = new Map();

    for (const row of result.records) {
        record_lookup.set(row.Id, row);
    }

    // Composite ZIPs are normalized to their first five digits (see
    // src/normalize.js -> trim_zip5). Build a reviewable raw -> trimmed mapping
    // and write it to the meta folder so the trim can be audited after the run.
    const zip_trim = build_zip_trim_mapping(result.records);
    const zip_trim_mapping_path = await write_zip_trim_mapping(zip_trim.mapping);

    const { exact_groups_size, exact_duplicate_groups, exact_duplicate_record_ids } =
        detect_exact_duplicates(result.records, { script_start_ms });

    const exact_duplicates_sf_import = exact_duplicate_groups.map((row, index) =>
        to_sf_exact_row({
            row,
            row_number: index + 1,
            run_id,
            created_at_mtn,
            created_at_utc,
            script_start_date,
            query_start_date,
            query_end_date,
            query_duration_ms,
            source_file_name: exact_output_file,
        })
    );

    log_info(`Writing Salesforce exact duplicate import file to ${exact_output_file}...`, script_start_ms);
    const exact_output_path = await write_csv(output_dir, exact_output_file, exact_duplicates_sf_import);
    log_success(`Salesforce exact duplicate import file written: ${exact_output_path}`, script_start_ms);
    timer.stage_done("exact duplicates");

    const fuzzy_start_date = new Date();
    const fuzzy_start_ms = Date.now();

    log_info("Building fuzzy + strict rule-based match file...", script_start_ms);

    const {
        records_after_exact_exclusion,
        fuzzy_candidate_records,
        records_excluded_missing_rule_fields,
        rule_blocks,
        fuzzy_matches,
        pairs_compared,
        pairs_skipped_exact_clean_name,
        pairs_skipped_below_threshold,
        pairs_skipped_not_strict_rule,
    } = run_fuzzy_matching(result.records, exact_duplicate_record_ids, { script_start_ms, fuzzy_start_ms });

    const fuzzy_end_date = new Date();
    const fuzzy_duration_ms = Date.now() - fuzzy_start_ms;

    const fuzzy_matches_sorted = fuzzy_matches.sort((a, b) => {
        if (b.match_score_combined_name !== a.match_score_combined_name) {
            return b.match_score_combined_name - a.match_score_combined_name;
        }

        if (b.match_score_last_name !== a.match_score_last_name) {
            return b.match_score_last_name - a.match_score_last_name;
        }

        return String(a.full_name_1 || "").localeCompare(String(b.full_name_1 || ""));
    });

    const fuzzy_pair_sf_import = fuzzy_matches_sorted.map((row, index) =>
        to_sf_fuzzy_pair_row({
            row,
            row_number: index + 1,
            run_id,
            created_at_mtn,
            created_at_utc,
            script_start_date,
            query_start_date,
            query_end_date,
            query_duration_ms,
            fuzzy_start_date,
            fuzzy_end_date,
            fuzzy_duration_ms,
            source_file_name: fuzzy_pair_output_file,
        })
    );

    log_info(`Writing Salesforce fuzzy pair import file to ${fuzzy_pair_output_file}...`, script_start_ms);
    const fuzzy_pair_output_path = await write_csv(output_dir, fuzzy_pair_output_file, fuzzy_pair_sf_import);
    log_success(`Salesforce fuzzy pair import file written: ${fuzzy_pair_output_path}`, script_start_ms);
    timer.stage_done("fuzzy matching");

    log_info("Building fuzzy grouped duplicate file...", script_start_ms);

    const fuzzy_groups_raw = build_fuzzy_groups(fuzzy_matches_sorted, record_lookup);

    const fuzzy_group_sf_import = fuzzy_groups_raw.map((row, index) =>
        to_sf_fuzzy_group_row({
            row,
            row_number: index + 1,
            run_id,
            created_at_mtn,
            created_at_utc,
            script_start_date,
            query_start_date,
            query_end_date,
            query_duration_ms,
            fuzzy_start_date,
            fuzzy_end_date,
            fuzzy_duration_ms,
            source_file_name: fuzzy_group_output_file,
        })
    );

    log_success(`Fuzzy groups built. Groups found: ${fuzzy_group_sf_import.length.toLocaleString()}`, script_start_ms);

    log_info(`Writing Salesforce fuzzy group import file to ${fuzzy_group_output_file}...`, script_start_ms);
    const fuzzy_group_output_path = await write_csv(output_dir, fuzzy_group_output_file, fuzzy_group_sf_import);
    log_success(`Salesforce fuzzy group import file written: ${fuzzy_group_output_path}`, script_start_ms);
    timer.stage_done("fuzzy groups");

    // Persist a small run summary (read back by the Slack server's report).
    await write_run_summary({
        run_id,
        created_at_utc,
        created_at_mtn,
        is_test,
        total_records_scanned: result.records.length,
        salesforce_total_size: result.totalSize,
        zip_records_trimmed: zip_trim.records_trimmed,
        zip_distinct_mappings: zip_trim.mapping.length,
        exact_duplicate_groups: exact_duplicates_sf_import.length,
        fuzzy_pair_matches: fuzzy_pair_sf_import.length,
        fuzzy_groups: fuzzy_group_sf_import.length,
    });

    const script_end_date = new Date();
    const script_duration_ms = Date.now() - script_start_ms;

    // Step-by-step timeline (largest first) — quick read on where the time went.
    timer.print_summary();

    // Reviewable composite-ZIP trim summary (raw -> trimmed -> count).
    log_zip_trim_summary(zip_trim, zip_trim_mapping_path);

    log_run_summary({
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
        total_records_scanned: result.records.length,
        salesforce_total_size: result.totalSize,
        is_test,
        max_fetch,
        fuzzy_threshold: FUZZY_THRESHOLD,
        zip_records_trimmed: zip_trim.records_trimmed,
        zip_distinct_mappings: zip_trim.mapping.length,
        exact_groups_size,
        exact_duplicate_groups_found: exact_duplicates_sf_import.length,
        exact_duplicate_record_ids_excluded: exact_duplicate_record_ids.size,
        records_after_exact_exclusion_count: records_after_exact_exclusion.length,
        records_excluded_missing_rule_fields,
        fuzzy_candidate_records_count: fuzzy_candidate_records.length,
        rule_blocks_created: rule_blocks.size,
        pairs_compared,
        pairs_skipped_exact_clean_name,
        pairs_skipped_below_threshold,
        pairs_skipped_not_strict_rule,
        fuzzy_pair_matches_found: fuzzy_pair_sf_import.length,
        fuzzy_groups_found: fuzzy_group_sf_import.length,
        exact_output_path,
        fuzzy_pair_output_path,
        fuzzy_group_output_path,
    });
}

if (require.main === module) {
    console.log(colorize("bright", "\nStarting data load."));

    main()
        .then(() => {
            log_success("Done.");
        })
        .catch((error) => {
            log_error("Error during data load:");
            console.error(error);
            process.exit(1);
        });
}

module.exports = {
    execute_get_salesforce_duplicates_data: main,
};
