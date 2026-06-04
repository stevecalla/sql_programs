/**
 * fuzzy.js — Fuzzy + strict rule-based pair matching.
 *
 * Starting from the records NOT already caught as exact duplicates, this:
 *   1. drops records missing gender/birthdate/zip,
 *   2. buckets the rest into rule blocks (same gender+birthdate+composite_zip),
 *   3. compares names within each block and keeps pairs that clear the fuzzy
 *      threshold AND match strictly on gender+birthdate+zip (but are not an
 *      exact cleaned-name match — those belong in the exact file).
 * Pure aside from progress/console logging.
 */

'use strict';

const {
    FUZZY_THRESHOLD,
    PROGRESS_LOG_EVERY_RECORDS,
    PROGRESS_LOG_EVERY_PAIRS,
} = require('../config');
const { log_info, log_success } = require('./log');
const {
    has_required_rule_fields,
    make_rule_key,
    composite_zip,
    make_full_name,
    make_clean_full_name,
} = require('./normalize');
const { similarity_score, get_rule_flags, get_fuzzy_match_reason } = require('./matcher');

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

// Run the fuzzy + strict rule-based matching pipeline.
// Returns the candidate-filter counts, the rule_blocks map, the fuzzy_matches
// array, and the pair-comparison counters used by the run summary.
function run_fuzzy_matching(records, exact_duplicate_record_ids, { script_start_ms, fuzzy_start_ms } = {}) {
    const records_after_exact_exclusion = records.filter(
        (row) => !exact_duplicate_record_ids.has(row.Id)
    );

    const fuzzy_candidate_records = records_after_exact_exclusion.filter((row) => {
        return has_required_rule_fields(row);
    });

    const records_excluded_missing_rule_fields =
        records_after_exact_exclusion.length - fuzzy_candidate_records.length;

    log_fuzzy_candidate_filter_summary({
        base_records_fetched: records.length,
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

    return {
        records_after_exact_exclusion,
        fuzzy_candidate_records,
        records_excluded_missing_rule_fields,
        rule_blocks,
        fuzzy_matches,
        pairs_compared,
        pairs_skipped_exact_clean_name,
        pairs_skipped_below_threshold,
        pairs_skipped_not_strict_rule,
    };
}

module.exports = {
    run_fuzzy_matching,
    log_fuzzy_candidate_filter_summary,
    log_rule_block_summary,
};
