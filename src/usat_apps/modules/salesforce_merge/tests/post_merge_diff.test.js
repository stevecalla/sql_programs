'use strict';
// Post-merge snapshot + diff + the restore "edited since merge" gate. All fakes — no DB / Salesforce.
//   node --test modules/salesforce_merge/tests/post_merge_diff.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.MERGE_LOG = 'off';

const post = require('../store/merge_post_snapshot');
const rdiff = require('../store/restore_diff');
const mrestore = require('../store/merge_restore');

// ---- store: keep-latest per queue entry ----
test('merge_post_snapshot save + get keeps the latest row', async () => {
  const rows = [];
  const q = async (sql, params) => {
    if (/^CREATE|^ALTER/i.test(sql)) return {};
    if (/^DELETE/i.test(sql)) { for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].queue_id === params[0]) rows.splice(i, 1); return {}; }
    if (/^INSERT/i.test(sql)) { rows.push({ id: rows.length + 1, queue_id: params[1], survivor_account: params[2], fields: params[5], sf_last_modified: params[6], created_at_mtn: params[7], created_at_utc: params[8] }); return {}; }
    if (/^SELECT/i.test(sql)) return rows.filter((r) => r.queue_id === params[0]).sort((a, b) => b.id - a.id).slice(0, 1);
    return {};
  };
  await post.save({ run_id: 'r1', queue_id: 5, survivor_account: 'M', fields: { PersonEmail: 'a@x.com' }, sf_last_modified: '2026-01-01T00:00:00Z' }, q);
  await post.save({ run_id: 'r2', queue_id: 5, survivor_account: 'M', fields: { PersonEmail: 'b@x.com' }, sf_last_modified: '2026-01-02T00:00:00Z' }, q);
  const got = await post.get(5, q);
  assert.equal(got.sf_last_modified, '2026-01-02T00:00:00Z', 'keep-latest');
  assert.equal(got.fields.PersonEmail, 'b@x.com');
});

// ---- post_merge_diff: the authoritative flag is LastModifiedDate now vs at capture ----
function diffDeps(opts = {}) {
  return {
    queue: { list: async () => [{ id: 7, survivor_account: 'M', survivor_name: 'X', environment: 'Sandbox', status: 'done' }] },
    post_snapshot: { get: async () => (opts.noBaseline ? null : { fields: { PersonEmail: opts.snapEmail || 'old@x.com' }, sf_last_modified: opts.lmAtMerge || '2026-01-01T00:00:00Z', created_at_mtn: '2026-01-01 00:00:00' }) },
    read: { fetch_accounts_by_ids: async () => (opts.missing ? [] : [{ account: 'M', PersonEmail: opts.nowEmail || 'new@x.com', LastModifiedDate: opts.lmNow || '2026-02-01T00:00:00Z' }]) },
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox' }) },
  };
}

test('post_merge_diff flags edited_since_merge + shows the changed field', async () => {
  const r = await rdiff.post_merge_diff(7, diffDeps({ lmAtMerge: '2026-01-01T00:00:00Z', lmNow: '2026-02-01T00:00:00Z', snapEmail: 'old@x.com', nowEmail: 'new@x.com' }));
  assert.equal(r.has_baseline, true);
  assert.equal(r.edited_since_merge, true);
  assert.ok(r.post_merge.summary.differ >= 1, 'the post-merge email change is in the diff');
  assert.equal(r.sf_last_modified_at_merge, '2026-01-01T00:00:00Z');
  assert.equal(r.sf_last_modified_now, '2026-02-01T00:00:00Z');
});

test('post_merge_diff: untouched when LastModifiedDate is unchanged', async () => {
  const r = await rdiff.post_merge_diff(7, diffDeps({ lmAtMerge: '2026-01-01T00:00:00Z', lmNow: '2026-01-01T00:00:00Z', snapEmail: 'a@x.com', nowEmail: 'a@x.com' }));
  assert.equal(r.edited_since_merge, false);
});

test('post_merge_diff: no baseline (set merged before this feature)', async () => {
  const r = await rdiff.post_merge_diff(7, diffDeps({ noBaseline: true }));
  assert.equal(r.has_baseline, false);
  assert.equal(r.edited_since_merge, null);
});

// ---- restore gate: hold sets whose survivor was edited in SF after the merge ----
function gateDeps(opts = {}) {
  const calls = { history: [], transitions: [], updates: [], undeletes: [] };
  const entry = { id: 7, survivor_account: 'M', survivor_name: 'X', loser_accounts: 'L1', loser_count: 1, environment: 'Sandbox', org_id: 'ORG1' };
  const snapRows = [
    { role: 'survivor', account: 'M', fields: { account: 'M', PersonEmail: 'm@x.com' } },
    { role: 'loser', account: 'L1', fields: { account: 'L1', Id: 'L1' } },
  ];
  const conn = { query: async (sql) => {
    if (/IsDeleted/.test(sql)) return { records: [{ Id: 'L1', IsDeleted: true }] };          // account_states → L1 recoverable
    if (/LastModifiedDate/.test(sql)) return { records: [{ Id: 'M', LastModifiedDate: opts.lmNow || '2026-02-01T00:00:00Z' }] };
    return { records: [] };
  } };
  return {
    calls,
    dashboard: { dataset_info: async () => ({ environment: 'Sandbox' }) },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    snapshot: { list_for_entry: async () => snapRows },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; } },
    run: { start: async () => {}, update: async () => {}, finish: async () => {} },
    post_snapshot: { get: async () => (opts.noBaseline ? null : { sf_last_modified: opts.lmAtMerge || '2026-01-01T00:00:00Z' }) },
    // These tests exercise the edit-gate only — disable the dossier so restore never touches the real
    // dossier store (which would open a MySQL pool and keep the test process from exiting).
    dossier: { attach_enabled: () => false, generate: async () => ({ generated: false }) },
    write: {
      default_write_connect: async () => conn,
      undelete: async (c, ids) => { calls.undeletes.push(ids); return ids.map((id) => ({ id, success: true })); },
      update_record: async (c, type, fields) => { calls.updates.push({ type, fields }); return { success: true, id: fields.Id }; },
      stamp_survivor: async () => ({ stamped: false, count: 0, skipped: 'test' }),
    },
  };
}

test('restore HOLDS a set edited in SF since the merge (no ack)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = gateDeps({ lmNow: '2026-02-01T00:00:00Z', lmAtMerge: '2026-01-01T00:00:00Z' });
  const out = await mrestore.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.held, 1);
  assert.equal(out.restored, 0);
  assert.equal(d.calls.undeletes.length, 0, 'held before any write');
  assert.ok(!d.calls.transitions.some((t) => t.to === 'restored'), 'stays done (in the queue)');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore lets an edited set through WITH ack_post_merge', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = gateDeps({ lmNow: '2026-02-01T00:00:00Z', lmAtMerge: '2026-01-01T00:00:00Z' });
  const out = await mrestore.restore([7], { mode: 'execute', confirm: 'RESTORE', ack_post_merge: true }, d);
  assert.equal(out.restored, 1);
  assert.ok(d.calls.undeletes.length >= 1);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('restore proceeds normally when the survivor is untouched since the merge', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = gateDeps({ lmNow: '2026-01-01T00:00:00Z', lmAtMerge: '2026-01-01T00:00:00Z' }); // equal → not edited
  const out = await mrestore.restore([7], { mode: 'execute', confirm: 'RESTORE' }, d);
  assert.equal(out.restored, 1);
  assert.equal(out.held || 0, 0);
  delete process.env.MERGE_ENABLE_EXECUTION;
});
