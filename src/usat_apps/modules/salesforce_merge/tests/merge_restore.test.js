'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
process.env.MERGE_LOG = 'off';
const mr = require('../store/merge_restore');

function deps(opts = {}) {
  const calls = { undeletes: [], updates: [], history: [], transitions: [], creates: [], deletes: [], seq: [] };
  const entry = Object.assign({ id: 7, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M',
    loser_accounts: 'L1;L2', loser_count: 2, environment: 'Sandbox' }, opts.entry || {});
  const snapRows = opts.snapRows || [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', FirstName: 'Lee', LastName: 'One', Id: 'L1' } },
    { role: 'loser', account: 'L2', fields: { account: 'L2', FirstName: 'Lou', LastName: 'Two', Id: 'L2' } },
    { role: 'child', account: 'L1', child_type: 'child', fields: { object: 'Opportunity', id: '006A', parent_field: 'AccountId', parent_id: 'L1', child_type: 'child' } },
    { role: 'child', account: 'L1', child_type: 'self_account', fields: { object: 'Account', id: 'L1', parent_field: 'PersonContactId', parent_id: 'cL1', child_type: 'self_account' } },
  ];
  const deletedIds = opts.deletedIds || ['L1', 'L2'];
  const presentIds = opts.presentIds || ['L1', 'L2']; // records the scanAll query still returns (exist); absent = purged
  const conn = { query: async () => ({ records: ['L1', 'L2'].filter((id) => presentIds.includes(id)).map((id) => ({ Id: id, IsDeleted: deletedIds.includes(id) })) }) };
  return {
    calls,
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox', run_at: 'x' }) },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    snapshot: { list_for_entry: async () => snapRows },
    // Inject a fake post-merge snapshot store so the post-merge-edit gate never touches the real DB.
    post_snapshot: { get: async () => (opts.post_snapshot === undefined ? null : opts.post_snapshot) },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; },
      set_dossier: async (hid, did, doc) => { calls.setDossier = { hid, did, doc }; return { updated: 1 }; } },
    // Fake dossier store so restore/recreate wiring is exercised without building a real workbook or touching the DB.
    dossier: { attach_enabled: (o) => !o || o.attach_dossier !== false,
      generate: async (o) => { calls.dossier = calls.dossier || []; calls.dossier.push(o); return { generated: true, dossier_id: 88, content_document_id: '069R', attached: true, links: [] }; } },
    run: { start: async () => {}, update: async () => {}, finish: async () => {} },
    write: {
      default_write_connect: async () => conn,
      undelete: async (c, ids) => { calls.undeletes.push(ids); calls.seq.push('undelete'); return ids.map((id) => ({ id, success: true })); },
      update_record: async (c, type, fields) => { calls.updates.push({ type, fields }); calls.seq.push('update:' + type); return { success: true, id: fields.Id }; },
      create_record: async (c, type, fields) => { calls.creates.push({ type, fields }); return { success: true, id: 'NEW_' + calls.creates.length }; },
      delete_record: async (c, type, id) => { calls.deletes.push({ type, id }); return { success: true, id }; },
      stamp_survivor: async (c, id, action) => { calls.stamp = { id, action }; return { stamped: false, count: 0, skipped: 'test' }; },
      attach_file: async () => ({ attached: true, content_document_id: '069R', links: [] }),
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

test('master_reset_fields excludes fields in the keep set (selective restore)', () => {
  const all = mr.master_reset_fields({ PersonEmail: 'a@b.com', Phone: '555' }, 'M');
  assert.equal(all.PersonEmail, 'a@b.com');
  assert.equal(all.Phone, '555');
  const kept = mr.master_reset_fields({ PersonEmail: 'a@b.com', Phone: '555' }, 'M', new Set(['PersonEmail']));
  assert.equal(kept.PersonEmail, undefined);   // kept at current value -> not reset
  assert.equal(kept.Phone, '555');
});

test('restore selective: keep_fields leaves that field out of the survivor reset', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ snapRows: [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com', Phone: '111' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
    { role: 'loser', account: 'L2', fields: { account: 'L2', Id: 'L2' } },
  ] });
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE', keep_fields: { 7: ['PersonEmail'] } }, d);
  assert.equal(out.restored, 1);
  const acctUpd = d.calls.updates.find((u) => u.type === 'Account' && u.fields.Id === 'M');
  assert.ok(acctUpd, 'survivor reset happened');
  assert.equal(acctUpd.fields.PersonEmail, undefined, 'kept field not reset');
  assert.equal(acctUpd.fields.Phone, '111', 'non-kept field reset');
  assert.equal(out.results[0].kept_fields, 1);
  assert.equal(out.results[0].reset_fields, 1);
  delete process.env.MERGE_ENABLE_EXECUTION;
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

