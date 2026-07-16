'use strict';
// New review-page filters: duplicates membership-ID / member-# presence, and All-accounts 3-state
// selectors. Injected fake query (no MySQL); asserts the generated WHERE.
//   node --test src/salesforce_merge/tests/reviews_filters.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const reviews = require('../store/reviews_read');

function recorder(rows) {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params: params || [] });
    if (/COUNT\(\*\)/.test(sql)) return [{ n: 1 }];
    if (/SHOW INDEX/.test(sql)) return [{ Key_name: 'idx_cc_group_key' }];   // pretend index exists
    return rows;
  };
  return { q, calls };
}
const sel = (calls, re) => calls.find((c) => re.test(c.sql) && !/COUNT/.test(c.sql) && !/SHOW INDEX/.test(c.sql));

describe('duplicates membership filters', () => {
  test("merge_id_state 'has' / 'none' build REPLACE() presence checks on Merge_Ids__c", async () => {
    let r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { merge_id_state: 'has' } }, r.q);
    assert.ok(/REPLACE\(Merge_Ids__c, ';', ''\) <> ''/.test(sel(r.calls, /Names_In_Group__c AS/).sql));

    r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { merge_id_state: 'none' } }, r.q);
    assert.ok(/Merge_Ids__c IS NULL OR REPLACE\(Merge_Ids__c/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });

  test("member_number_state filters on Member_Numbers__c", async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { member_number_state: 'has' } }, r.q);
    assert.ok(/REPLACE\(Member_Numbers__c, ';', ''\) <> ''/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });
});

describe('accounts 3-state selectors', () => {
  test('in_cluster_state has/none -> cluster_size predicate (indexed, no scan)', async () => {
    const has = recorder([{ account: '1' }]);
    await reviews.list_accounts({ filters: { in_cluster_state: 'has' } }, has.q);
    assert.ok(has.calls.some((c) => /cluster_size > 0/.test(c.sql)));
    const none = recorder([{ account: '1' }]);
    await reviews.list_accounts({ filters: { in_cluster_state: 'none' } }, none.q);
    assert.ok(none.calls.some((c) => /cluster_size IS NULL OR cluster_size = 0/.test(c.sql)));
  });

  test("merge_id_state / member_number_state map to presence checks", async () => {
    let r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ filters: { merge_id_state: 'has' } }, r.q);
    assert.ok(/salesforce_merge_id <> ''/.test(sel(r.calls, /salesforce_account_id AS/).sql));

    r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ filters: { member_number_state: 'none' } }, r.q);
    assert.ok(/member_number IS NULL OR member_number = ''/.test(sel(r.calls, /salesforce_account_id AS/).sql));
  });
});

describe('foundation filters', () => {
  test('duplicates foundation_state -> Foundation_Constituents__c contains true', async () => {
    let r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { foundation_state: 'has' } }, r.q);
    assert.ok(/Foundation_Constituents__c LIKE '%true%'/.test(sel(r.calls, /Names_In_Group__c AS/).sql));

    r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { foundation_state: 'none' } }, r.q);
    assert.ok(/Foundation_Constituents__c NOT LIKE '%true%'/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });

  test('accounts foundation column filter (dropdown value) matches', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ colFilters: { foundation_constituent: 'true' } }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`foundation_constituent` LIKE \?/.test(c.sql));
    assert.ok(c.params.includes('true%')); // prefix (not a contains column)
  });

  test('merge-id foundation_state -> per-row Foundation_Constituent__c', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_merge_id({ filters: { foundation_state: 'has' } }, r.q);
    assert.ok(r.calls.some((c) => /Foundation_Constituent__c LIKE 'true%'/.test(c.sql)));
  });
});

