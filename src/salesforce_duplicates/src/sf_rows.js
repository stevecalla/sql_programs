/**
 * sf_rows.js — Maps internal exact/fuzzy result rows to the Salesforce import
 * schema (the *__c custom fields). This is the layer that changes whenever the
 * Salesforce object's fields change.
 */

'use strict';

const { REVIEW_STATUS_DEFAULT } = require('../config');
const { format_timestamp_utc, format_duration } = require('./fmt');
const { unique_join } = require('./normalize');
const { make_external_id } = require('./ids');

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
        Merge_Ids__c: row.merge_ids.join(";"),
        Foundation_Constituent_Values__c: row.foundation_constituents.join(";"),

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
        Merge_Id_1__c: row.merge_id_1,
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
        Merge_Id_2__c: row.merge_id_2,
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
        Merge_Ids__c: row.merge_ids,
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

// Nickname single-signal view (c). Mirrors the fuzzy-pair schema, with the
// nickname-specific flags/reason. Review-only for now, but the columns follow
// the Salesforce __c naming convention so a future import is plug-and-play.
function to_sf_nickname_row({
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
        External_Id__c: make_external_id(run_id, "nickname_pair", `${row.record_id_1}|${row.record_id_2}`),
        Match_Type__c: "nickname_pair",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),

        Rule_Key__c: row.rule_key,
        Match_Path__c: row.match_path,
        Nickname_Match_Reason__c: row.nickname_match_reason,

        Match_Score_Combined_Name__c: row.combined_name_score,
        Match_Score_First_Name__c: row.first_name_score,
        Match_Score_Last_Name__c: row.last_name_score,

        Nickname_Match_Flag__c: row.nickname_match_flag,
        Spelling_Match_Flag__c: row.spelling_match_flag,
        Also_Clears_Fuzzy_Flag__c: row.also_clears_fuzzy_flag,
        In_Exact_Group_Flag__c: row.in_exact_group_flag,

        Account_1__c: row.record_id_1,
        Member_Number_1__c: row.member_number_1,
        Merge_Id_1__c: row.merge_id_1,
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
        Merge_Id_2__c: row.merge_id_2,
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

        Nickname_Logic__c: row.nickname_logic,

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

// Consolidated reconciled view (d) — one row per cluster, with provenance flags
// and a confidence tier. This is the authoritative output. Review-only for now;
// columns use __c naming for a possible future import.
function to_sf_consolidated_row({
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
        External_Id__c: make_external_id(run_id, "consolidated_cluster", row.consolidated_group_key),
        Match_Type__c: "consolidated_cluster",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),

        Consolidated_Group_Key__c: row.consolidated_group_key,
        Group_Record_Count__c: row.group_record_count,
        Confidence_Tier__c: row.confidence_tier,
        Match_Composition__c: row.match_composition,

        Has_Exact_Flag__c: row.has_exact_flag,
        Has_Fuzzy_Flag__c: row.has_fuzzy_flag,
        Has_Nickname_Flag__c: row.has_nickname_flag,
        Exact_Link_Count__c: row.exact_link_count,
        Fuzzy_Link_Count__c: row.fuzzy_link_count,
        Nickname_Link_Count__c: row.nickname_link_count,
        Match_Link_Count__c: row.match_link_count,

        Shared_Gender__c: row.shared_gender,
        Shared_Birthdate__c: row.shared_birthdate,
        Shared_Composite_Zip__c: row.shared_composite_zip,

        Names_In_Group__c: row.names_in_group,
        Clean_Names_In_Group__c: row.clean_names_in_group,
        Record_Ids__c: row.record_ids,
        Member_Numbers__c: row.member_numbers,
        Merge_Ids__c: row.merge_ids,
        Foundation_Constituents__c: row.foundation_constituents,

        Best_Pair_Score__c: row.best_pair_score,
        Lowest_Pair_Score__c: row.lowest_pair_score,
        Representative_Pair__c: row.representative_pair,
        Match_Link_Reasons__c: row.match_link_reasons,
        Consolidated_Logic__c: row.consolidated_logic,

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

// Nickname group view — clusters of nickname pairs. Mirrors the fuzzy-group
// schema (Match_Type__c = "nickname_group"). Review-only; SF __c naming.
function to_sf_nickname_group_row({
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
        External_Id__c: make_external_id(run_id, "nickname_group", row.nickname_group_key),
        Match_Type__c: "nickname_group",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row_number,
        Run_Start_Time__c: format_timestamp_utc(script_start_date),
        Query_Start_Time__c: format_timestamp_utc(query_start_date),
        Query_End_Time__c: format_timestamp_utc(query_end_date),
        Query_Duration__c: format_duration(query_duration_ms),

        Nickname_Group_Key__c: row.nickname_group_key,
        Group_Record_Count__c: row.group_record_count,
        Shared_Gender__c: row.shared_gender,
        Shared_Birthdate__c: row.shared_birthdate,
        Shared_Composite_Zip__c: row.shared_composite_zip,

        Names_In_Group__c: row.names_in_group,
        Clean_Names_In_Group__c: row.clean_names_in_group,
        Record_Ids__c: row.record_ids,
        Member_Numbers__c: row.member_numbers,
        Merge_Ids__c: row.merge_ids,
        Foundation_Constituents__c: row.foundation_constituents,

        Best_Pair_Score__c: row.best_pair_score,
        Lowest_Pair_Score__c: row.lowest_pair_score,
        Nickname_Pair_Count_In_Group__c: row.nickname_pair_count_in_group,
        Nickname_Pair_Summary__c: row.nickname_pair_summary,
        Nickname_Group_Logic__c: row.nickname_group_logic,

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

// Merge ID review (QA) — one row per reviewed account. Review-only; columns use the
// __c naming convention for consistency with the other views. See plans_and_notes/README_MERGE_ID_REVIEW.md.
function to_sf_merge_id_review_row({
    row,
    run_id,
    created_at_mtn,
    created_at_utc,
    source_file_name,
}) {
    return {
        Run_Id__c: run_id,
        External_Id__c: make_external_id(run_id, "merge_id_review", row.account_id),
        Match_Type__c: "merge_id_review",
        Source_File_Name__c: source_file_name,
        Review_Status__c: REVIEW_STATUS_DEFAULT,

        Row_Number__c: row.row_num,
        Account__c: row.account_id,
        Bucket__c: row.bucket,
        Salesforce_Merge_Id__c: row.salesforce_merge_id,
        Which_List__c: row.which_list,
        First_Name__c: row.first_name,
        Last_Name__c: row.last_name,
        Foundation_Constituent__c: row.foundation_constituent,
        Consolidated_Group_Key__c: row.cluster_key,
        Merge_Id_Review_Logic__c:
            "account compared to its Salesforce merge ID: in_both / sf_only, or named by which signal flagged it (exact/fuzzy/nickname/multi)",

        Created_At_Mtn__c: created_at_mtn,
        Created_At_Utc__c: created_at_utc,
    };
}

module.exports = {
    to_sf_exact_row,
    to_sf_fuzzy_pair_row,
    to_sf_fuzzy_group_row,
    to_sf_nickname_row,
    to_sf_consolidated_row,
    to_sf_nickname_group_row,
    to_sf_merge_id_review_row,
};
