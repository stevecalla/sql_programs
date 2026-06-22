/**
 * merge_id_review.test.js — Merge ID review (QA). Pure builders + DB report path
 * (no live MySQL; fake executor).
 *   node --test tests/merge_id_review.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    flag_on,
    which_list,
    bucket_for_signal,
    build_merge_id_review_rows,
    count_account_buckets,
    count_duplicate_pairs,
    report_from_db,
} = require('../src/merge_id_review');

// Synthetic consolidated clusters (raw shape: ';'-joined record_ids, 0/1 flags, link counts).
function sample_clusters() {
    return [
        { consolidated_group_key: 'AAA|BBB', record_ids: 'AAA;BBB', has_exact_flag: 1, has_fuzzy_flag: 0, has_nickname_flag: 0, exact_link_count: 1, fuzzy_link_count: 0, nickname_link_count: 0, match_link_count: 1 },
        { consolidated_group_key: 'CCC|DDD', record_ids: 'CCC;DDD', has_exact_flag: 0, has_fuzzy_flag: 1, has_nickname_flag: 0, exact_link_count: 0, fuzzy_link_count: 1, nickname_link_count: 0, match_link_count: 1 },
        { consolidated_group_key: 'FFF|GGG', record_ids: 'FFF;GGG', has_exact_flag: 1, has_fuzzy_flag: 1, has_nickname_flag: 0, exact_link_count: 1, fuzzy_link_count: 1, nickname_link_count: 0, match_link_count: 2 },
        { consolidated_group_key: 'HHH|III', record_ids: 'HHH;III', has_exact_flag: 0, has_fuzzy_flag: 0, has_nickname_flag: 1, exact_link_count: 0, fuzzy_link_count: 0, nickname_link_count: 1, match_link_count: 1 },
    ];
}

function rec(id, merge_id) {
    return { Id: id, usat_Salesforce_Merge_Id__pc: merge_id || '', FirstName: id, LastName: id };
}

function sample_records() {
    return [
        rec('AAA', 'MRG-1001'), rec('BBB', 'MRG-1001'),   // in_both (exact cluster)
        rec('CCC', ''), rec('DDD', ''),                   // fuzzy_only
        rec('FFF', ''), rec('GGG', ''),                   // multi_signal (exact+fuzzy)
        rec('HHH', ''), rec('III', ''),                   // nickname_only
        rec('EEE', 'MRG-1002'),                           // sf_only (not in our clusters)
        rec('ZZZ', ''),                                   // neither -> excluded
    ];
}

describe('flag_on', () => {
    test('numbers and common text reps', () => {
        assert.equal(flag_on(1), true);
        assert.equal(flag_on(0), false);
        assert.equal(flag_on('true'), true);
        assert.equal(flag_on('1'), true);
        assert.equal(flag_on('yes'), true);
        assert.equal(flag_on('false'), false);
        assert.equal(flag_on(''), false);
        assert.equal(flag_on(undefined), false);
    });
});

describe('which_list / bucket_for_signal', () => {
    test('single signal', () => {
        assert.equal(which_list({ has_exact: 1, has_fuzzy: 0, has_nick: 0 }), 'exact');
        assert.equal(bucket_for_signal({ has_exact: 0, has_fuzzy: 1, has_nick: 0 }), 'fuzzy_only');
        assert.equal(bucket_for_signal({ has_exact: 0, has_fuzzy: 0, has_nick: 1 }), 'nickname_only');
    });
    test('multiple signals -> multi_signal, which_list lists both', () => {
        assert.equal(which_list({ has_exact: 1, has_fuzzy: 1, has_nick: 0 }), 'exact,fuzzy');
        assert.equal(bucket_for_signal({ has_exact: 1, has_fuzzy: 1, has_nick: 0 }), 'multi_signal');
    });
    test('no signal -> ours_unknown', () => {
        assert.equal(bucket_for_signal({ has_exact: 0, has_fuzzy: 0, has_nick: 0 }), 'ours_unknown');
    });
});

describe('build_merge_id_review_rows', () => {
    const rows = build_merge_id_review_rows(sample_clusters(), sample_records());
    const by_id = new Map(rows.map((r) => [r.account_id, r]));

    test('each account lands in the right bucket', () => {
        assert.equal(by_id.get('AAA').bucket, 'in_both');
        assert.equal(by_id.get('BBB').bucket, 'in_both');
        assert.equal(by_id.get('CCC').bucket, 'fuzzy_only');
        assert.equal(by_id.get('FFF').bucket, 'multi_signal');
        assert.equal(by_id.get('HHH').bucket, 'nickname_only');
        assert.equal(by_id.get('EEE').bucket, 'sf_only');
    });

    test('which_list reflects the signal mix; in_both carries its merge ID', () => {
        assert.equal(by_id.get('AAA').which_list, 'exact');
        assert.equal(by_id.get('AAA').salesforce_merge_id, 'MRG-1001');
        assert.equal(by_id.get('FFF').which_list, 'exact,fuzzy');
        assert.equal(by_id.get('EEE').which_list, '');
    });

    test('accounts that are neither flagged nor merge-marked are excluded', () => {
        assert.equal(by_id.has('ZZZ'), false);
    });

    test('rows are numbered 1..N in bucket order', () => {
        assert.equal(rows.length, 9);
        assert.equal(rows[0].row_num, 1);
        assert.equal(rows[0].bucket, 'in_both');
        assert.equal(rows[rows.length - 1].bucket, 'sf_only');
    });
});

describe('count_account_buckets', () => {
    test('tallies each bucket + a TOTAL', () => {
        const rows = build_merge_id_review_rows(sample_clusters(), sample_records());
        const counts = count_account_buckets(rows);
        const map = new Map(counts.map((c) => [c.bucket, c.accounts]));
        assert.equal(map.get('in_both'), 2);
        assert.equal(map.get('fuzzy_only'), 2);
        assert.equal(map.get('nickname_only'), 2);
        assert.equal(map.get('multi_signal'), 2);
        assert.equal(map.get('sf_only'), 1);
        assert.equal(map.get('TOTAL'), 9);
        assert.equal(counts[counts.length - 1].bucket, 'TOTAL'); // TOTAL is last
    });
});

describe('count_duplicate_pairs', () => {
    test('sums the per-signal link counts (signals can overlap total)', () => {
        const p = count_duplicate_pairs(sample_clusters());
        assert.equal(p.clusters, 4);
        assert.equal(p.exact_pairs, 2);
        assert.equal(p.fuzzy_pairs, 2);
        assert.equal(p.nickname_pairs, 1);
        assert.equal(p.total_pairs, 5);
    });
});

describe('report_from_db', () => {
    test('reads bucket counts + pair counts + preview via the executor', async () => {
        const executor = async (sql) => {
            if (/GROUP BY Bucket__c/.test(sql)) {
                return [
                    { bucket: 'in_both', accounts: 2 },
                    { bucket: 'fuzzy_only', accounts: 2 },
                    { bucket: 'sf_only', accounts: 1 },
                ];
            }
            if (/Match_Link_Count__c/.test(sql)) {
                return [{ clusters: 4, exact_pairs: 2, fuzzy_pairs: 2, nickname_pairs: 1, total_pairs: 5 }];
            }
            return [{ Row_Number__c: 1, Account__c: 'AAA', Bucket__c: 'in_both', Salesforce_Merge_Id__c: 'MRG-1001', Which_List__c: 'exact' }];
        };
        const r = await report_from_db(executor);
        const map = new Map(r.bucket_counts.map((c) => [c.bucket, c.accounts]));
        assert.equal(map.get('in_both'), 2);
        assert.equal(map.get('TOTAL'), 5);                 // 2 + 2 + 1
        assert.equal(r.bucket_counts[r.bucket_counts.length - 1].bucket, 'TOTAL');
        assert.equal(r.pair_counts.total_pairs, 5);
        assert.equal(r.preview.length, 1);
    });

    test('missing review table -> null (no finder run yet)', async () => {
        const executor = async () => { throw new Error("Table 'x' doesn't exist"); };
        assert.equal(await report_from_db(executor), null);
    });
});