describe('duplicates size + match-type filters', () => {
  test('size_eq -> exact numeric equality on Group_Record_Count__c', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { size_eq: '2' } }, r.q);
    const c = sel(r.calls, /Names_In_Group__c AS/);
    assert.ok(/CAST\(Group_Record_Count__c AS UNSIGNED\) = \?/.test(c.sql));
    assert.ok(c.params.includes(2));
  });

  test('size_eq ignores non-numeric input', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { size_eq: 'abc' } }, r.q);
    assert.ok(!/Group_Record_Count__c AS UNSIGNED\) = \?/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });

  test('match_type -> composition contains the chosen signal', async () => {
    for (const t of ['exact', 'fuzzy', 'nickname']) {
      const r = recorder([{ cluster: 'C' }]);
      await reviews.list_duplicates({ filters: { match_type: t } }, r.q);
      const c = sel(r.calls, /Names_In_Group__c AS/);
      assert.ok(/Match_Composition__c LIKE \?/.test(c.sql));
      assert.ok(c.params.includes('%' + t + '%'));
    }
  });

  test('match_type rejects unknown signals (no clause added)', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { match_type: 'bogus' } }, r.q);
    assert.ok(!/Match_Composition__c LIKE \?/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });

  test('best_min -> minimum best-pair-score (>=) on Best_Pair_Score__c', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { best_min: '90' } }, r.q);
    const c = sel(r.calls, /Names_In_Group__c AS/);
    assert.ok(/CAST\(Best_Pair_Score__c AS UNSIGNED\) >= \?/.test(c.sql));
    assert.ok(c.params.includes(90));
  });

  test('tier -> exact equality on Confidence_Tier__c (mirrors Duplicates tab Tier)', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { tier: 'fuzzy' } }, r.q);
    const c = sel(r.calls, /Names_In_Group__c AS/);
    assert.ok(/LOWER\(Confidence_Tier__c\) = \?/.test(c.sql));
    assert.ok(c.params.includes('fuzzy'));
  });

  test('tier rejects unknown value', async () => {
    const r = recorder([{ cluster: 'C' }]);
    await reviews.list_duplicates({ filters: { tier: 'bogus' } }, r.q);
    assert.ok(!/LOWER\(Confidence_Tier__c\) = \?/.test(sel(r.calls, /Names_In_Group__c AS/).sql));
  });
});

describe('merge-id groups which-list filter', () => {
  test("which_list -> HAVING SUM(Which_List__c LIKE '%exact%') > 0", async () => {
    const r = recorder([{ merge_id: 'M', names: 'A', size: 2, cluster_key: 'K' }]);
    await reviews.list_merge_groups({ which_list: 'exact' }, r.q);
    assert.ok(r.calls.some((c) => /HAVING[\s\S]*Which_List__c LIKE '%exact%'/.test(c.sql)));
  });

  test('unknown which_list adds no HAVING clause', async () => {
    const r = recorder([{ merge_id: 'M', names: 'A', size: 2, cluster_key: 'K' }]);
    await reviews.list_merge_groups({ which_list: 'bogus' }, r.q);
    assert.ok(!r.calls.some((c) => /Which_List__c LIKE/.test(c.sql)));
  });
});

describe('merge-id groups size filter', () => {
  test("size -> HAVING COUNT(*) = n on the grouped query", async () => {
    const r = recorder([{ merge_id: 'M', names: 'A', size: 2, cluster_key: 'K' }]);
    await reviews.list_merge_groups({ size: '3' }, r.q);
    assert.ok(r.calls.some((c) => /HAVING[\s\S]*COUNT\(\*\) = 3/.test(c.sql)));
  });

  test("non-numeric size adds no HAVING", async () => {
    const r = recorder([{ merge_id: 'M', names: 'A', size: 2, cluster_key: 'K' }]);
    await reviews.list_merge_groups({ size: 'x' }, r.q);
    assert.ok(!r.calls.some((c) => /HAVING[\s\S]*COUNT\(\*\) =/.test(c.sql)));
  });
});

describe('accounts new columns: email + match_composition', () => {
  test('global search: identity columns only, all indexed prefix (no email/match_composition scan)', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ q: 'smith' }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`first_name` LIKE \? OR `last_name` LIKE \? OR `salesforce_account_id` LIKE \? OR `member_number` LIKE \?/.test(c.sql));
    // one token -> one 'term%' param per identity col; email / match_composition are NOT searched globally
    assert.deepEqual(c.params.slice(0, 4), ['smith%', 'smith%', 'smith%', 'smith%']);
    assert.ok(!/`email` LIKE/.test(c.sql));
    assert.ok(!/`match_composition` LIKE/.test(c.sql));
  });

  test('column filter: email is contains-anywhere, match_composition selectable', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ colFilters: { email: 'gmail', match_composition: 'exact only' } }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`email` LIKE \?/.test(c.sql) && /`match_composition` LIKE \?/.test(c.sql));
    assert.ok(c.params.includes('%gmail%'));
    assert.ok(c.params.includes('%exact only%'));
  });

  test('column filters: first_name / last_name / match_score map to their snapshot columns', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ colFilters: { first_name: 'vic', last_name: 'lop', match_score: '95' } }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`first_name` LIKE \?/.test(c.sql));
    assert.ok(/`last_name` LIKE \?/.test(c.sql));
    assert.ok(/`match_score` = \?/.test(c.sql));
    // prefix_search -> 'term%' for these indexed / numeric columns
    assert.ok(c.params.includes('vic%'));
    assert.ok(c.params.includes('lop%'));
    assert.ok(c.params.includes('95'));
  });
});
