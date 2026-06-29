'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ex = require('../store/merge_execute');

function deps(entry, { env = 'Sandbox', orgId = '00Dx', accounts } = {}) {
  const log = { history: [], snapshots: [] };
  return {
    log,
    deps: {
      queue: { list: async () => [entry] },
      cluster: { cluster_detail: async () => ({ accounts: accounts || [{ account: 'A' }, { account: 'B' }] }) },
      snapshot: { save: async (r, e, a) => { log.snapshots.push(a.length); return { saved: a.length }; } },
      history: { write: async (row) => { log.history.push(row); return { id: 1 }; } },
      dashboard: { dataset_info: async () => ({ environment: env }) },
      sf: { get_org_identity: async () => ({ org_id: orgId }) },
    },
  };
}

test('safe mode: a matching entry is simulated, snapshotted, and logged (no write)', async () => {
  const e = { id: 1, source_type: 'merge_id', source_key: 'M1', survivor_account: 'A', survivor_name: 'Keep',
    loser_accounts: 'B', loser_count: 1, environment: 'Sandbox', org_id: '00Dx', child_counts: { total: 3 } };
  const { log, deps: d } = deps(e);
  const out = await ex.process([1], { dry_run: false }, d);
  assert.equal(out.safe_mode, true);
  assert.equal(out.simulated, 1);
  assert.equal(out.skipped, 0);
  assert.equal(log.snapshots[0], 2);
  assert.equal(log.history[0].result, 'simulated');
  assert.equal(log.history[0].snapshot_saved, 1);
  assert.equal(log.history[0].child_total, 3);
});

test('environment mismatch is skipped before any snapshot', async () => {
  const e = { id: 2, source_type: 'merge_id', source_key: 'M2', survivor_account: 'A', loser_accounts: 'B', environment: 'Production', org_id: '00Dprod' };
  const { log, deps: d } = deps(e, { env: 'Sandbox', orgId: '00Dsbx' });
  const out = await ex.process([2], {}, d);
  assert.equal(out.skipped, 1);
  assert.equal(log.snapshots.length, 0);
  assert.match(log.history[0].reason, /environment mismatch/);
});

test('drift (a record no longer present) is skipped', async () => {
  const e = { id: 3, source_type: 'merge_id', source_key: 'M3', survivor_account: 'A', loser_accounts: 'B;C', environment: 'Sandbox', org_id: '00Dx' };
  const { log, deps: d } = deps(e, { accounts: [{ account: 'A' }, { account: 'B' }] });
  const out = await ex.process([3], {}, d);
  assert.equal(out.skipped, 1);
  assert.match(log.history[0].reason, /changed since queueing/);
});

test('verify_alignment: org mismatch fails, match passes', () => {
  assert.equal(ex.verify_alignment({ environment: 'Sandbox', org_id: 'A' }, { environment: 'Sandbox', org_id: 'B' }).ok, false);
  assert.equal(ex.verify_alignment({ environment: 'Sandbox', org_id: 'A' }, { environment: 'Sandbox', org_id: 'A' }).ok, true);
});
