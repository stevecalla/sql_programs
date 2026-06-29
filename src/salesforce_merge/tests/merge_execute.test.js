'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const mexec = require('../store/merge_execute');

// Build injectable deps with in-memory fakes. mergeBehavior(batch) -> {success, errors?} to script failures.
function deps(opts = {}) {
  const calls = { merges: [], history: [], transitions: [], snapshots: [], run: { updates: 0, finished: null } };
  const entry = Object.assign({
    id: 1, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M',
    loser_accounts: 'L1;L2;L3', loser_count: 3, environment: 'Sandbox', org_id: 'ORG1',
    field_overrides: {}, child_counts: { total: 5 },
  }, opts.entry || {});
  const accounts = opts.accounts || [
    { account: 'M', contact: 'cM', PersonEmail: '', cfg_Member_Number__pc: '1001' },
    { account: 'L1', contact: 'cL1', PersonEmail: 'lost@x.com' },
    { account: 'L2' }, { account: 'L3' },
  ];
  return {
    calls,
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox', run_at: '2026-01-01' }) },
    sf: { get_org_identity: async () => ({ org_id: 'ORG1' }), fetch_children: async () => [{ account: 'L1', object: 'Opportunity', id: '006', parent_field: 'AccountId', parent_id: 'L1' }] },
    cluster: { cluster_detail: async () => ({ accounts }) },
    snapshot: { save: async (...a) => { calls.snapshots.push(a); return { saved: accounts.length }; } },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; } },
    run: { start: async () => {}, update: async () => { calls.run.updates += 1; }, finish: async (id, p) => { calls.run.finished = p; } },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    write: {
      default_write_connect: async () => ({}),
      merge_one: async (conn, master, batch, fields) => {
        calls.merges.push({ master, batch, fields });
        const b = opts.mergeBehavior ? opts.mergeBehavior(batch) : { success: true };
        return Object.assign({ success: true, mergedRecordIds: batch }, b);
      },
    },
  };
}

test('build_master_fields: override > master non-blank > loser backfill', () => {
  const accts = [{ account: 'M', PersonEmail: '', Phone: '111' }, { account: 'L', PersonEmail: 'l@x.com', Phone: '999' }];
  const f = mexec.build_master_fields(accts, 'M', { Phone: '555' });
  assert.equal(f.PersonEmail, 'l@x.com'); // master blank -> backfill from loser
  assert.equal(f.Phone, '555');           // override wins over master's non-blank
});

test('verify_alignment flags environment and org mismatches', () => {
  assert.equal(mexec.verify_alignment({ environment: 'Sandbox' }, { environment: 'Production' }).ok, false);
  assert.equal(mexec.verify_alignment({ org_id: 'A' }, { org_id: 'B' }).ok, false);
  assert.equal(mexec.verify_alignment({ environment: 'Sandbox', org_id: 'A' }, { environment: 'Sandbox', org_id: 'A' }).ok, true);
});

test('safe mode: simulate writes snapshot + simulated history, no merge, no status change', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;
  const d = deps();
  const out = await mexec.process([1], {}, d);
  assert.equal(out.mode, 'simulate');
  assert.equal(out.simulated, 1);
  assert.equal(d.calls.merges.length, 0);          // no Salesforce write
  assert.equal(d.calls.snapshots.length, 1);       // snapshot every run
  assert.equal(d.calls.transitions.length, 0);     // status unchanged
  assert.equal(d.calls.history[0].result, 'simulated');
});

test('execute success: master+2 sequential, status->done', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.mode, 'execute');
  assert.equal(out.done, 1);
  assert.equal(d.calls.merges.length, 2);                       // ceil(3/2) = 2 calls
  assert.deepEqual(d.calls.merges[0].batch, ['L1', 'L2']);
  assert.deepEqual(d.calls.merges[1].batch, ['L3']);
  assert.equal(d.calls.merges[0].fields.PersonEmail, 'lost@x.com'); // survivorship on first call
  assert.deepEqual(d.calls.merges[1].fields, {});               // no fields on later calls
  assert.equal(d.calls.transitions[0].to, 'done');
  assert.equal(d.calls.history[0].result, 'done');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('execute mid-set failure: fail-stop, status->failed, records merged/remaining, no revert', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ mergeBehavior: (batch) => (batch.includes('L3') ? { success: false, errors: [{ message: 'too many children' }] } : { success: true }) });
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.failed, 1);
  assert.equal(out.done, 0);
  assert.equal(d.calls.merges.length, 2);          // attempted both batches, 2nd failed
  assert.equal(d.calls.transitions[0].to, 'failed');
  const h = d.calls.history[0];
  assert.equal(h.result, 'failed');
  assert.match(h.reason, /too many children/);
  assert.equal(h.merged_count, 2);
  assert.equal(h.remaining_count, 1);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('execute with armed gates but environment mismatch: skipped, no merge', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ entry: { environment: 'Production' } });   // queued for prod, ctx is sandbox
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(d.calls.merges.length, 0);
  assert.match(d.calls.history[0].reason, /environment mismatch/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('gate stack: execute mode without typed confirm falls back to simulate', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  const out = await mexec.process([1], { mode: 'execute', confirm: 'nope' }, d);
  assert.equal(out.mode, 'simulate');
  assert.equal(d.calls.merges.length, 0);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('execute with stamp_merged stamps was_merged__c on the survivor (best-effort)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.calls.updates = [];
  d.write.update_record = async (c, t, f) => { d.calls.updates.push({ t, f }); return { success: true }; };
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', stamp_merged: true }, d);
  assert.equal(out.done, 1);
  const u = d.calls.updates.find((x) => x.t === 'Account' && x.f.was_merged__c === true);
  assert.ok(u && u.f.Id === 'M' && u.f.was_merged_date__c, 'survivor stamped with flag + date');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('stamp failure does not fail the merge (still done)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.write.update_record = async () => { throw new Error('No such column was_merged__c'); };
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', stamp_merged: true }, d);
  assert.equal(out.done, 1);
  assert.match(d.calls.history[0].reason, /stamp skipped/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});
