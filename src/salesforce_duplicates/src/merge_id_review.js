/**
 * merge_id_review.js — Merge ID review (QA). See plans_and_notes/README_MERGE_ID_REVIEW.md.
 *
 * Compares the accounts our tool flagged (the consolidated clusters) against the
 * accounts Salesforce has marked to merge (a non-blank merge ID), and labels each
 * account with a bucket:
 *
 *   in_both        - SF marked it AND we flagged it
 *   sf_only        - SF marked it, we did NOT flag it
 *   exact_only     - we flagged it (no merge ID yet), found ONLY by exact
 *   fuzzy_only     - ...found ONLY by fuzzy
 *   nickname_only  - ...found ONLY by nickname
 *   multi_signal   - ...found by more than one signal
 *   ours_unknown   - in our list but with no signal flag (should not normally happen)
 *
 * Two summaries, both kept (see the doc):
 *   - account counts per bucket (each account is one row)
 *   - duplicate-pair counts (matched links inside our clusters, by signal)
 *
 * The builders are PURE and run in-memory during the finder (off the consolidated
 * clusters + the fetched records). A separate DB report path reads the persisted
 * tables back so the menu can print the latest review without re-running detection.
 * All SQL goes through an injectable executor(sql, params) -> rows for testing.
 */

'use strict';

const path = require('path');

const {
    RESULT_MERGE_ID_REVIEW_TABLE,
    RESULT_CONSOLIDATED_TABLE,
} = require('../config');

// Buckets in display order (TOTAL is appended separately).
const BUCKET_ORDER = [
    'in_both',
    'exact_only',
    'fuzzy_only',
    'nickname_only',
    'multi_signal',
    'ours_unknown',
    'sf_only',
];

function bucket_rank(b) {
    const i = BUCKET_ORDER.indexOf(b);
    return i === -1 ? BUCKET_ORDER.length : i;
}

