'use strict';
// Stage-time baseline store + the merge drift check (live vs staged). Injected fakes; no MySQL / SF.
//   node --test modules/salesforce_merge/tests/merge_drift.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const base = require('../store/merge_stage_baseline');
const rdiff = require('../store/restore_diff');

describe('merge_stage_baseline', () => {
  test('save upserts (delete + insert) then get parses the map back', async () => {
    const calls = [];
    let stored = null;
    const query = async (sql, params) => {
      calls.push(sql);
      if (/^INSERT/i.test(sql)) { stored = params; return {}; }
      if (/^SELECT/i.test(sql)) return stored ? [{ fields: stored[1] }] : [];
      return {};
    };
    await base.save(5, { S1: { PersonEmail: 'a@b.com' } }, query);
    assert.ok(calls.some((s) => /^DELETE/i.test(s)), 'delete first (keep-latest)');
    assert.ok(calls.some((s) => /^INSERT/i.test(s)), 'insert');
    const got = await base.get(5, query);
    assert.deepEqual(got, { S1: { PersonEmail: 'a@b.com' } });
  });

  test('get returns null when nothing captured', async () => {
    const query = async (sql) => (/^SELECT/i.test(sql) ? [] : {});
    assert.equal(await base.get(9, query), null);
  });
});

// The execute-time drift helper is compute_drift(baseline, accounts, buildDiff). It's a local function
// in merge_execute, but its behaviour is fully defined by restore_diff.build_master_diff over each
// account, so we assert the underlying builder here (the same call the helper makes).
describe('drift via build_master_diff (baseline before vs live after)', () => {
  test('a changed field is a differ; unchanged is a match', () => {
    const baseline = { PersonEmail: 'old@x.com', Phone: '555' };
    const live = { PersonEmail: 'new@x.com', Phone: '555' };
    const d = rdiff.build_master_diff(baseline, live);
    const differ = d.rows.filter((r) => r.state === 'differ');
    assert.equal(differ.length, 1);
    assert.equal(differ[0].field, 'PersonEmail');
    assert.equal(differ[0].before, 'old@x.com');
    assert.equal(differ[0].after, 'new@x.com');
  });

  test('no drift when live equals baseline (normalized)', () => {
    const d = rdiff.build_master_diff({ PersonMailingPostalCode: '80202-1234' }, { PersonMailingPostalCode: '80202' });
    assert.equal(d.summary.differ, 0);
  });
});
