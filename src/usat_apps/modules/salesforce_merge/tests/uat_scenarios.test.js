'use strict';
// UAT SCENARIOS — an automated mirror of USAT_Salesforce_Merge_UAT.xlsx, tab for tab. Each describe
// block is named after a workbook tab and asserts the tool's OWN behaviour (survivorship, drift + the
// acknowledgment gate, the pre-merge snapshot, the restore plan incl. selective keep, and bulk counts)
// using injected in-memory fakes — no Salesforce, no MySQL, no browser.
//
// SCOPE NOTE: these prove what the code controls (the calls it makes + the decisions it takes). They do
// NOT prove Salesforce's own merge/undelete semantics (reparenting, original-id restore, unique-field
// conflicts) — that's the manual UAT / live-sandbox pass. See README_MERGE_EXECUTION.md.
//   node --test src/usat_apps/modules/salesforce_merge/tests/uat_scenarios.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
process.env.MERGE_LOG = 'off';

const mexec = require('../store/merge_execute');
const mrestore = require('../store/merge_restore');
const mqueue = require('../store/merge_queue');

// --- Fake deps for merge_execute.process (mirrors tests/merge_execute.test.js) ---
function execDeps(opts = {}) {
  const calls = { merges: [], history: [], transitions: [], snapshots: [] };
  const entry = Object.assign({ id: 1, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M',
    loser_accounts: 'L1;L2;L3', loser_count: 3, environment: 'Sandbox', org_id: 'ORG1', field_overrides: {}, child_counts: { total: 5 } }, opts.entry || {});
  const accounts = opts.accounts || [
    { account: 'M', contact: 'cM', PersonEmail: '', cfg_Member_Number__pc: '1001' },
    { account: 'L1', contact: 'cL1', PersonEmail: 'lost@x.com' }, { account: 'L2' }, { account: 'L3' }];
  return {
    calls,
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox', run_at: '2026-01-01' }) },
    sf: { get_org_identity: async () => ({ org_id: 'ORG1' }), fetch_children: async () => [{ account: 'L1', object: 'Opportunity', id: '006', parent_field: 'AccountId', parent_id: 'L1' }] },
    cluster: { cluster_detail: async () => ({ accounts }) },
    snapshot: { save: async (...a) => { calls.snapshots.push(a); return { saved: accounts.length }; } },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; }, clear_simulated: async () => {} },
    run: { start: async () => {}, update: async () => {}, finish: async () => {} },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    baseline: { get: async () => opts.baseline || null },
    write: {
      default_write_connect: async () => ({}),
      merge_one: async (conn, master, batch, fields) => { calls.merges.push({ master, batch, fields }); const b = opts.mergeBehavior ? opts.mergeBehavior(batch) : { success: true }; return Object.assign({ success: true, mergedRecordIds: batch }, b); },
      stamp_fields_status: async () => ({ usat_was_merged__c: true, usat_was_merged_date__c: true, usat_was_merged_by__c: true }),
      write_creds: () => ({ user: 'svc@sf' }),
    },
  };
}

// --- Fake deps for merge_restore.restore / recreate (mirrors tests/merge_restore.test.js) ---
function restoreDeps(opts = {}) {
  const calls = { undeletes: [], updates: [], history: [], transitions: [], creates: [] };
  const entry = Object.assign({ id: 7, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M',
    loser_accounts: 'L1;L2', loser_count: 2, environment: 'Sandbox', org_id: 'ORG1' }, opts.entry || {});
  const snapRows = opts.snapRows || [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
    { role: 'loser', account: 'L2', fields: { account: 'L2', Id: 'L2' } },
    { role: 'child', account: 'L1', child_type: 'child', fields: { object: 'Opportunity', id: '006A', parent_field: 'AccountId', parent_id: 'L1', child_type: 'child' } },
  ];
  const deletedIds = opts.deletedIds || ['L1', 'L2'];
  const presentIds = opts.presentIds || ['L1', 'L2'];
  const conn = { query: async () => ({ records: ['L1', 'L2'].filter((id) => presentIds.includes(id)).map((id) => ({ Id: id, IsDeleted: deletedIds.includes(id) })) }) };
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
      create_record: async (c, type, fields) => { calls.creates.push({ type, fields }); return { success: true, id: 'NEW_' + (calls.creates.length) }; },
    },
  };
}

// ============================================================================
describe('Test 1 - Basic merge & restore (happy path)', () => {
  test('merge executes: a Salesforce merge is issued, a pre-merge snapshot is saved, status -> done', async () => {
    process.env.MERGE_ENABLE_EXECUTION = 'true';
    const d = execDeps();
    const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
    assert.equal(out.done, 1, '1 set merged');
    assert.equal(out.armed, true, 'fully armed (flag + execute + typed MERGE)');
    assert.ok(d.calls.merges.length >= 1, 'a Salesforce merge call was issued');
    assert.ok(d.calls.snapshots.length >= 1, 'pre-merge snapshot saved before the merge');
    assert.ok(d.calls.transitions.some((t) => t.to === 'done'), 'queue set moved to done');
    assert.ok(d.calls.history.some((h) => h.result === 'done'), 'a done history row written');
    delete process.env.MERGE_ENABLE_EXECUTION;
  });

  test('restore returns the set: undelete the loser + re-point children + reset survivor, status -> restored', async () => {
    process.env.MERGE_ENABLE_EXECUTION = 'true';
    const d = restoreDeps();
    const out = await mrestore.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
    assert.equal(out.restored, 1, '1 set restored');
    assert.deepEqual(d.calls.undeletes[0], ['L1', 'L2'], 'losers undeleted from the Recycle Bin');
    assert.ok(d.calls.updates.some((u) => u.type === 'Opportunity'), 'a child re-pointed');
    assert.ok(d.calls.transitions.some((t) => t.to === 'restored'), 'queue set moved to restored');
    delete process.env.MERGE_ENABLE_EXECUTION;
  });
});

