const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const jsforce = require("jsforce");
const fs = require("fs");
const path = require("path");
const csv = require("fast-csv");
const crypto = require("crypto");

const { determineOSPath } = require("../../utilities/determineOSPath");
const { create_directory } = require("../../utilities/createDirectory");
const { getCurrentDateTimeForFileNaming } = require("../../utilities/getCurrentDate");

const {
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
} = require("./config");

const { colorize, log_info, log_success, log_warn, log_error } = require("./src/log");
const { format_duration, format_timestamp_utc, format_timestamp_mtn } = require("./src/fmt");
const {
    unique_join,
    composite_zip,
    make_full_name,
    make_clean_full_name,
    make_exact_duplicate_key,
    make_rule_key,
    has_required_rule_fields,
} = require("./src/normalize");
const {
    similarity_score,
    get_rule_flags,
    get_fuzzy_match_reason,
} = require("./src/matcher");
const { build_fuzzy_groups } = require("./src/grouping");

// Append a date/time stamp to the end of a file name, before its extension.
// e.g. ("account_duplicates_sf_import.csv", "2026-06-04_14-30-05")
//   -> "account_duplicates_sf_import_2026-06-04_14-30-05.csv"
function add_timestamp_to_filename(file_name, timestamp) {
    const ext = path.extname(file_name);
    const base = path.basename(file_name, ext);
    return `${base}_${timestamp}${ext}`;
}

function make_run_id(date = new Date()) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");

    return `duplicate_run_${yyyy}_${mm}_${dd}_${hh}${mi}${ss}`;
}

function make_hash(value) {
    return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function make_external_id(run_id, match_type, unique_value) {
    return `${run_id}|${match_type}|${make_hash(unique_value)}`;
}

async function write_csv(output_dir, file_name, rows) {
    const full_path = path.join(output_dir, file_name);

    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(full_path);

        ws.on("error", reject);
        ws.on("finish", resolve);

        csv
            .write(rows, { headers: true })
            .on("error", reject)
            .pipe(ws);
    });

    return full_path;
}

// Archive prior run output before writing new files.
// Mirrors the usat_sales_data convention (see src/sales_data/step_1_get_sales_data.js):
// 1. delete existing csvs in the archive folder
// 2. move existing csvs from the output folder into the archive folder
// Returns the output directory path for the current run's files.
async function archive_previous_output_files(output_dir_name = OUTPUT_DIR_NAME, archive_dir_name = ARCHIVE_DIR_NAME) {
    const output_dir = await create_directory(output_dir_name);
    const archive_dir = await create_directory(archive_dir_name);

    // 1. DELETE EXISTING FILES IN ARCHIVE
    for (const file of fs.readdirSync(archive_dir)) {
        if (file.endsWith(".csv")) {
            fs.rmSync(path.join(archive_dir, file));
        }
    }

    // 2. MOVE CURRENT OUTPUT FILES TO ARCHIVE
    for (const file of fs.readdirSync(output_dir)) {
        if (file.endsWith(".csv")) {
            fs.renameSync(path.join(output_dir, file), path.join(archive_dir, file));
        }
    }

    return output_dir;
}

function log_exact_duplicate_exclusion_summary(exact_duplicate_groups, exact_duplicate_record_ids) {
    const duplicate_group_size_summary = exact_duplicate_groups.reduce((acc, group) => {
        const size = group.record_ids.length;
        acc[size] = (acc[size] || 0) + 1;
        return acc;
    }, {});

    log_info("Exact duplicate exclusion summary:");

    console.table({
        exact_duplicate_groups: exact_duplicate_groups.length,
        exact_duplicate_record_ids_excluded_from_fuzzy: exact_duplicate_record_ids.size,
    });

    console.table(
        Object.entries(duplicate_group_size_summary).map(([duplicate_count, group_count]) => ({
            duplicate_count: Number(duplicate_count),
            group_count,
            total_records: Number(duplicate_count) * group_count,
        }))
    );
}