test('restore execute past window (purged): routed to recreate queue (recreate_pending), no writes', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ presentIds: [] }); // losers purged from the Recycle Bin (not returned by scanAll)
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(out.routed, 1);
  assert.equal(d.calls.undeletes.length, 0);
  assert.equal(d.calls.transitions[0].to, 'recreate_pending'); // moved out of restore, into secondary queue
  assert.match(d.calls.history[0].reason, /routed to recreate-from-backup queue/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: undelete failure is reported (not silently continued)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.write.undelete = async (c, ids) => { d.calls.undeletes.push(ids); return ids.map((id) => ({ id, success: false, errors: [{ message: 'DUPLICATE_VALUE: a live record has this key' }] })); };
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.failed, 1);
  assert.equal(out.restored, 0);
  assert.equal(d.calls.transitions.length, 0);           // not marked restored
  assert.match(d.calls.history[0].reason, /halted at undelete: DUPLICATE_VALUE/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: a child that is itself deleted is undeleted-then-repointed (not a hard fail)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  let oppTries = 0;
  d.write.update_record = async (c, type, fields) => {
    d.calls.updates.push({ type, fields });
    if (type === 'Opportunity') { oppTries += 1; if (oppTries === 1) throw new Error('entity is deleted'); }
    return { success: true, id: fields.Id };
  };
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);                                   // set still restored
  assert.ok(d.calls.undeletes.some((u) => u.includes('006A')), 'the deleted child was undeleted before re-point');
  assert.equal(out.results[0].repointed, 1);                      // recovered + re-pointed
  assert.equal(d.calls.transitions[0].to, 'restored');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: a file share (ContentDocumentLink) is ADDITIVELY re-linked to the loser (create only, survivor kept)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const cdlChild = { role: 'child', account: 'L1', child_type: 'child', fields: { object: 'ContentDocumentLink', id: '06Ac0001', parent_field: 'LinkedEntityId', parent_id: 'L1', child_type: 'child', content_document_id: '069DOC1', share_type: 'V', visibility: 'AllUsers' } };
  const d = deps({ snapRows: [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
    cdlChild,
  ], deletedIds: ['L1'], presentIds: ['L1'] });
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);
  const created = d.calls.creates.find((c) => c.type === 'ContentDocumentLink');
  assert.ok(created, 'a new ContentDocumentLink was created on the loser');
  assert.equal(created.fields.ContentDocumentId, '069DOC1');
  assert.equal(created.fields.LinkedEntityId, 'L1', 'link created on the loser');
  assert.equal(d.calls.deletes.filter((x) => x.type === 'ContentDocumentLink').length, 0, 'ADDITIVE — the survivor’s link is never deleted');
  assert.ok(!d.calls.updates.some((u) => u.type === 'ContentDocumentLink'), 'never attempts the forbidden LinkedEntityId update');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: a pre-capture file share (no ContentDocumentId) is skipped cleanly, not errored', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const oldCdl = { role: 'child', account: 'L1', child_type: 'child', fields: { object: 'ContentDocumentLink', id: '06Ac0009', parent_field: 'LinkedEntityId', parent_id: 'L1', child_type: 'child' } };
  const d = deps({ snapRows: [
    { role: 'survivor', account: 'M', fields: { account: 'M' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
    oldCdl,
  ], deletedIds: ['L1'], presentIds: ['L1'] });
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1, 'restore still succeeds');
  assert.equal(d.calls.creates.filter((c) => c.type === 'ContentDocumentLink').length, 0, 'no create attempted without a ContentDocumentId');
  const h = d.calls.history[d.calls.history.length - 1];
  assert.match(h.reason, /file share left on the survivor/i, 'clean, explanatory note (not a raw SF error)');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore stamp is gated by stamp_merged: default stamps, stamp_merged:false skips', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d1 = deps();
  await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d1);           // default (no flag) -> stamps
  assert.ok(d1.calls.stamp && d1.calls.stamp.action === 'RESTORE', 'stamps by default');
  const d2 = deps();
  await mr.restore([7], { mode: 'execute', confirm: 'RESTORE', stamp_merged: false }, d2);  // unchecked -> skip
  assert.equal(d2.calls.stamp, undefined, 'no stamp when stamp_merged=false');
  const d3 = deps();
  process.env.MERGE_STAMP_SURVIVOR = 'false';                                   // global off-switch
  await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d3);
  assert.equal(d3.calls.stamp, undefined, 'no stamp when MERGE_STAMP_SURVIVOR=false, even with the box checked');
  delete process.env.MERGE_STAMP_SURVIVOR;
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: survivor field reset happens BEFORE undelete (frees a survivorship-moved unique value)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);
  const resetIdx = d.calls.seq.indexOf('update:Account'); // the master reset
  const undelIdx = d.calls.seq.indexOf('undelete');
  const childIdx = d.calls.seq.indexOf('update:Opportunity');
  assert.ok(resetIdx >= 0 && undelIdx >= 0, 'both reset and undelete ran');
  assert.ok(resetIdx < undelIdx, 'survivor reset runs before undelete (so a moved unique value is freed first)');
  assert.ok(undelIdx < childIdx, 'children are re-pointed after the loser is undeleted');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore execute: an already-live loser stays eligible and is not re-undeleted (retry-safe)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ deletedIds: ['L1'] }); // L1 in bin, L2 already live (e.g. a prior partial restore)
  const out = await mr.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);
  assert.deepEqual(d.calls.undeletes[0], ['L1']); // only the still-deleted one; L2 not re-undeleted
  assert.equal(d.calls.transitions[0].to, 'restored');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('list_recreatable surfaces pending sets + backup availability', async () => {
  const d = deps();
  const list = await mr.list_recreatable(d);
  assert.equal(list[0].has_snapshot, true);
  assert.equal(list[0].snapshot_losers, 2);   // L1, L2
  assert.equal(list[0].snapshot_children, 1); // only the real child (self_account excluded)
  assert.match(list[0].reason, /NEW ids/);
});

