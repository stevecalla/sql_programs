'use strict';
// Covers the reconciliation model added for the review panels:
//   - a "group" = a merge ID of ANY size (default), "mergeable" = a 2+ gate (opts.mergeable / sampler)
//   - account totals (count_accounts / *_account_total) that pair with the group counts
//   - the queue_join staged/unstaged SQL predicate
//   - facets(): labeled Size options + per-option filter_counts (scoped) for the dropdowns
const { test } = require('node:test');
const assert = require('node:assert');
const r = require('../store/reviews_read');

// Fake executor: records SQL, returns canned rows keyed by SQL shape.
function fake(rows = {}) {
  const sqls = [];
  const q = async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    sqls.push(s);
    if (/SUM\(c\)/.test(s)) return [{ n: rows.mergeAccts ?? 6604 }];              // merge_group_account_total
    if (/SUM\(CAST\(Group_Record_Count__c AS UNSIGNED\)\)/.test(s)) return [{ n: rows.dupAccts ?? 10097 }]; // duplicates_account_total
    if (/GROUP BY cnt/.test(s)) return [{ size: 2, n: 7 }, { size: 1, n: 330 }];   // size facet (merge-id)
    if (/CAST\(Group_Record_Count__c AS UNSIGNED\) AS size/.test(s)) return [{ size: 2, n: 1234 }]; // size facet (dup)
    if (/GROUP BY Bucket__c/.test(s)) return [{ v: 'in_both', n: 3326 }, { v: 'sf_only', n: 337 }]; // bucket facet (before generic COUNT)
    if (/COUNT\(\*\) AS n FROM \(/.test(s)) return [{ n: rows.count ?? 3661 }];     // merge_group_count (subquery)
    if (/COUNT\(DISTINCT/.test(s)) return [{ n: rows.count ?? 3661 }];             // merge_group_count / distinct
    if (/SUM\(g > 0\)/.test(s)) return [{ h: 120, z: 3541 }];                       // merge-id has/none
    if (/SUM\(ex\)/.test(s)) return [{ ex: 100, fz: 50, nk: 20 }];                  // which_list
    if (/Match_Composition__c LIKE '%exact%'/.test(s)) return [{ ex: 100, fz: 50, nk: 20 }];
    if (/LOWER\(Confidence_Tier__c\)/.test(s)) return [{ ex: 80, fz: 40, nk: 10 }];
    if (/REPLACE\(Merge_Ids__c/.test(s)) return [{ h: 3000, z: 661 }];
    if (/REPLACE\(Member_Numbers__c/.test(s)) return [{ h: 2000, z: 1661 }];
    if (/Foundation_Constituents__c/.test(s)) return [{ h: 120, z: 3541 }];
    if (/Has_Portal_Account__c/.test(s)) return [{ h: 5, z: 3656 }];
    return [];
  };
  return { q, sqls };
}

test('count_matching merge-id: default counts ALL sizes (no 2+ gate, no join)', async () => {
  const f = fake();
  await r.count_matching('merge-id', {}, f.q);
  assert.ok(!f.sqls.some((s) => /COUNT\(\*\) >= 2/.test(s)), 'no mergeable gate by default');
  assert.ok(!f.sqls.some((s) => /salesforce_merge_queue/.test(s)), 'no queue join without queue_filter');
});

test('count_matching merge-id: queue_filter=unstaged adds the queue join + NOT predicate', async () => {
  const f = fake();
  await r.count_matching('merge-id', { queue_filter: 'unstaged' }, f.q);
  assert.ok(f.sqls.some((s) => /salesforce_merge_queue/.test(s) && /NOT \(/.test(s)));
});

test('count_accounts: merge-id sums group sizes; duplicates sums cluster sizes', async () => {
  const fm = fake({ mergeAccts: 6604 });
  assert.equal(await r.count_accounts('merge-id', {}, fm.q), 6604);
  assert.ok(fm.sqls.some((s) => /SUM\(c\)/.test(s)));
  const fd = fake({ dupAccts: 10097 });
  assert.equal(await r.count_accounts('duplicates', {}, fd.q), 10097);
  assert.ok(fd.sqls.some((s) => /SUM\(CAST\(Group_Record_Count__c AS UNSIGNED\)\)/.test(s)));
});

test('queue_join builds staged / unstaged conditions (or null when off)', () => {
  assert.equal(r.queue_join('X', ''), null);
  const staged = r.queue_join('Salesforce_Merge_Id__c', 'staged');
  assert.ok(/salesforce_merge_queue/.test(staged.join));
  assert.ok(!/^NOT /.test(staged.cond));
  const uns = r.queue_join('Salesforce_Merge_Id__c', 'unstaged');
  assert.ok(/^NOT /.test(uns.cond));
});

test('facets(merge-id): labeled Size options + scoped filter_counts', async () => {
  const f = fake();
  const out = await r.facets('merge-id', { filters: {} }, f.q);
  assert.ok(Array.isArray(out.size) && out.size[0].label);                 // labeled { value, label }
  assert.equal(out.filter_counts.bucket.find((o) => o.value === 'in_both').label, 'In both (3,326)');
  assert.equal(out.filter_counts.foundation_state.find((o) => o.value === 'has').label, 'Is foundation (120)');
  assert.ok(out.filter_counts.which_list.some((o) => o.value === 'exact'));
});

test('facets(duplicates): filter_counts for signal/tier/merge_id/member/foundation/portal', async () => {
  const f = fake();
  const out = await r.facets('duplicates', { filters: {} }, f.q);
  assert.equal(out.filter_counts.signal.find((o) => o.value === 'exact').label, 'Exact (100)');
  assert.equal(out.filter_counts.merge_id_state.find((o) => o.value === 'has').label, 'Has merge ID (3,000)');
  assert.ok(out.filter_counts.tier && out.filter_counts.member_number_state && out.filter_counts.portal_state);
});
