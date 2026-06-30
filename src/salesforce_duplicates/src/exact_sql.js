/**
 * exact_sql.js — SQL-based exact-duplicate grouping (Phase 2b).
 *
 * SQL does the GROUPING logic — `GROUP BY exact_duplicate_key HAVING COUNT(*) > 1` —
 * which is the "which records are exact duplicates" decision. Node then rebuilds the
 * group objects from record_lookup (in the SQL-provided fetch order) and applies the
 * SAME final sort as exact.js. The sort + formatting deliberately stay in Node so the
 * output is BYTE-IDENTICAL to detect_exact_duplicates: JS localeCompare and MySQL
 * collation do not sort identically, and GROUP_CONCAT has length limits.
 *
 * The result shape matches detect_exact_duplicates() exactly:
 *   { exact_groups_size, exact_duplicate_groups, exact_duplicate_record_ids }
 *
 * baseline exact.js is NOT modified — this is an additive alternative used only when
 * the SQL backbone is on.
 */

'use strict';

const { composite_zip } = require('./normalize');
const { SNAPSHOT_TABLE_NAME } = require('../config');

// GROUP_CONCAT truncates at group_concat_max_len (default 1024); a large exact group
// would overflow, so raise it for the session before grouping.
const GROUP_CONCAT_MAX_LEN = 64 * 1024 * 1024;

async function detect_exact_duplicates_sql(executor, record_lookup, { table = SNAPSHOT_TABLE_NAME } = {}) {
    await executor(`SET SESSION group_concat_max_len = ${GROUP_CONCAT_MAX_LEN}`, []);

    // Total distinct exact keys (matches exact_groups.size in exact.js). The blank
    // key marks records that failed the exact gate (has_required_exact_fields), so
    // exclude it — that single filter is how the gate, defined once in normalize.js,
    // reaches SQL without re-encoding the rule here.
    const size_rows = await executor(
        `SELECT COUNT(DISTINCT exact_duplicate_key) AS n FROM \`${table}\` WHERE exact_duplicate_key <> ''`, []);
    const exact_groups_size = Number(size_rows[0] ? size_rows[0].n : 0);

    // Groups with more than one record, member IDs concatenated in fetch order, and
    // the groups themselves ordered by first appearance (MIN load_sequence) so the
    // stable Node sort below reproduces exact.js's order even on full ties.
    const rows = await executor(
        `SELECT
            exact_duplicate_key,
            GROUP_CONCAT(salesforce_account_id ORDER BY load_sequence SEPARATOR ',') AS ids
         FROM \`${table}\`
         WHERE exact_duplicate_key <> ''
         GROUP BY exact_duplicate_key
         HAVING COUNT(*) > 1
         ORDER BY MIN(load_sequence)`, []);

    const groups = rows.map((r) => {
        const ids = String(r.ids).split(',');
        const records = ids.map((id) => record_lookup.get(id)).filter(Boolean);
        const first = records[0] || {};
        return {
            duplicate_key: r.exact_duplicate_key,
            last_name: first.LastName,
            first_name: first.FirstName,
            gender: first.cfg_Gender_Identity__pc,
            birthdate: first.PersonBirthdate,
            composite_zip: composite_zip(first),
            duplicate_count: records.length,
            record_ids: records.map((x) => x.Id),
            member_numbers: records.map((x) => x.cfg_Member_Number__pc || ''),
            merge_ids: records.map((x) => x.usat_Salesforce_Merge_Id__pc || ''),
            foundation_constituents: records.map((x) => x.usat_Foundation_Constituent__c || ''),
        };
    });

    // SAME sort as exact.js (kept in Node for byte-identical ordering). Node's sort is
    // stable, and the SQL ORDER BY MIN(load_sequence) gives the same pre-sort order as
    // exact.js's Map insertion order, so full ties resolve identically too.
    const exact_duplicate_groups = groups.sort((a, b) => {
        if (b.duplicate_count !== a.duplicate_count) return b.duplicate_count - a.duplicate_count;
        const ln = String(a.last_name || '').localeCompare(String(b.last_name || ''));
        if (ln !== 0) return ln;
        return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    });

    const exact_duplicate_record_ids = new Set();
    for (const g of exact_duplicate_groups) {
        for (const id of g.record_ids) exact_duplicate_record_ids.add(id);
    }

    return { exact_groups_size, exact_duplicate_groups, exact_duplicate_record_ids };
}

// Convenience: open the local DB, run the SQL exact grouping against the already-loaded
// snapshot table, close the pool. Used by the finder when the SQL backbone is on.
async function detect_exact_duplicates_via_local_db(record_lookup, opts = {}) {
    const { open_local_executor } = require('./database_snapshot');
    const { pool, executor } = await open_local_executor();
    try {
        return await detect_exact_duplicates_sql(executor, record_lookup, opts);
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }
}

module.exports = { detect_exact_duplicates_sql, detect_exact_duplicates_via_local_db };
