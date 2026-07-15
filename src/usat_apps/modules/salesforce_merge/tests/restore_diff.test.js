'use strict';
// Restore diff builder + diff_for_entry (injected fakes; no MySQL / Salesforce).
//   node --test modules/salesforce_merge/tests/restore_diff.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const rd = require('../store/restore_diff');

describe('build_master_diff', () => {
  test('all fields equal -> in_sync, every row match', () => {
    const master = { PersonEmail: 'a@b.com', Phone: '555-1234', Id: 'X', Name: 'skip' };
    const current = { PersonEmail: 'a@b.com', Phone: '555-1234' };
    const d = rd.build_master_diff(master, current);
    assert.equal(d.in_sync, true);
    assert.equal(d.summary.differ, 0);
    assert.equal(d.summary.matched, 2);            // Id + Name are skipped
    assert.ok(d.rows.every((r) => r.state === 'match'));
  });

  test('a changed field -> differ + not in_sync, before/after captured', () => {
    const d = rd.build_master_diff({ PersonEmail: 'old@x.com' }, { PersonEmail: 'new@x.com' });
    assert.equal(d.in_sync, false);
    assert.equal(d.summary.differ, 1);
    assert.equal(d.rows[0].before, 'old@x.com');
    assert.equal(d.rows[0].after, 'new@x.com');
    assert.equal(d.rows[0].state, 'differ');
  });

  test('normalization: case/whitespace and zip5 equal are matches', () => {
    const d = rd.build_master_diff(
      { PersonMailingCity: 'Denver ', PersonMailingPostalCode: '80202-1234' },
      { PersonMailingCity: 'DENVER', PersonMailingPostalCode: '80202' });
    assert.equal(d.in_sync, true);
    assert.equal(d.summary.differ, 0);
  });

  test('empty snapshot values are not compared (restore would not set them)', () => {
    const d = rd.build_master_diff({ PersonEmail: '', Phone: null, Fax: '   ' }, { PersonEmail: 'x@y.com' });
    assert.equal(d.summary.total, 0);
  });

  test('missing current record -> every field state missing, not in_sync', () => {
    const d = rd.build_master_diff({ PersonEmail: 'a@b.com' }, null);
    assert.equal(d.in_sync, false);
    assert.equal(d.summary.missing, 1);
    assert.equal(d.rows[0].state, 'missing');
  });
});

describe('diff_for_entry', () => {
  const baseDeps = () => ({
    queue: { list: async () => [{ id: 7, survivor_account: 'S1', survivor_name: 'Jane', status: 'done', environment: 'Sandbox' }] },
    snapshot: { list_for_entry: async () => [
      { role: 'survivor', account: 'S1', fields: { PersonEmail: 'old@x.com', Phone: '555' } },
      { role: 'loser', account: 'L1', fields: {} },
    ] },
    restore: {
      from_snapshot: (rows, sid) => ({ master: { PersonEmail: 'old@x.com', Phone: '555' }, loserIds: ['L1'], children: [] }),
      account_states: async () => ({ L1: 'deleted' }),
    },
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox' }) },
    connect: async () => ({}),
  });

  test('drifted survivor: differ counted, loser state surfaced', async () => {
    const deps = baseDeps();
    deps.read = { fetch_accounts_by_ids: async () => [{ account: 'S1', PersonEmail: 'NEW@x.com', Phone: '555' }] };
    const r = await rd.diff_for_entry(7, deps);
    assert.equal(r.in_sync, false);
    assert.equal(r.survivor.summary.differ, 1);   // email changed
    assert.equal(r.survivor.summary.matched, 1);  // phone same
    assert.deepEqual(r.losers, [{ id: 'L1', state: 'deleted' }]);
  });

  test('in-sync survivor: in_sync true', async () => {
    const deps = baseDeps();
    deps.read = { fetch_accounts_by_ids: async () => [{ account: 'S1', PersonEmail: 'old@x.com', Phone: '555' }] };
    const r = await rd.diff_for_entry(7, deps);
    assert.equal(r.in_sync, true);
    assert.equal(r.survivor.summary.differ, 0);
  });

  test('no snapshot -> error surfaced, no throw', async () => {
    const deps = baseDeps();
    deps.snapshot = { list_for_entry: async () => [] };
    deps.read = { fetch_accounts_by_ids: async () => [] };
    const r = await rd.diff_for_entry(7, deps);
    assert.match(r.error, /no pre-merge snapshot/i);
  });

  test('entry not found -> error', async () => {
    const deps = baseDeps();
    deps.queue = { list: async () => [] };
    deps.read = { fetch_accounts_by_ids: async () => [] };
    const r = await rd.diff_for_entry(7, deps);
    assert.match(r.error, /not found/i);
  });

  test('live fetch failure is non-fatal (fetch_error set, survivor missing)', async () => {
    const deps = baseDeps();
    deps.read = { fetch_accounts_by_ids: async () => { throw new Error('FIELD_INTEGRITY_EXCEPTION'); } };
    const r = await rd.diff_for_entry(7, deps);
    assert.match(r.fetch_error, /FIELD_INTEGRITY/);
    assert.equal(r.survivor_missing, true);
  });
});
