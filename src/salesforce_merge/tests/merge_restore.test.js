'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
process.env.MERGE_LOG = 'off';
const mr = require('../store/merge_restore');

function deps(opts = {}) {
  const calls = { undeletes: [], updates: [], history: [], transitions: [] };
  const entry = Object.assign({ id: 7, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M',
    loser_accounts: 'L1;L2', loser_count: 2, environment: 'Sandbox' }, opts.entry || {});
  const snapRows = opts.snapRows || [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1' } },
    { role: 'loser', account: 'L2', fields: { account: 'L2' } },
    { role: 'child', account: 'L1', fields: { object: 'Opportunity', id: '006A', parent_field: 'AccountId', parent_id: 'L1', child_type: 'child' } },
    { role: 'child', account: 'L1', fields: { object: 'Account', id: 'L1', parent_field: 'PersonContactId', parent_id: 'cL1', child_type: 'self_account' } },
  ];
  const deletedIds = opts.deletedIds || ['L1', 'L2'];
  const conn = { query: async () => ({ records: ['L1', 'L2'].map((id) => ({ Id: id, IsDeleted: deletedIds.includes(id) })) }) };
  return {
    calls,
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox', run_at: 'x' }) },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    snapshot: { list_for_entry: async () => snapRows },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; } },
    run: { start: async () => {}, update: async () => {}, finish: async () => {} },
    write: {
      default_write_connect: async () => conn,
      undelete: async (c, ids) => { calls.undeletes.push(ids); return ids.map((id) => ({ id, success: true })); },
      update_record: async (c, type, fields) => { calls.updates.push({ type, fields }); return { success: true, id: fields.Id }; },
    },
  };
}

test('from_snapshot splits master/losers/children', () => {
  const { master, loserIds, children } = mr.from_snapshot([
    { role: 'survivor', account: 'M', fields: { PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: {} },
    { role: 'child', account: 'L1', fields: { object: 'Case', id: '500', parent_field: 'AccountId', parent_id: 'L1' } },
  ], 'M');
  assert.equal(master.PersonEmail, 'm@x.com');
  assert.deepEqual(loserIds, ['L1']);
  assert.equal(children.length, 1);
});

test('list_restorable flags eligibility from Recycle Bin presence', async () => {
  const d = deps();
  const list = await mr.list_restorable(d);
  assert.equal(list[0].restorable, true);
  const d2 = deps({ deletedIds: ['L1'] }); // only one recoverable
  const list2 = await mr.list_restorable(d2);
  assert.equal(list2[0].restorable, false);
});

test('restore simulate: no writes, status unchanged, simulated history', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;
  const d = deps();
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d); // flag off -> simulate
  assert.equal(out.mode, 'simulate');
  assert.equal(out.simulated, 1);
  assert.equal(d.calls.undeletes.length, 0);
  assert.equal(d.calls.transitions.length, 0);
  assert.equal(d.calls.history[0].result, 'simulated');
});

test('restore execute eligible: undelete + re-point children + reset master + status->restored', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);
  assert.deepEqual(d.calls.undeletes[0], ['L1', 'L2']);
  const childUpd = d.calls.updates.find((u) => u.type === 'Opportunity');
  assert.equal(childUpd.fields.AccountId, 'L1');       // re-pointed to original parent
  const masterUpd = d.calls.updates.find((u) => u.type === 'Account');
  assert.equal(masterUpd.fields.PersonEmail, 'm@x.com'); // master reset from snapshot
  assert.ok(!d.calls.updates.find((u) => u.type === 'Account' && u.fields.Id === 'L1'), 'self-half not re-pointed');
  assert.equal(d.calls.transitions[0].to, 'restored');
  assert.equal(d.calls.history[0].result, 'restored');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute past window: skipped, no writes', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ deletedIds: [] }); // nothing recoverable
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(d.calls.undeletes.length, 0);
  assert.match(d.calls.history[0].reason, /not restorable/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});
