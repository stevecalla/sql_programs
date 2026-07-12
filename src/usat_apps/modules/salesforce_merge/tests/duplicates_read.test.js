'use strict';
// duplicates_read maps query rows into the dashboard shape, and degrades to nulls when a table
// is missing. Uses an injected fake query (no MySQL).
//   node --test src/salesforce_merge/tests/duplicates_read.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { dashboard_counts, sweep_profiles, sweep_export_rows } = require('../store/duplicates_read');

const sweep_fake = async (sql) => {
  if (/run_type = 'sweep'/.test(sql)) return [{ run_at: '2026-06-30T12:00:00Z' }];
  if (/ORDER BY is_baseline/.test(sql)) return [
    { label: 'baseline', is_baseline: 1, nickname_enabled: 1, rule_fields: 'gender+birthdate+zip', fuzzy_threshold: 90, consolidated_clusters: 100, accounts_in_clusters: 200, comp_exact: 60, comp_fuzzy: 20, comp_nickname: 10, comp_multi: 10 },
    { label: 't90_gb', is_baseline: 0, nickname_enabled: 1, rule_fields: 'gender+birthdate', fuzzy_threshold: 90, consolidated_clusters: 160, accounts_in_clusters: 320, comp_exact: 100, comp_fuzzy: 30, comp_nickname: 20, comp_multi: 10 },
  ];
  return [];
};

describe('sweep_profiles + sweep_export_rows', () => {
  test('sweep_profiles returns profiles plus the sweep run_at', async () => {
    const r = await sweep_profiles(sweep_fake);
    assert.equal(r.profiles.length, 2);
    assert.equal(r.profiles[0].is_baseline, true);
    assert.equal(r.run_at, '2026-06-30T12:00:00Z');
  });
  test('sweep_export_rows builds flat rows with Δ vs baseline', async () => {
    const rows = await sweep_export_rows(sweep_fake);
    const nonBase = rows.find((x) => !/^baseline/.test(x.profile));
    assert.equal(nonBase.total_clusters, 160);
    assert.equal(nonBase.delta_clusters, 60);   // 160 - 100
    assert.equal(nonBase.delta_accounts, 120);  // 320 - 200
  });
});

describe('dashboard_counts', () => {
  test('maps query results into the dashboard shape', async () => {
    const fake = async (sql) => {
      if (/GROUP BY Bucket__c/.test(sql)) return [{ bucket: 'in_both', n: 16 }, { bucket: 'sf_only', n: 9 }];
      if (/Group_Record_Count__c/.test(sql)) return [{ n: 25121 }];   // sum of cluster sizes (duplicate accounts)
      if (/Match_Link_Count__c/.test(sql)) return [{ n: 17398 }];     // matched pairs
      if (/consolidated_cluster/.test(sql)) return [{ n: 10623 }];
      if (/salesforce_merge_id <> ''/.test(sql)) return [{ n: 25 }];
      if (/salesforce_account_duplicate_snapshot/.test(sql)) return [{ n: 700682 }];
      return [{ n: 0 }];
    };
    const d = await dashboard_counts(fake);
    assert.equal(d.total_accounts, 700682);
    assert.equal(d.merge_id_accounts, 25);
    assert.equal(d.clusters, 10623);
    assert.equal(d.accounts_in_clusters, 25121);
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
