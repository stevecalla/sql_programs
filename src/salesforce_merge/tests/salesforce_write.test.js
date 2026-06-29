'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const sw = require('../store/salesforce_write');

// Fake jsforce connection capturing SOAP merge/undelete + sobject update calls.
function fakeConn(overrides = {}) {
  const calls = { merge: [], undelete: [], update: [] };
  const conn = {
    calls,
    soap: {
      merge: async (req) => { calls.merge.push(req); return overrides.mergeResult || { success: true, id: req.masterRecord.Id, mergedRecordIds: req.recordToMergeIds }; },
      undelete: async (ids) => { calls.undelete.push(ids); return (overrides.undeleteResult || ids.map((id) => ({ id, success: true }))); },
    },
    sobject: (type) => ({ update: async (fields) => { calls.update.push({ type, fields }); return overrides.updateResult || { success: true, id: fields.Id }; } }),
  };
  return conn;
}

test('merge_one builds masterRecord with survivor fields + up to 2 losers, normalizes result', async () => {
  const conn = fakeConn();
  const r = await sw.merge_one(conn, '001MASTER', ['001L1', '001L2', '001L3'], { cfg_Member_Number__pc: '1001' });
  assert.equal(conn.calls.merge.length, 1);
  const req = conn.calls.merge[0];
  assert.equal(req.masterRecord.type, 'Account');
  assert.equal(req.masterRecord.Id, '001MASTER');
  assert.equal(req.masterRecord.cfg_Member_Number__pc, '1001');
  assert.deepEqual(req.recordToMergeIds, ['001L1', '001L2']); // capped at 2
  assert.equal(r.success, true);
  assert.equal(r.id, '001MASTER');
  assert.deepEqual(r.mergedRecordIds, ['001L1', '001L2']);
});

test('merge_one requires master and at least one loser', async () => {
  const conn = fakeConn();
  await assert.rejects(() => sw.merge_one(conn, '', ['001L1']));
  await assert.rejects(() => sw.merge_one(conn, '001MASTER', []));
});

test('merge_one surfaces failure result', async () => {
  const conn = fakeConn({ mergeResult: { success: false, errors: [{ message: 'too many children' }] } });
  const r = await sw.merge_one(conn, '001MASTER', ['001L1']);
  assert.equal(r.success, false);
  assert.equal(r.errors[0].message, 'too many children');
});

test('undelete restores ids and normalizes', async () => {
  const conn = fakeConn();
  const r = await sw.undelete(conn, ['001L1', '001L2']);
  assert.deepEqual(conn.calls.undelete[0], ['001L1', '001L2']);
  assert.equal(r.length, 2);
  assert.equal(r[0].success, true);
  assert.deepEqual(await sw.undelete(conn, []), []); // empty -> no call
});

test('update_record requires Id and passes through', async () => {
  const conn = fakeConn();
  await assert.rejects(() => sw.update_record(conn, 'Opportunity', { AccountId: 'x' }));
  const r = await sw.update_record(conn, 'Opportunity', { Id: '006X', AccountId: '001L1' });
  assert.equal(conn.calls.update[0].type, 'Opportunity');
  assert.equal(conn.calls.update[0].fields.AccountId, '001L1');
  assert.equal(r.success, true);
});

test('using_dedicated_write_user reflects env', () => {
  const saved = process.env.SF_DEV_WRITE_USERNAME;
  delete process.env.SF_DEV_WRITE_USERNAME;
  assert.equal(sw.using_dedicated_write_user(true), false);
  process.env.SF_DEV_WRITE_USERNAME = 'merge.user@usat.test';
  assert.equal(sw.using_dedicated_write_user(true), true);
  if (saved === undefined) delete process.env.SF_DEV_WRITE_USERNAME; else process.env.SF_DEV_WRITE_USERNAME = saved;
});
