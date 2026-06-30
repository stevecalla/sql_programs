/**
 * exact.js — Exact-duplicate detection.
 *
 * Groups fetched Account records by the exact-duplicate key
 * (cleaned last + cleaned first + gender + birthdate + 5-digit composite ZIP),
 * keeps the groups with more than one record, and collects the record IDs that
 * should be excluded from fuzzy matching. Records missing any of those five
 * fields are skipped (has_required_exact_fields). Pure aside from progress/console logging.
 */

'use strict';

const { PROGRESS_LOG_EVERY_RECORDS } = require('../config');
const { log_info, log_success } = require('./log');
const { make_exact_duplicate_key, has_required_exact_fields, composite_zip } = require('./normalize');

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

// Build exact-duplicate groups from the fetched records.
// Returns:
//   exact_groups_size          - count of unique exact keys seen (all records)
//   exact_duplicate_groups     - groups with duplicate_count > 1, sorted
//   exact_duplicate_record_ids - Set of record IDs in those groups (excluded from fuzzy)
function detect_exact_duplicates(records, { script_start_ms } = {}) {
    const exact_start_ms = Date.now();
    const exact_groups = new Map();

    log_info("Grouping records for exact duplicate detection...", script_start_ms);

    for (let i = 0; i < records.length; i++) {
        const row = records[i];

        // Exact gate: skip records missing any of the five identity fields
        // (cleaned first/last, gender, birthdate, ZIP). Single source — same
        // check the SQL path and the snapshot key use.
        if (!has_required_exact_fields(row)) continue;

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
                merge_ids: [],
                foundation_constituents: [],
            });
        }

        const group = exact_groups.get(key);

        group.duplicate_count += 1;
        group.record_ids.push(row.Id);

        // Positional: exactly one entry per record (blank when the field is empty),
        // so member_numbers[i] / merge_ids[i] / foundation_constituents[i] line up
        // with record_ids[i].
        group.member_numbers.push(row.cfg_Member_Number__pc || "");
        group.merge_ids.push(row.usat_Salesforce_Merge_Id__pc || "");
        group.foundation_constituents.push(row.usat_Foundation_Constituent__c || "");

        if ((i + 1) % PROGRESS_LOG_EVERY_RECORDS === 0) {
            const pct = (((i + 1) / records.length) * 100).toFixed(1);
            log_info(`Exact grouping progress: ${i + 1}/${records.length} records (${pct}%)`, exact_start_ms);
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

    return {
        exact_groups_size: exact_groups.size,
        exact_duplicate_groups,
        exact_duplicate_record_ids,
    };
}

module.exports = {
    detect_exact_duplicates,
    log_exact_duplicate_exclusion_summary,
};
