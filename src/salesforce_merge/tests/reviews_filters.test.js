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

describe('accounts new columns: email + match_composition', () => {
  test('global search: names/ID/member use prefix, email + match_composition use contains', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ q: 'smith' }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`email` LIKE \? OR `match_composition` LIKE \?/.test(c.sql));
    // one token -> one param per search col, in column order
    assert.deepEqual(c.params.slice(0, 6), ['smith%', 'smith%', 'smith%', 'smith%', '%smith%', '%smith%']);
  });

  test('column filter: email is contains-anywhere, match_composition selectable', async () => {
    const r = recorder([{ account: '1' }]);
    await reviews.list_accounts({ colFilters: { email: 'gmail', match_composition: 'exact only' } }, r.q);
    const c = sel(r.calls, /salesforce_account_id AS/);
    assert.ok(/`email` LIKE \?/.test(c.sql) && /`match_composition` LIKE \?/.test(c.sql));
    assert.ok(c.params.includes('%gmail%'));
    assert.ok(c.params.includes('%exact only%'));
  });
});