// Treat a flag as "on" whether it arrives as a number (in-memory: 0/1) or as text
// (read back from the DB: 'true'/'1'/'yes'/'y'). Everything else is off.
function flag_on(v) {
    if (typeof v === 'number') return v > 0;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

// The signal mix as a comma list, e.g. "exact" or "fuzzy,nickname". '' if none.
function which_list(sig) {
    const parts = [];
    if (flag_on(sig.has_exact)) parts.push('exact');
    if (flag_on(sig.has_fuzzy)) parts.push('fuzzy');
    if (flag_on(sig.has_nick)) parts.push('nickname');
    return parts.join(',');
}

// Bucket name for an account we flagged that has NO merge ID yet (named by signal).
function bucket_for_signal(sig) {
    const on = (flag_on(sig.has_exact) ? 1 : 0) + (flag_on(sig.has_fuzzy) ? 1 : 0) + (flag_on(sig.has_nick) ? 1 : 0);
    if (on > 1) return 'multi_signal';
    if (flag_on(sig.has_exact)) return 'exact_only';
    if (flag_on(sig.has_fuzzy)) return 'fuzzy_only';
    if (flag_on(sig.has_nick)) return 'nickname_only';
    return 'ours_unknown';
}

const merge_id_of = (rec) => String((rec && rec.usat_Salesforce_Merge_Id__pc) || '').trim();

// ---------------------------------------------------------------------------
// Phase 3 — one row per reviewed account (our flagged accounts + any SF-marked
// account we missed). `clusters` are the raw consolidated clusters (record_ids is
// a ';'-joined string; has_*_flag are 0/1); `records` is the fetched record list.
// ---------------------------------------------------------------------------
function build_merge_id_review_rows(clusters, records) {
    // account -> signal flags + cluster key, from the consolidated clusters.
    const ours = new Map();
    for (const c of clusters || []) {
        const ids = String(c.record_ids || '').split(';').filter(Boolean);
        for (const id of ids) {
            ours.set(id, {
                has_exact: c.has_exact_flag,
                has_fuzzy: c.has_fuzzy_flag,
                has_nick: c.has_nickname_flag,
                cluster_key: c.consolidated_group_key || '',
            });
        }
    }

    const rec_by_id = new Map((records || []).map((r) => [r.Id, r]));
    const rows = [];

    // our side -> in_both (has a merge ID) or a signal bucket (no merge ID yet)
    for (const [id, sig] of ours) {
        const rec = rec_by_id.get(id) || {};
        const merge_id = merge_id_of(rec);
        rows.push({
            account_id: id,
            bucket: merge_id ? 'in_both' : bucket_for_signal(sig),
            salesforce_merge_id: merge_id,
            which_list: which_list(sig),
            first_name: rec.FirstName || '',
            last_name: rec.LastName || '',
            cluster_key: sig.cluster_key,
        });
    }

    // SF side -> sf_only (has a merge ID, not in our list)
    for (const rec of records || []) {
        const merge_id = merge_id_of(rec);
        if (!merge_id || ours.has(rec.Id)) continue;
        rows.push({
            account_id: rec.Id,
            bucket: 'sf_only',
            salesforce_merge_id: merge_id,
            which_list: '',
            first_name: rec.FirstName || '',
            last_name: rec.LastName || '',
            cluster_key: '',
        });
    }

    rows.sort((a, b) => bucket_rank(a.bucket) - bucket_rank(b.bucket) ||
        String(a.account_id).localeCompare(String(b.account_id)));
    rows.forEach((r, i) => { r.row_num = i + 1; });
    return rows;
}

// Phase 4a — account counts per bucket (+ TOTAL). Returns an ordered array of
// { bucket, accounts } so the caller can print/persist in a stable order.
function count_account_buckets(review_rows) {
    const tally = new Map();
    for (const r of review_rows || []) tally.set(r.bucket, (tally.get(r.bucket) || 0) + 1);
    const present = [...tally.keys()].sort((a, b) => bucket_rank(a) - bucket_rank(b));
    const out = present.map((bucket) => ({ bucket, accounts: tally.get(bucket) }));
    out.push({ bucket: 'TOTAL', accounts: (review_rows || []).length });
    return out;
}

// Phase 4b — duplicate-pair counts (matched links inside our clusters, by signal).
function count_duplicate_pairs(clusters) {
    const sum = (key) => (clusters || []).reduce((acc, c) => acc + (Number(c[key]) || 0), 0);
    return {
        clusters: (clusters || []).length,
        exact_pairs: sum('exact_link_count'),
        fuzzy_pairs: sum('fuzzy_link_count'),
        nickname_pairs: sum('nickname_link_count'),
        total_pairs: sum('match_link_count'),
    };
}

// ---------------------------------------------------------------------------
// Console summary — used both at the end of a finder run and by the menu report.
// ---------------------------------------------------------------------------
const n = (v) => Number(v || 0).toLocaleString();

function log_merge_id_review(bucket_counts, pair_counts, log = console.log) {
    log('Merge ID review — accounts:');
    for (const { bucket, accounts } of bucket_counts) {
        log(`  ${String(bucket).padEnd(13)}: ${n(accounts)}`);
    }
    log('Merge ID review — duplicate pairs:');
    log(`  ${'exact'.padEnd(13)}: ${n(pair_counts.exact_pairs)}`);
    log(`  ${'fuzzy'.padEnd(13)}: ${n(pair_counts.fuzzy_pairs)}`);
    log(`  ${'nickname'.padEnd(13)}: ${n(pair_counts.nickname_pairs)}`);
    log(`  ${'total'.padEnd(13)}: ${n(pair_counts.total_pairs)}  (${n(pair_counts.clusters)} clusters)`);
}

// ---------------------------------------------------------------------------
// DB report path — read the persisted review + consolidated tables back so the
// menu can show the latest run's review without re-running detection.
// ---------------------------------------------------------------------------
async function report_from_db(executor, {
    review_table = RESULT_MERGE_ID_REVIEW_TABLE,
    consolidated_table = RESULT_CONSOLIDATED_TABLE,
    preview_limit = 20,
} = {}) {
    // Account buckets from the review table (GROUP BY the stored Bucket__c column).
    let bucket_rows;
    try {
        bucket_rows = await executor(
            `SELECT Bucket__c AS bucket, COUNT(*) AS accounts FROM \`${review_table}\` GROUP BY Bucket__c`, []);
    } catch (e) {
        if (/doesn't exist|Unknown table/i.test(e.message)) return null; // no finder run yet
        throw e;
    }
    const tally = new Map(bucket_rows.map((r) => [r.bucket, Number(r.accounts) || 0]));
    const present = [...tally.keys()].sort((a, b) => bucket_rank(a) - bucket_rank(b));
    const total = [...tally.values()].reduce((a, b) => a + b, 0);
    const bucket_counts = present.map((bucket) => ({ bucket, accounts: tally.get(bucket) }));
    bucket_counts.push({ bucket: 'TOTAL', accounts: total });

    // Duplicate pairs from the consolidated table (link counts are stored as text).
    let pair_counts = { clusters: 0, exact_pairs: 0, fuzzy_pairs: 0, nickname_pairs: 0, total_pairs: 0 };
    try {
        const p = await executor(
            `SELECT COUNT(*) AS clusters,
                    SUM(CAST(Exact_Link_Count__c    AS UNSIGNED)) AS exact_pairs,
                    SUM(CAST(Fuzzy_Link_Count__c    AS UNSIGNED)) AS fuzzy_pairs,
                    SUM(CAST(Nickname_Link_Count__c AS UNSIGNED)) AS nickname_pairs,
                    SUM(CAST(Match_Link_Count__c    AS UNSIGNED)) AS total_pairs
             FROM \`${consolidated_table}\``, []);
        if (p && p[0]) {
            pair_counts = {
                clusters: Number(p[0].clusters) || 0,
                exact_pairs: Number(p[0].exact_pairs) || 0,
                fuzzy_pairs: Number(p[0].fuzzy_pairs) || 0,
                nickname_pairs: Number(p[0].nickname_pairs) || 0,
                total_pairs: Number(p[0].total_pairs) || 0,
            };
        }
    } catch (e) {
        if (!/doesn't exist|Unknown table/i.test(e.message)) throw e;
    }

    // A small preview of the review rows.
    let preview = [];
    try {
        preview = await executor(
            `SELECT Row_Number__c, Account__c, Bucket__c, Salesforce_Merge_Id__c, Which_List__c
             FROM \`${review_table}\`
             ORDER BY CAST(Row_Number__c AS UNSIGNED) LIMIT ${Number(preview_limit) || 20}`, []);
    } catch (_) { /* preview is best-effort */ }

    return { bucket_counts, pair_counts, preview };
}

// Open the local DB, run the report, print it. Used by the menu.
async function report_via_local_db(opts = {}) {
    const { open_local_executor } = require('./database_snapshot');
    const { pool, executor } = await open_local_executor();
    try {
        const report = await report_from_db(executor, opts);
        if (!report) {
            console.log('No merge ID review found in the database yet. Run the finder first (menu items 7-10).');
            return;
        }
        log_merge_id_review(report.bucket_counts, report.pair_counts);
        console.log('\nPreview (first rows):');
        for (const r of report.preview) {
            console.log(`  ${String(r.Row_Number__c).padStart(4)}  ${r.Account__c}  ${String(r.Bucket__c).padEnd(13)} ` +
                `merge_id=${r.Salesforce_Merge_Id__c || ''}  which_list=${r.Which_List__c || ''}`);
        }
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }
}

// CLI: `node src/merge_id_review.js report`
async function main() {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '../../../.env') });
    const cmd = process.argv[2] || 'report';
    if (cmd === 'report') {
        await report_via_local_db();
    } else {
        console.log('Usage: node src/merge_id_review.js report');
    }
}

if (require.main === module) {
    main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
    BUCKET_ORDER,
    flag_on,
    which_list,
    bucket_for_signal,
    build_merge_id_review_rows,
    count_account_buckets,
    count_duplicate_pairs,
    log_merge_id_review,
    report_from_db,
    report_via_local_db,
};
