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

test('list_merge_groups foundation_state adds a group-level HAVING', async () => {
  let f = fake({ groups: [] });
  await r.list_merge_groups({ foundation_state: 'has' }, f.query);
  assert.ok(f.calls.some((c) => /HAVING SUM\(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END\) > 0/.test(c.sql)));

  f = fake({ groups: [] });
  await r.list_merge_groups({ foundation_state: 'none' }, f.query);
  assert.ok(f.calls.some((c) => /HAVING SUM\(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END\) = 0/.test(c.sql)));
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

test('resolve_merge_groups cascade: merge-id match, else lowest member #, else unresolvable', async () => {
  const query = async (sql) => {
    if (/salesforce_account_id/i.test(sql)) return [
      { account: 'X', member_number: '500' }, { account: 'Y', member_number: '200' },
    ];
    return [
      { merge_id: 'M1', account: 'M1' }, { merge_id: 'M1', account: 'A' },
      { merge_id: 'M2', account: 'X' }, { merge_id: 'M2', account: 'Y' },
      { merge_id: 'M3', account: 'P' }, { merge_id: 'M3', account: 'Q' },
    ];
  };
  const out = await r.resolve_merge_groups({}, query);
  const m1 = out.find((g) => g.merge_id === 'M1');
  const m2 = out.find((g) => g.merge_id === 'M2');
  const m3 = out.find((g) => g.merge_id === 'M3');
  assert.equal(m1.survivor, 'M1'); assert.equal(m1.rule, 'merge_id'); assert.deepEqual(m1.losers, ['A']);
  assert.equal(m2.survivor, 'Y'); assert.equal(m2.rule, 'member_number'); assert.deepEqual(m2.losers, ['X']);
  assert.equal(m3.survivor, null); assert.equal(m3.resolvable, false);
});
