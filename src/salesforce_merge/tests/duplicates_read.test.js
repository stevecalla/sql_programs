'use strict';
// duplicates_read maps query rows into the dashboard shape, and degrades to nulls when a table
// is missing. Uses an injected fake query (no MySQL).
//   node --test src/salesforce_merge/tests/duplicates_read.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { dashboard_counts } = require('../store/duplicates_read');

describe('dashboard_counts', () => {
  test('maps query results into the dashboard shape', async () => {
    const fake = async (sql) => {
      if (/GROUP BY Bucket__c/.test(sql)) return [{ bucket: 'in_both', n: 16 }, { bucket: 'sf_only', n: 9 }];
      if (/SUM\(/.test(sql)) return [{ n: 17398 }];
      if (/consolidated_cluster/.test(sql)) return [{ n: 10623 }];
      if (/salesforce_merge_id <> ''/.test(sql)) return [{ n: 25 }];
      if (/salesforce_account_duplicate_snapshot/.test(sql)) return [{ n: 700682 }];
      return [{ n: 0 }];
    };
    const d = await dashboard_counts(fake);
    assert.equal(d.total_accounts, 700682);
    assert.equal(d.merge_id_accounts, 25);
    assert.equal(d.clusters, 10623);
    assert.equal(d.duplicate_pairs, 17398);
    assert.deepEqual(d.buckets, [{ bucket: 'in_both', count: 16 }, { bucket: 'sf_only', count: 9 }]);
  });

  test('a throwing query degrades each figure to null / empty (missing tables)', async () => {
    const boom = async () => { throw new Error("Table doesn't exist"); };
    const d = await dashboard_counts(boom);
    assert.equal(d.total_accounts, null);
    assert.equal(d.merge_id_accounts, null);
    assert.equal(d.clusters, null);
    assert.equal(d.duplicate_pairs, null);
    assert.deepEqual(d.buckets, []);
  });
});
