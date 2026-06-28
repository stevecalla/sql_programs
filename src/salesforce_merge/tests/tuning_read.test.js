'use strict';
// duplicates_read.sweep_profiles — reads the sweep profile table (baseline first), coerces numbers.
// Injected fake query (no MySQL).
//   node --test src/salesforce_merge/tests/tuning_read.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sweep_profiles } = require('../store/duplicates_read');

describe('sweep_profiles', () => {
  test('orders baseline first, maps booleans + numbers', async () => {
    let captured = null;
    const fake = async (sql) => {
      captured = sql;
      return [
        { label: 'baseline', is_baseline: 1, nickname_enabled: 1, rule_fields: 'gender+birthdate+zip',
          fuzzy_threshold: '90', zip_trim_len: '5', total_records: '700682', accounts_in_clusters: '25121',
          duplicate_pairs: '17398', exact_pairs: '14800', fuzzy_pairs: '1100', nickname_pairs: '1498',
          consolidated_clusters: '10623', comp_exact: '9100', comp_fuzzy: '600', comp_nickname: '800', comp_multi: '123' },
      ];
    };
    const { profiles } = await sweep_profiles(fake);
    assert.match(captured, /ORDER BY is_baseline DESC, ordinal ASC/);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].is_baseline, true);
    assert.equal(profiles[0].nickname_enabled, true);
    assert.equal(profiles[0].consolidated_clusters, 10623);
    assert.equal(typeof profiles[0].consolidated_clusters, 'number');
    assert.equal(profiles[0].accounts_in_clusters, 25121);
  });

  test('missing table degrades to an empty list', async () => {
    const boom = async () => { throw new Error("Table doesn't exist"); };
    const { profiles } = await sweep_profiles(boom);
    assert.deepEqual(profiles, []);
  });
});
