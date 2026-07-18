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
    sobject: (type) => ({
      update: async (fields) => { calls.update.push({ type, fields }); return overrides.updateResult || { success: true, id: fields.Id }; },
      create: async (fields) => { calls.create = calls.create || []; calls.create.push({ type, fields }); return overrides.createResult || { success: true, id: 'NEW001' }; },
      destroy: async (id) => { calls.destroy = calls.destroy || []; calls.destroy.push({ type, id }); return overrides.destroyResult || { success: true, id }; },
      describe: async () => (overrides.describe || { fields: [{ name: 'usat_was_merged__c' }, { name: 'usat_was_merged_date__c' }, { name: 'usat_was_merged_by__c' }] }),
    }),
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

test('create_record requires fields and returns the new id', async () => {
  const conn = fakeConn();
  await assert.rejects(() => sw.create_record(conn, 'Account', {}));
  const r = await sw.create_record(conn, 'Account', { FirstName: 'Lee', LastName: 'One' });
  assert.equal(conn.calls.create[0].type, 'Account');
  assert.equal(conn.calls.create[0].fields.LastName, 'One');
  assert.ok(!conn.calls.create[0].fields.Id, 'no Id on create payload');
  assert.equal(r.success, true);
  assert.equal(r.id, 'NEW001');
});

test('delete_record requires an id and destroys the record', async () => {
  const conn = fakeConn();
  await assert.rejects(() => sw.delete_record(conn, 'ContentDocumentLink', ''));
  const r = await sw.delete_record(conn, 'ContentDocumentLink', '06Ac0001');
  assert.equal(conn.calls.destroy[0].type, 'ContentDocumentLink');
  assert.equal(conn.calls.destroy[0].id, '06Ac0001');
  assert.equal(r.success, true);
});

test('stamp_survivor MERGE sets flag=true, date, and "MERGE — <actor>" text', async () => {
  const conn = fakeConn();
  const r = await sw.stamp_survivor(conn, '001M', 'MERGE', 'skip via svc@sf');
  assert.equal(r.stamped, true);
  assert.equal(r.count, 3);
  const u = conn.calls.update[0];
  assert.equal(u.type, 'Account');
  assert.equal(u.fields.Id, '001M');
  assert.equal(u.fields.usat_was_merged__c, true);
  assert.ok(u.fields.usat_was_merged_date__c, 'date written');
  assert.equal(u.fields.usat_was_merged_by__c, 'MERGE — skip via svc@sf');
});

test('stamp_survivor RESTORE/RECREATE set flag=false and the action text', async () => {
  for (const action of ['RESTORE', 'RECREATE']) {
    const conn = fakeConn();
    const r = await sw.stamp_survivor(conn, '001M', action, 'skip');
    assert.equal(r.stamped, true);
    assert.equal(conn.calls.update[0].fields.usat_was_merged__c, false, action + ' clears the merged flag');
    assert.equal(conn.calls.update[0].fields.usat_was_merged_by__c, action + ' — skip');
  }
});

test('stamp_survivor writes only present fields; none present -> skipped, no update', async () => {
  const conn = fakeConn({ describe: { fields: [{ name: 'usat_was_merged__c' }] } }); // only the flag exists
  const r = await sw.stamp_survivor(conn, '001M', 'MERGE', 'skip');
  assert.equal(r.stamped, true);
  assert.equal(r.count, 1);
  assert.ok('usat_was_merged__c' in conn.calls.update[0].fields);
  assert.ok(!('usat_was_merged_by__c' in conn.calls.update[0].fields));

  const conn2 = fakeConn({ describe: { fields: [] } }); // no stamp fields at all
  const r2 = await sw.stamp_survivor(conn2, '001M', 'MERGE', 'skip');
  assert.equal(r2.stamped, false);
  assert.equal(conn2.calls.update.length, 0, 'no update attempted when nothing to stamp');
});

test('stamp_survivor never throws — a write error is returned, not raised', async () => {
  const conn = fakeConn();
  conn.sobject = () => ({ describe: async () => ({ fields: [{ name: 'usat_was_merged__c' }] }), update: async () => { throw new Error('FIELD_INTEGRITY_EXCEPTION'); } });
  const r = await sw.stamp_survivor(conn, '001M', 'MERGE', 'skip');
  assert.equal(r.stamped, false);
  assert.match(r.error, /FIELD_INTEGRITY/);
});

test('attach_file creates one ContentVersion + a ContentDocumentLink per target record', async () => {
  const calls = { create: [], query: [] };
  const conn = {
    sobject: (type) => ({ create: async (fields) => { calls.create.push({ type, fields }); return { success: true, id: type === 'ContentVersion' ? '068VER' : '06AL' + calls.create.length }; } }),
    query: async (soql) => { calls.query.push(soql); return { records: [{ ContentDocumentId: '069DOC' }] }; },
  };
  const r = await sw.attach_file(conn, 'dossier.xlsx', Buffer.from('hi'), ['001A', '001B', '001A']);
  assert.equal(r.attached, true);
  assert.equal(r.content_document_id, '069DOC');
  const cv = calls.create.find((c) => c.type === 'ContentVersion');
  assert.equal(cv.fields.PathOnClient, 'dossier.xlsx');
  assert.equal(cv.fields.VersionData, Buffer.from('hi').toString('base64'), 'file base64-encoded');
  const links = calls.create.filter((c) => c.type === 'ContentDocumentLink');
  assert.equal(links.length, 2, 'deduped targets -> 2 links');
  assert.equal(links[0].fields.ContentDocumentId, '069DOC');
});

