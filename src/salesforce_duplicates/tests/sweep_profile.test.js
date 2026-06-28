'use strict';
// Sweep profile output (composition + totals) and the DB writer that feeds the merge console's
// Tuning panel. Pure — no MySQL (write uses a fake executor).
//   node --test tests/sweep_profile.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { expand_grid, run_profile } = require('../src/sweep');
const { write_sweep_profiles } = require('../src/database_results');

const rec = (id, first, last) => ({
  Id: id, FirstName: first, LastName: last,
  cfg_Gender_Identity__pc: 'M', PersonBirthdate: '1990-01-01', BillingPostalCode: '12345',
  cfg_Member_Number__pc: '', usat_Salesforce_Merge_Id__pc: '',
});

describe('run_profile composition + totals', () => {
  test('an exact-duplicate pair yields one exact-composition cluster with the right tallies', () => {
    const baseline = expand_grid({})[0];                  // production-equivalent criteria
    const out = run_profile([rec('1', 'John', 'Smith'), rec('2', 'John', 'Smith')], baseline);
    const k = out.counts;
    assert.equal(k.consolidated_clusters, 1);
    assert.equal(k.comp_exact, 1);
    assert.equal(k.comp_fuzzy, 0);
    assert.equal(k.comp_nickname, 0);
    assert.equal(k.comp_multi, 0);
    // composition splits sum to total clusters
    assert.equal(k.comp_exact + k.comp_fuzzy + k.comp_nickname + k.comp_multi, k.consolidated_clusters);
    assert.equal(k.accounts_in_clusters, 2);              // both records in the one cluster
    assert.equal(k.match_pairs, 1);                       // one matched pair (the exact edge)
    assert.equal(k.exact_pairs, 1);
  });
});

describe('write_sweep_profiles', () => {
  test('drops + recreates the table and inserts one row per profile (19 columns)', async () => {
    const calls = [];
    const ex = async (sql, params) => { calls.push({ sql, params: params || [] }); };
    const results = [{
      criteria: { label: 'baseline', is_baseline: true, fuzzy_threshold: 90, nickname_enabled: true, rule_fields: ['gender', 'birthdate', 'zip'], zip_trim_len: 5 },
      counts: { total_records: 100, accounts_in_clusters: 20, match_pairs: 14, exact_pairs: 12, fuzzy_pairs: 1, nickname_pairs: 1, consolidated_clusters: 9, comp_exact: 7, comp_fuzzy: 1, comp_nickname: 1, comp_multi: 0 },
    }];
    const n = await write_sweep_profiles(ex, 'salesforce_duplicate_sweep_profile', 'RUN1', results);
    assert.equal(n, 1);
    assert.ok(calls.some((c) => /DROP TABLE/.test(c.sql)));
    assert.ok(calls.some((c) => /CREATE TABLE/.test(c.sql) && /comp_multi/.test(c.sql)));
    const ins = calls.find((c) => /INSERT INTO/.test(c.sql));
    assert.equal(ins.params.length, 19);                  // 19 columns
    assert.equal(ins.params[0], 'RUN1');
    assert.equal(ins.params[2], 'baseline');
  });
});