test('recreate simulate: previews, no writes, status unchanged', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;
  const d = deps();
  const out = await mr.recreate([7], { mode: 'execute', confirm: 'RECREATE' }, d); // flag off -> simulate
  assert.equal(out.mode, 'simulate');
  assert.equal(out.simulated, 1);
  assert.equal(d.calls.creates.length, 0);
  assert.equal(d.calls.transitions.length, 0);
  assert.equal(d.calls.history[0].result, 'simulated');
});

test('recreate execute: creates losers (new ids), re-points children, status->recreated', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  const out = await mr.recreate([7], { mode: 'execute', confirm: 'RECREATE' }, d);
  assert.equal(out.recreated, 1);
  assert.equal(d.calls.creates.length, 2);                 // L1, L2 recreated
  assert.ok(!d.calls.creates.some((c) => c.fields.Id), 'create payload carries no Id');
  const childUpd = d.calls.updates.find((u) => u.type === 'Opportunity');
  assert.equal(childUpd.fields.AccountId, 'NEW_1');        // re-pointed to the NEW loser id
  assert.equal(d.calls.transitions[0].to, 'recreated');
  assert.equal(d.calls.history[0].result, 'recreated');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('recreate selective: keep_fields excluded from the survivor reset', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ snapRows: [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com', Phone: '111' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
  ] });
  const out = await mr.recreate([7], { mode: 'execute', confirm: 'RECREATE', keep_fields: { 7: ['PersonEmail'] } }, d);
  assert.equal(out.recreated, 1);
  const acctUpd = d.calls.updates.find((u) => u.type === 'Account' && u.fields.Id === 'M');
  assert.ok(acctUpd, 'survivor reset happened');
  assert.equal(acctUpd.fields.PersonEmail, undefined, 'kept field not reset');
  assert.equal(acctUpd.fields.Phone, '111', 'non-kept field reset');
  assert.equal(out.results[0].kept_fields, 1);
  const audit = d.calls.history.find((h) => h.result === 'recreated');
  assert.ok(audit.diff && audit.diff.kind === 'recreate', 'recreate writes a diff audit');
  delete process.env.MERGE_ENABLE_EXECUTION;
});