test('attach_file publishes to the primary record (FirstPublishLocationId) and only viewer-links the rest', async () => {
  const calls = { create: [], query: [] };
  const conn = {
    sobject: (type) => ({ create: async (fields) => { calls.create.push({ type, fields }); return { success: true, id: type === 'ContentVersion' ? '068VER' : '06AL' + calls.create.length }; } }),
    query: async () => ({ records: [{ ContentDocumentId: '069DOC' }] }),
  };
  const r = await sw.attach_file(conn, 'd.xlsx', Buffer.from('hi'), ['001SURV', '001LOSE'], { first_publish_location_id: '001SURV' });
  assert.equal(r.attached, true);
  const cv = calls.create.find((c) => c.type === 'ContentVersion');
  assert.equal(cv.fields.FirstPublishLocationId, '001SURV', 'published to the survivor like a native upload');
  const links = calls.create.filter((c) => c.type === 'ContentDocumentLink');
  assert.equal(links.length, 1, 'only the non-primary record gets a viewer link');
  assert.equal(links[0].fields.LinkedEntityId, '001LOSE');
  assert.ok(r.links.some((l) => l.id === '001SURV' && l.note === 'primary'), 'survivor recorded as the primary publish');
});

test('attach_file is best-effort — no records or bad create returns without throwing', async () => {
  const conn = { sobject: () => ({ create: async () => ({ success: true, id: 'x' }) }), query: async () => ({ records: [] }) };
  assert.deepEqual((await sw.attach_file(conn, 'f.xlsx', Buffer.from('x'), [])).attached, false);
  const conn2 = { sobject: () => ({ create: async () => { throw new Error('INSUFFICIENT_ACCESS'); } }), query: async () => ({ records: [] }) };
  const r2 = await sw.attach_file(conn2, 'f.xlsx', Buffer.from('x'), ['001A']);
  assert.equal(r2.attached, false);
  assert.ok(r2.errors.length >= 1);
});

test('using_dedicated_write_user reflects env', () => {
  const saved = process.env.SF_DEV_WRITE_USERNAME;
  delete process.env.SF_DEV_WRITE_USERNAME;
  assert.equal(sw.using_dedicated_write_user(true), false);
  process.env.SF_DEV_WRITE_USERNAME = 'merge.user@usat.test';
  assert.equal(sw.using_dedicated_write_user(true), true);
  if (saved === undefined) delete process.env.SF_DEV_WRITE_USERNAME; else process.env.SF_DEV_WRITE_USERNAME = saved;
});


test('_is_transient flags retryable contention, not real validation errors', () => {
  assert.ok(sw._is_transient('UNABLE_TO_LOCK_ROW: unable to obtain exclusive access'));
  assert.ok(sw._is_transient('deadlock detected'));
  assert.ok(sw._is_transient('ECONNRESET'));
  assert.ok(!sw._is_transient('INVALID_FIELD: bad field'));
  assert.ok(!sw._is_transient('REQUIRED_FIELD_MISSING'));
  assert.ok(!sw._is_transient(''));
});

test('merge_one retries a transient lock THROW, then succeeds', async () => {
  process.env.MERGE_LOCK_BACKOFF_MS = '1';
  let n = 0;
  const conn = { soap: { merge: async (req) => { n += 1; if (n < 3) throw new Error('UNABLE_TO_LOCK_ROW: try later'); return { success: true, id: req.masterRecord.Id, mergedRecordIds: req.recordToMergeIds }; } } };
  const r = await sw.merge_one(conn, '001A', ['001B']);
  assert.strictEqual(n, 3);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.attempts, 3);
  delete process.env.MERGE_LOCK_BACKOFF_MS;
});

test('merge_one does NOT retry a non-transient error (fails first try)', async () => {
  let n = 0;
  const conn = { soap: { merge: async () => { n += 1; throw new Error('INVALID_FIELD: nope'); } } };
  await assert.rejects(() => sw.merge_one(conn, '001A', ['001B']), /INVALID_FIELD/);
  assert.strictEqual(n, 1);
});

test('merge_one retries a returned success:false lock failure', async () => {
  process.env.MERGE_LOCK_BACKOFF_MS = '1';
  let n = 0;
  const conn = { soap: { merge: async (req) => { n += 1; if (n < 2) return { success: false, errors: [{ statusCode: 'UNABLE_TO_LOCK_ROW', message: 'locked' }] }; return { success: true, id: req.masterRecord.Id }; } } };
  const r = await sw.merge_one(conn, '001A', ['001B']);
  assert.strictEqual(n, 2);
  assert.strictEqual(r.success, true);
  delete process.env.MERGE_LOCK_BACKOFF_MS;
});