function log_fuzzy_candidate_filter_summary({
    base_records_fetched,
    exact_duplicate_record_ids_excluded,
    records_after_exact_exclusion,
    records_excluded_missing_rule_fields,
    final_fuzzy_candidate_records,
}) {
    log_info("Fuzzy candidate filter summary:");

    console.table({
        base_records_fetched,
        exact_duplicate_record_ids_excluded,
        records_after_exact_exclusion,
        records_excluded_missing_gender_birthdate_or_zip: records_excluded_missing_rule_fields,
        final_fuzzy_candidate_records,
    });
}

function log_rule_block_summary(rule_blocks) {
    const summary = [...rule_blocks.entries()]
        .map(([rule_key, rows]) => ({
            rule_key,
            record_count: rows.length,
            estimated_pair_comparisons: (rows.length * (rows.length - 1)) / 2,
        }))
        .sort((a, b) => b.estimated_pair_comparisons - a.estimated_pair_comparisons)
        .slice(0, 20);

    log_info("Top fuzzy rule blocks by estimated pair comparisons:");
    console.table(summary);
}

function to_sf_exact_row({
    row,
    row_number,
    run_id,
    created_at_mtn,
    created_at_utc,
    script_start_date,
    query_start_date,
    query_end_date,
    query_duration_ms,
    source_file_name,
}) {
    return {
        Run_Id__c: run_id,
        External_Id__c: make_external_id(run_id, "exact_group", row.duplicate_key),
        Match_Type__c: "exact_group",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),

        Duplicate_Logic__c:
            "exact first_name + exact last_name + exact gender + exact birthdate + exact composite_zip",

        Last_Name__c: row.last_name,
        First_Name__c: row.first_name,
        Gender__c: row.gender,
        Birthdate__c: row.birthdate,
        Composite_Zip__c: row.composite_zip,
        Duplicate_Count__c: row.duplicate_count,
        Record_Ids__c: row.record_ids.join(";"),
        Member_Numbers__c: row.member_numbers.join(";"),
        Foundation_Constituent_Values__c: unique_join(row.foundation_constituents),

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

function to_sf_fuzzy_pair_row({
    row,
    row_number,
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
    source_file_name,
}) {
    return {
        Run_Id__c: run_id,
        External_Id__c: make_external_id(run_id, "fuzzy_pair", `${row.record_id_1}|${row.record_id_2}`),
        Match_Type__c: "fuzzy_pair",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),
        Fuzzy_Start_Time__c: format_timestamp_utc(fuzzy_start_date),
        Fuzzy_End_Time__c: format_timestamp_utc(fuzzy_end_date),
        Fuzzy_Duration__c: format_duration(fuzzy_duration_ms),

        Rule_Key__c: row.rule_key,
        Fuzzy_Threshold__c: row.fuzzy_threshold,

        Fuzzy_Match_Reason__c: row.fuzzy_match_reason,
        Name_Difference_Reason__c: row.name_difference_reason,
        First_Name_Difference_Reason__c: row.first_name_difference_reason,
        Last_Name_Difference_Reason__c: row.last_name_difference_reason,
        Rule_Match_Reason__c: row.rule_match_reason,

        Match_Score_Combined_Name__c: row.match_score_combined_name,
        Match_Score_First_Name__c: row.match_score_first_name,
        Match_Score_Last_Name__c: row.match_score_last_name,

        Exact_Clean_First_Name_Match_Flag__c: row.exact_clean_first_name_match_flag,
        Exact_Clean_Last_Name_Match_Flag__c: row.exact_clean_last_name_match_flag,
        Same_Gender_Flag__c: row.same_gender_flag,
        Same_Birthdate_Flag__c: row.same_birthdate_flag,
        Same_Composite_Zip_Flag__c: row.same_composite_zip_flag,
        Strict_Rule_Match_Flag__c: row.strict_rule_match_flag,
        Rule_Match_Count__c: row.rule_match_count,

        Account_1__c: row.record_id_1,
        Member_Number_1__c: row.member_number_1,
        First_Name_1__c: row.first_name_1,
        Last_Name_1__c: row.last_name_1,
        Full_Name_1__c: row.full_name_1,
        Clean_Full_Name_1__c: row.clean_full_name_1,
        Gender_1__c: row.gender_1,
        Birthdate_1__c: row.birthdate_1,
        Composite_Zip_1__c: row.composite_zip_1,
        Billing_Zip_1__c: row.billing_zip_1,
        Mailing_Zip_1__c: row.mailing_zip_1,
        Foundation_Constituent_1__c: row.foundation_constituent_1,

        Account_2__c: row.record_id_2,
        Member_Number_2__c: row.member_number_2,
        First_Name_2__c: row.first_name_2,
        Last_Name_2__c: row.last_name_2,
        Full_Name_2__c: row.full_name_2,
        Clean_Full_Name_2__c: row.clean_full_name_2,
        Gender_2__c: row.gender_2,
        Birthdate_2__c: row.birthdate_2,
        Composite_Zip_2__c: row.composite_zip_2,
        Billing_Zip_2__c: row.billing_zip_2,
        Mailing_Zip_2__c: row.mailing_zip_2,
        Foundation_Constituent_2__c: row.foundation_constituent_2,

        Not_In_Exact_Duplicate_File_Flag__c: row.not_in_exact_duplicate_file_flag,
        Fuzzy_Match_Logic__c: row.fuzzy_match_logic,

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

function to_sf_fuzzy_group_row({
    row,
    row_number,
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
    source_file_name,
}) {
    return {
        Run_Id__c: run_id,
        External_Id__c: make_external_id(run_id, "fuzzy_group", row.fuzzy_group_key),
        Match_Type__c: "fuzzy_group",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),
        Fuzzy_Start_Time__c: format_timestamp_utc(fuzzy_start_date),
        Fuzzy_End_Time__c: format_timestamp_utc(fuzzy_end_date),
        Fuzzy_Duration__c: format_duration(fuzzy_duration_ms),

        Fuzzy_Group_Key__c: row.fuzzy_group_key,
        Group_Record_Count__c: row.group_record_count,
        Shared_Gender__c: row.shared_gender,
        Shared_Birthdate__c: row.shared_birthdate,
        Shared_Composite_Zip__c: row.shared_composite_zip,

        Names_In_Group__c: row.names_in_group,
        Clean_Names_In_Group__c: row.clean_names_in_group,
        Record_Ids__c: row.record_ids,
        Member_Numbers__c: row.member_numbers,
        Foundation_Constituents__c: row.foundation_constituents,

        Best_Pair_Score__c: row.best_pair_score,
        Lowest_Pair_Score__c: row.lowest_pair_score,
        Fuzzy_Pair_Count_In_Group__c: row.fuzzy_pair_count_in_group,
        Fuzzy_Pair_Summary__c: row.fuzzy_pair_summary,
        Fuzzy_Group_Logic__c: row.fuzzy_group_logic,

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

async function main(is_test = resolve_is_test()) {
    const script_start_date = new Date();
    const script_start_ms = Date.now();

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

    const conn = new jsforce.Connection({
        loginUrl: is_test ? process.env.SF_DEV_LOGIN_URL : process.env.SF_PROD_LOGIN_URL,
    });

    log_info("Logging into Salesforce...", script_start_ms);

    await conn.login(
        is_test ? process.env.SF_DEV_USERNAME : process.env.SF_PROD_USERNAME,
        is_test ?
            process.env.SF_DEV_PASSWORD + process.env.SF_DEV_SECURITY_TOKEN :
            process.env.SF_PROD_PASSWORD + process.env.SF_PROD_SECURITY_TOKEN
    );

    log_success("Login successful.", script_start_ms);

    const soql = `
        SELECT Id,
            LastName,
            FirstName,
            cfg_Member_Number__pc,
            cfg_Gender_Identity__pc,
            usat_Foundation_Constituent__c,
            PersonBirthdate,
            BillingPostalCode,
            PersonMailingPostalCode
        FROM Account
        WHERE FirstName != null
        AND LastName != null
        ORDER BY LastName, FirstName, Id
    `;

    const query_start_date = new Date();
    const query_start_ms = Date.now();

    log_info("Running Salesforce query...", script_start_ms);

    const result = await conn.query(soql).execute({
        autoFetch: true,
        maxFetch: max_fetch,
    });

    const query_end_date = new Date();
    const query_duration_ms = Date.now() - query_start_ms;

    log_success("Salesforce query complete.", query_start_ms);

    console.log(`Query start time: ${format_timestamp_utc(query_start_date)}`);
    console.log(`Query end time: ${format_timestamp_utc(query_end_date)}`);
    console.log(`Query duration: ${format_duration(query_duration_ms)}`);
    console.log(`Salesforce total matching records: ${result.totalSize}`);
    console.log(`Records actually fetched: ${result.records.length}`);

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

    const exact_start_ms = Date.now();
    const exact_groups = new Map();

    log_info("Grouping records for exact duplicate detection...", script_start_ms);

    for (let i = 0; i < result.records.length; i++) {
        const row = result.records[i];
        const key = make_exact_duplicate_key(row);

        if (!exact_groups.has(key)) {
            exact_groups.set(key, {
                duplicate_key: key,
                last_name: row.LastName,
                first_name: row.FirstName,
                gender: row.cfg_Gender_Identity__pc,
                birthdate: row.PersonBirthdate,
                composite_zip: composite_zip(row),
                duplicate_count: 0,
                record_ids: [],
                member_numbers: [],
                foundation_constituents: [],
            });
        }

        const group = exact_groups.get(key);

        group.duplicate_count += 1;
        group.record_ids.push(row.Id);

        if (row.cfg_Member_Number__pc) {
            group.member_numbers.push(row.cfg_Member_Number__pc);
        }

        if (row.usat_Foundation_Constituent__c) {
            group.foundation_constituents.push(row.usat_Foundation_Constituent__c);
        }

        if ((i + 1) % PROGRESS_LOG_EVERY_RECORDS === 0) {
            const pct = (((i + 1) / result.records.length) * 100).toFixed(1);
            log_info(`Exact grouping progress: ${i + 1}/${result.records.length} records (${pct}%)`, exact_start_ms);
        }
    }

    log_success("Exact duplicate grouping complete.", exact_start_ms);

    const exact_duplicate_groups = [...exact_groups.values()]
        .filter((g) => g.duplicate_count > 1)
        .sort((a, b) => {
            if (b.duplicate_count !== a.duplicate_count) {
                return b.duplicate_count - a.duplicate_count;
            }

            const last_name_compare = String(a.last_name || "").localeCompare(String(b.last_name || ""));
            if (last_name_compare !== 0) return last_name_compare;

            return String(a.first_name || "").localeCompare(String(b.first_name || ""));
        });

    const exact_duplicate_record_ids = new Set();

    for (const group of exact_duplicate_groups) {
        for (const record_id of group.record_ids) {
            exact_duplicate_record_ids.add(record_id);
        }
    }

    log_exact_duplicate_exclusion_summary(exact_duplicate_groups, exact_duplicate_record_ids);

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

    const fuzzy_start_date = new Date();
    const fuzzy_start_ms = Date.now();

    log_info("Building fuzzy + strict rule-based match file...", script_start_ms);

    const records_after_exact_exclusion = result.records.filter(
        (row) => !exact_duplicate_record_ids.has(row.Id)
    );

    const fuzzy_candidate_records = records_after_exact_exclusion.filter((row) => {
        return has_required_rule_fields(row);
    });

    const records_excluded_missing_rule_fields =
        records_after_exact_exclusion.length - fuzzy_candidate_records.length;

    log_fuzzy_candidate_filter_summary({
        base_records_fetched: result.records.length,
        exact_duplicate_record_ids_excluded: exact_duplicate_record_ids.size,
        records_after_exact_exclusion: records_after_exact_exclusion.length,
        records_excluded_missing_rule_fields,
        final_fuzzy_candidate_records: fuzzy_candidate_records.length,
    });

    const rule_blocks = new Map();

    for (let i = 0; i < fuzzy_candidate_records.length; i++) {
        const row = fuzzy_candidate_records[i];
        const rule_key = make_rule_key(row);

        if (!rule_blocks.has(rule_key)) {
            rule_blocks.set(rule_key, []);
        }

        rule_blocks.get(rule_key).push(row);

        if ((i + 1) % PROGRESS_LOG_EVERY_RECORDS === 0) {
            const pct = (((i + 1) / fuzzy_candidate_records.length) * 100).toFixed(1);
            log_info(
                `Fuzzy rule block build progress: ${i + 1}/${fuzzy_candidate_records.length} records (${pct}%)`,
                fuzzy_start_ms
            );
        }
    }

    log_success(`Fuzzy rule block build complete. Blocks created: ${rule_blocks.size}`, fuzzy_start_ms);
    log_rule_block_summary(rule_blocks);

    const fuzzy_matches = [];
    const seen_fuzzy_pairs = new Set();

    let pairs_compared = 0;
    let pairs_skipped_exact_clean_name = 0;
    let pairs_skipped_below_threshold = 0;
    let pairs_skipped_not_strict_rule = 0;
    let blocks_processed = 0;

    log_info("Starting fuzzy comparisons...", fuzzy_start_ms);

    for (const [rule_key, block_rows] of rule_blocks.entries()) {
        blocks_processed += 1;

        if (block_rows.length < 2) continue;

        for (let i = 0; i < block_rows.length; i++) {
            for (let j = i + 1; j < block_rows.length; j++) {
                pairs_compared += 1;

                const row_a = block_rows[i];
                const row_b = block_rows[j];

                const pair_key = [row_a.Id, row_b.Id].sort().join("|");
                if (seen_fuzzy_pairs.has(pair_key)) continue;
                seen_fuzzy_pairs.add(pair_key);

                const first_name_score = similarity_score(row_a.FirstName, row_b.FirstName);
                const last_name_score = similarity_score(row_a.LastName, row_b.LastName);

                const exact_clean_first_name_match = first_name_score === 100;
                const exact_clean_last_name_match = last_name_score === 100;

                if (exact_clean_first_name_match && exact_clean_last_name_match) {
                    pairs_skipped_exact_clean_name += 1;
                    continue;
                }

                const match_score_combined_name = Math.round(
                    first_name_score * 0.45 + last_name_score * 0.55
                );

                if (match_score_combined_name < FUZZY_THRESHOLD) {
                    pairs_skipped_below_threshold += 1;
                    continue;
                }

                const rule_flags = get_rule_flags(row_a, row_b);

                if (rule_flags.strict_rule_match_flag !== 1) {
                    pairs_skipped_not_strict_rule += 1;
                    continue;
                }

                const fuzzy_reasons = get_fuzzy_match_reason({
                    row_a,
                    row_b,
                    first_name_score,
                    last_name_score,
                    combined_name_score: match_score_combined_name,
                    rule_flags,
                });

                fuzzy_matches.push({
                    rule_key,
                    fuzzy_threshold: FUZZY_THRESHOLD,

                    fuzzy_match_reason: fuzzy_reasons.fuzzy_match_reason,
                    name_difference_reason: fuzzy_reasons.name_difference_reason,
                    first_name_difference_reason: fuzzy_reasons.first_name_difference_reason,
                    last_name_difference_reason: fuzzy_reasons.last_name_difference_reason,
                    rule_match_reason: fuzzy_reasons.rule_match_reason,

                    match_score_combined_name,
                    match_score_first_name: first_name_score,
                    match_score_last_name: last_name_score,
                    exact_clean_first_name_match_flag: exact_clean_first_name_match ? 1 : 0,
                    exact_clean_last_name_match_flag: exact_clean_last_name_match ? 1 : 0,
                    ...rule_flags,

                    record_id_1: row_a.Id,
                    member_number_1: row_a.cfg_Member_Number__pc,
                    first_name_1: row_a.FirstName,
                    last_name_1: row_a.LastName,
                    full_name_1: make_full_name(row_a),
                    clean_full_name_1: make_clean_full_name(row_a),
                    gender_1: row_a.cfg_Gender_Identity__pc,
                    birthdate_1: row_a.PersonBirthdate,
                    composite_zip_1: composite_zip(row_a),
                    billing_zip_1: row_a.BillingPostalCode,
                    mailing_zip_1: row_a.PersonMailingPostalCode,
                    foundation_constituent_1: row_a.usat_Foundation_Constituent__c,

                    record_id_2: row_b.Id,
                    member_number_2: row_b.cfg_Member_Number__pc,
                    first_name_2: row_b.FirstName,
                    last_name_2: row_b.LastName,
                    full_name_2: make_full_name(row_b),
                    clean_full_name_2: make_clean_full_name(row_b),
                    gender_2: row_b.cfg_Gender_Identity__pc,
                    birthdate_2: row_b.PersonBirthdate,
                    composite_zip_2: composite_zip(row_b),
                    billing_zip_2: row_b.BillingPostalCode,
                    mailing_zip_2: row_b.PersonMailingPostalCode,
                    foundation_constituent_2: row_b.usat_Foundation_Constituent__c,

                    not_in_exact_duplicate_file_flag: 1,
                    fuzzy_match_logic:
                        "fuzzy first/last name score >= threshold AND same gender AND same birthdate AND same composite_zip AND not exact same cleaned name",
                });

                if (fuzzy_matches.length % 100 === 0) {
                    log_info(`Fuzzy matches found so far: ${fuzzy_matches.length.toLocaleString()}`, fuzzy_start_ms);
                }

                if (pairs_compared % PROGRESS_LOG_EVERY_PAIRS === 0) {
                    log_info(
                        `Fuzzy compare progress: ${pairs_compared.toLocaleString()} pairs compared, ${fuzzy_matches.length.toLocaleString()} matches found, ${blocks_processed}/${rule_blocks.size} blocks processed`,
                        fuzzy_start_ms
                    );
                }
            }
        }
    }

    log_success(`Fuzzy comparison complete. Pair matches found: ${fuzzy_matches.length.toLocaleString()}`, fuzzy_start_ms);

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

    const script_end_date = new Date();
    const script_duration_ms = Date.now() - script_start_ms;

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
    console.log(`Total records scanned: ${result.records.length}`);
    console.log(`Salesforce total matching records: ${result.totalSize}`);
    console.log(`Run mode: ${is_test ? "TEST (dev sandbox)" : "PRODUCTION"}`);
    console.log(`MAX_FETCH: ${max_fetch}`);
    console.log(`FUZZY_THRESHOLD: ${FUZZY_THRESHOLD}`);
    console.log(`Unique exact duplicate-check groups: ${exact_groups.size}`);
    console.log(`Exact duplicate groups found: ${exact_duplicates_sf_import.length}`);
    console.log(`Exact duplicate record IDs excluded from fuzzy files: ${exact_duplicate_record_ids.size}`);
    console.log(`Records after exact duplicate exclusion: ${records_after_exact_exclusion.length}`);
    console.log(`Records excluded from fuzzy because missing gender/birthdate/zip: ${records_excluded_missing_rule_fields}`);
    console.log(`Fuzzy candidate records scanned after exact exclusion and required-rule filters: ${fuzzy_candidate_records.length}`);
    console.log(`Fuzzy rule blocks created: ${rule_blocks.size}`);
    console.log(`Fuzzy pairs compared: ${pairs_compared.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - exact cleaned first/last name: ${pairs_skipped_exact_clean_name.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - below threshold: ${pairs_skipped_below_threshold.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - not strict gender/birthdate/zip rule: ${pairs_skipped_not_strict_rule.toLocaleString()}`);
    console.log(colorize("green", `Fuzzy pair matches found: ${fuzzy_pair_sf_import.length.toLocaleString()}`));
    console.log(colorize("green", `Fuzzy groups found: ${fuzzy_group_sf_import.length.toLocaleString()}`));
    console.log(`Exact duplicate Salesforce import output written to: ${exact_output_path}`);
    console.log(`Fuzzy pair Salesforce import output written to: ${fuzzy_pair_output_path}`);
    console.log(`Fuzzy group Salesforce import output written to: ${fuzzy_group_output_path}`);
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
    add_timestamp_to_filename,
    write_csv,
    archive_previous_output_files,
    OUTPUT_DIR_NAME,
    ARCHIVE_DIR_NAME,
};