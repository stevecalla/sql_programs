'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const r = require('../store/reviews_read');

function fake(rowsByKind) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/COUNT\(DISTINCT/i.test(sql)) return [{ n: 3 }];
    if (/GROUP BY Salesforce_Merge_Id__c/i.test(sql)) return rowsByKind.groups || [];
    if (/WHERE Salesforce_Merge_Id__c = \?/i.test(sql)) return rowsByKind.ids || [];
    return rowsByKind.accts || [];
  };
  return { calls, query };
}

test('list_merge_groups lists only rows with a merge id, grouped by merge id', async () => {
  const f = fake({ groups: [{ merge_id: 'M1', names: 'John Smith;Jon Smith', size: 4, cluster_key: 'k1' }] });
  const out = await r.list_merge_groups({ page: 1, page_size: 50 }, f.query);
  assert.equal(out.total, 3);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].cluster, 'M1');
  assert.equal(out.rows[0].merge_id, 'M1');
  assert.equal(out.rows[0].size, 4);
  assert.ok(f.calls.some((c) => /Salesforce_Merge_Id__c <> ''/.test(c.sql)), 'requires a merge id');
  assert.ok(f.calls.some((c) => /GROUP BY Salesforce_Merge_Id__c/i.test(c.sql)));
});

test('list_merge_groups applies the bucket filter (in_both / sf_only)', async () => {
  const f = fake({ groups: [] });
  await r.list_merge_groups({ bucket: 'sf_only' }, f.query);
  assert.ok(f.calls.some((c) => /Bucket__c = \?/i.test(c.sql) && (c.params || []).includes('sf_only')));
});

test('merge_group_account_ids returns ids for a merge id', async () => {
  const f = fake({ ids: [{ account: 'A' }, { account: 'B' }, { account: '' }] });
  const ids = await r.merge_group_account_ids('M1', f.query);
  assert.deepEqual(ids, ['A', 'B']);
  assert.equal(f.calls[0].params[0], 'M1');
});

test('accounts_by_ids builds an IN list and skips when empty', async () => {
  const f = fake({ accts: [{ account: 'A' }] });
  assert.deepEqual(await r.accounts_by_ids([], f.query), []);
  const out = await r.accounts_by_ids(['A', 'B'], f.query);
  assert.equal(out.length, 1);
  assert.ok(f.calls.some((c) => /IN \(\?, \?\)/.test(c.sql)));
});
