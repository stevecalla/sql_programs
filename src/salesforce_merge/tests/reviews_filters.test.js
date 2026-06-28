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