// ============================================================================
describe('Test 2 - Simulate makes no changes (safe mode)', () => {
  test('simulate runs the pipeline but writes nothing and does not consume the set', async () => {
    delete process.env.MERGE_ENABLE_EXECUTION;   // safe mode -> simulate regardless of confirm
    const d = execDeps();
    const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
    assert.equal(out.mode, 'simulate');
    assert.equal(out.simulated, 1);
    assert.equal(out.done, 0);
    assert.equal(d.calls.merges.length, 0, 'no Salesforce merge call');
    assert.ok(!d.calls.transitions.some((t) => t.to === 'done'), 'status stays approved (not consumed)');
    assert.ok(d.calls.snapshots.length >= 1, 'a snapshot is still taken during simulate');
  });
});

// ============================================================================
describe('Test 3 - Drift detection & acknowledgment gate', () => {
  const drifted = () => execDeps({ baseline: { M: { email: 'was@old.com' } } }); // live M PersonEmail '' -> email drift

  test('drift is detected + counted when a reviewed field changed since staging', async () => {
    delete process.env.MERGE_ENABLE_EXECUTION;
    const out = await mexec.process([1], {}, drifted());
    assert.equal(out.drift, 1, 'one set flagged with drift');
    const r = out.results.find((x) => x.id === 1);
    assert.ok(r.drift_fields >= 1 && r.drift_detail.some((x) => x.field === 'email'), 'drift detail names the changed field');
  });

  test('execute WITHOUT acknowledging drift SKIPS the set (no merge, stays approved)', async () => {
    process.env.MERGE_ENABLE_EXECUTION = 'true';
    const d = drifted();
    const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
    assert.equal(out.done, 0);
    assert.equal(out.drift_blocked, 1);
    assert.equal(d.calls.merges.length, 0, 'drifted set not merged');
    assert.ok(!d.calls.transitions.some((t) => t.to === 'done'), 'left approved');
    delete process.env.MERGE_ENABLE_EXECUTION;
  });

  test('execute WITH ack_drift merges the drifted set', async () => {
    process.env.MERGE_ENABLE_EXECUTION = 'true';
    const d = drifted();
    const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', ack_drift: true }, d);
    assert.equal(out.done, 1);
    assert.ok(d.calls.merges.length >= 1);
    delete process.env.MERGE_ENABLE_EXECUTION;
  });
});

// ============================================================================
describe('Test 4 - Field override (survivorship control)', () => {
  test('a per-field override forces the survivor to take that record VALUE (never its id)', () => {
    const accts = [{ account: 'M', PersonEmail: '', Phone: '111' }, { account: 'L', PersonEmail: 'l@x.com', Phone: '999' }];
    const f = mexec.build_master_fields(accts, 'M', { Phone: 'L' }); // "use account L's Phone"
    assert.equal(f.Phone, '999', 'survivor takes L\'s phone value');
    assert.notEqual(f.Phone, 'L', 'never writes the record id into the field (regression guard)');
    assert.equal(f.PersonEmail, 'l@x.com', 'blank master field backfills from the loser');
  });
});

// ============================================================================
describe('Test 5 - Selective restore (keep current)', () => {
  test('a kept field is left at its current value; the rest reset to the snapshot', async () => {
    process.env.MERGE_ENABLE_EXECUTION = 'true';
    const d = restoreDeps({ snapRows: [
      { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com', Phone: '111' } },
      { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
      { role: 'loser', account: 'L2', fields: { account: 'L2', Id: 'L2' } },
    ] });
    const out = await mrestore.restore([7], { mode: 'execute', confirm: 'RESTORE', keep_fields: { 7: ['PersonEmail'] } }, d);
    const acctUpd = d.calls.updates.find((u) => u.type === 'Account' && u.fields.Id === 'M');
    assert.equal(acctUpd.fields.PersonEmail, undefined, 'kept field NOT reset');
    assert.equal(acctUpd.fields.Phone, '111', 'non-kept field reset to snapshot');
    assert.equal(out.results[0].kept_fields, 1);
    assert.equal(out.results[0].reset_fields, 1);
    delete process.env.MERGE_ENABLE_EXECUTION;
  });
});

// ============================================================================
describe('Test 6 - Bulk queue & process', () => {
  test('bulk add queues each new set and skips already-queued / already-merged ones', async () => {
    const query = async (sql, params) => {
      params = params || [];
      if (/^INSERT/i.test(sql)) return { insertId: 1 };
      if (/WHERE source_key = \? AND survivor_account/i.test(sql)) {
        if (params[1] === 'DUP') return [{ status: 'queued' }];  // already staged -> skipped
        if (params[1] === 'MRG') return [{ status: 'done' }];    // already merged -> merged
        return [];
      }
      return {};
    };
    const r = await mqueue.add_many([
      { source_key: 'A', survivor_account: 'S1', loser_accounts: ['x'] },
      { source_key: 'B', survivor_account: 'DUP', loser_accounts: ['y'] },
      { source_key: 'C', survivor_account: 'MRG', loser_accounts: ['z'] },
      { source_key: 'D', survivor_account: 'S2', loser_accounts: ['w'] },
    ], query);
    assert.equal(r.queued, 2, 'two clean sets queued');
    assert.equal(r.skipped, 1, 'one already-queued skipped');
    assert.equal(r.merged, 1, 'one already-merged skipped');
    assert.equal(r.added.length, 2, 'ids returned for baseline capture');
  });
});
