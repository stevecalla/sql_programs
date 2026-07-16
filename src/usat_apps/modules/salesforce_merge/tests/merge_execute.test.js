'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
process.env.MERGE_LOG = 'off';
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
    sf: { get_org_identity: async () => ({ org_id: 'ORG1' }), fetch_children: async () => [{ account: 'L1', object: 'Opportunity', id: '006', parent_field: 'AccountId', parent_id: 'L1' }], fetch_accounts_by_ids: async () => [] },
    post_snapshot: { save: async () => ({ saved: 1 }), get: async () => null },
    cluster: { cluster_detail: async () => ({ accounts }) },
    snapshot: { save: async (...a) => { calls.snapshots.push(a); return { saved: accounts.length }; } },
    history: { write: async (row) => { calls.history.push(row); return { id: calls.history.length }; }, clear_simulated: async () => { calls.clearedSim = (calls.clearedSim || 0) + 1; } },
    run: { start: async () => {}, update: async () => { calls.run.updates += 1; }, finish: async (id, p) => { calls.run.finished = p; } },
    queue: { list: async () => [entry], transition: async (ids, to, from) => { calls.transitions.push({ ids, to, from }); return { updated: 1 }; } },
    baseline: { get: async () => opts.baseline || null },   // stage-time drift baseline (null = not captured)
    write: {
      default_write_connect: async () => ({}),
      merge_one: async (conn, master, batch, fields) => {
        calls.merges.push({ master, batch, fields });
        const b = opts.mergeBehavior ? opts.mergeBehavior(batch) : { success: true };
        return Object.assign({ success: true, mergedRecordIds: batch }, b);
      },
      // stamp path defaults (individual tests can override update_record to script failures)
      stamp_fields_status: async () => (opts.stampPresent || { usat_was_merged__c: true, usat_was_merged_date__c: true, usat_was_merged_by__c: true }),
      write_creds: () => ({ user: 'svc@sf' }),
    },
  };
}

test('build_master_fields: an override is an ACCOUNT ID resolved to that record value (not a literal)', () => {
  const accts = [{ account: 'M', PersonEmail: '', Phone: '111' }, { account: 'L', PersonEmail: 'l@x.com', Phone: '999' }];
  const f = mexec.build_master_fields(accts, 'M', { Phone: 'L' }); // "use account L's Phone"
  assert.equal(f.PersonEmail, 'l@x.com'); // master blank -> backfill from loser
  assert.equal(f.Phone, '999');           // override -> account L's value
  assert.notEqual(f.Phone, 'L');          // regression: never write the account id into the field
});

test('drift check: a field changed since staging is counted + surfaced on the result', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;   // simulate is enough to compute drift
  // Baseline says M's email was blank at staging; live account M now has an email -> 1 drifted field.
  const d = deps({ baseline: { M: { PersonEmail: 'was-blank@old.com', cfg_Member_Number__pc: '1001' } } });
  const out = await mexec.process([1], {}, d);
  assert.equal(out.drift, 1, 'one set had drift');
  assert.ok(out.drift_fields >= 1, 'at least one field drifted');
  const r = out.results.find((x) => x.id === 1);
  assert.equal(r.drift_checked, true);
  assert.ok(r.drift_fields >= 1);
  assert.ok(r.drift_detail.some((x) => x.field === 'email'));   // canonical identity field
});

test('no baseline captured -> drift not checked, no drift count', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;
  const d = deps();   // baseline get -> null
  const out = await mexec.process([1], {}, d);
  assert.ok(!out.drift, 'no drift counted');
  const r = out.results.find((x) => x.id === 1);
  assert.equal(r.drift_checked, false);
});

test('canonical drift: snapshot-shaped baseline vs SF-shaped live compares correctly (no false drift)', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION;
  // baseline uses snapshot names (email/member_number); live account M uses SF names (PersonEmail/cfg_…).
  // Equal email -> no drift; different member number -> 1 drift, mapped to the canonical field.
  const accounts = [{ account: 'M', contact: 'cM', PersonEmail: 'same@x.com', cfg_Member_Number__pc: '2002' }, { account: 'L1' }];
  const d = deps({ entry: { loser_accounts: 'L1', loser_count: 1 }, accounts, baseline: { M: { email: 'same@x.com', member_number: '1001' } } });
  const out = await mexec.process([1], {}, d);
  const r = out.results.find((x) => x.id === 1);
  assert.equal(r.drift_fields, 1);
  assert.ok(r.drift_detail.some((x) => x.field === 'member_number'));
  assert.ok(!r.drift_detail.some((x) => x.field === 'email'), 'equal email across shapes is not drift');
});

test('drift gate: execute WITHOUT ack skips a drifted set (stays approved, no merge)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ baseline: { M: { email: 'was@old.com' } } });   // live M PersonEmail '' -> drift
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.done, 0, 'not merged');
  assert.equal(out.skipped, 1);
  assert.equal(out.drift_blocked, 1);
  assert.equal(d.calls.merges.length, 0, 'no Salesforce merge call');
  assert.ok(!d.calls.transitions.some((t) => t.to === 'done'), 'set left approved');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('drift gate: execute WITH ack_drift merges the drifted set', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ baseline: { M: { email: 'was@old.com' } } });
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', ack_drift: true }, d);
  assert.equal(out.done, 1, 'merged despite drift');
  assert.ok(d.calls.merges.length >= 1);
  delete process.env.MERGE_ENABLE_EXECUTION;
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
  assert.equal(d.calls.clearedSim, 1); // keep-latest simulate dedupe ran
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

// Switching the loaded dataset to the OTHER environment must not let a set built in one env run
// against the other. The dataset env drives ctx; a Sandbox-built set is skipped before any write,
// and no snapshot is taken for a skipped set (skip happens before the snapshot step).
test('cross-environment: a Sandbox-built set is skipped when Production data is loaded', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ entry: { environment: 'Sandbox' } });
  d.dashboard = { dataset_info: async () => ({ environment: 'Production', run_at: '2026-01-01' }) };
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(d.calls.merges.length, 0);     // no Salesforce write
  assert.equal(d.calls.snapshots.length, 0);  // skip is before the snapshot step
  assert.match(d.calls.history[0].reason, /environment mismatch/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

// org_id is captured server-side at queue-add time, so the org guard is always-on: a set whose
// stamped org id differs from the connected org is skipped even if the environment label matches
// (protects against two same-labeled orgs, e.g. two sandboxes).
test('org guard: a set whose org id differs from the connected org is skipped', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps({ entry: { org_id: 'ORGX' } }); // connected org is ORG1 (sf.get_org_identity), env matches
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(d.calls.merges.length, 0);
  assert.match(d.calls.history[0].reason, /org mismatch/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

// Idempotency layer 1: only `approved` entries are processed. A set already `done` is not in the
// approved list, so passing its id is a no-op (can't be merged twice).
test('idempotency: a done set (not in approved list) is never reprocessed', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const approved = { id: 1, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M', loser_accounts: 'L1', loser_count: 1, environment: 'Sandbox', org_id: 'ORG1', field_overrides: {} };
  const d = deps();
  d.queue.list = async (q, status) => (status === 'approved' ? [approved] : []); // id 2 is "done", absent here
  d.cluster = { cluster_detail: async () => ({ accounts: [{ account: 'M' }, { account: 'L1' }] }) };
  const out = await mexec.process([1, 2], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.processed, 1);          // only the approved id 1 ran
  assert.equal(out.done, 1);
  assert.equal(d.calls.merges.length, 1);  // id 2 never touched
  delete process.env.MERGE_ENABLE_EXECUTION;
});

// Idempotency layer 2: the re-fetch/drift check. If a queued loser is gone from fresh data (e.g.
// already merged away), the set is skipped with a drift reason — no merge attempted.
test('idempotency: drift (a queued loser missing from fresh data) is skipped, no merge', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.cluster = { cluster_detail: async () => ({ accounts: [{ account: 'M' }, { account: 'L1' }] }) }; // L2,L3 gone
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE' }, d);
  assert.equal(out.skipped, 1);
  assert.equal(d.calls.merges.length, 0);
  assert.match(d.calls.history[0].reason, /records changed since queueing/);
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

test('execute with stamp_merged stamps usat_was_merged__c on the survivor (best-effort)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.calls.updates = [];
  d.write.update_record = async (c, t, f) => { d.calls.updates.push({ t, f }); return { success: true }; };
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', stamp_merged: true }, d);
  assert.equal(out.done, 1);
  const u = d.calls.updates.find((x) => x.t === 'Account' && x.f.usat_was_merged__c === true);
  assert.ok(u && u.f.Id === 'M' && u.f.usat_was_merged_date__c, 'survivor stamped with flag + date');
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('stamp failure does not fail the merge (still done)', async () => {
  process.env.MERGE_ENABLE_EXECUTION = 'true';
  const d = deps();
  d.write.update_record = async () => { throw new Error('No such column usat_was_merged__c'); };
  const out = await mexec.process([1], { mode: 'execute', confirm: 'MERGE', stamp_merged: true }, d);
  assert.equal(out.done, 1);
  assert.match(d.calls.history[0].reason, /stamp skipped/);
  delete process.env.MERGE_ENABLE_EXECUTION;
});

test('cancel between sets: first set processes, remaining left untouched, run finishes cancelled', async () => {
  delete process.env.MERGE_ENABLE_EXECUTION; // simulate mode is enough to exercise the set-boundary check
  const d = deps();
  const e1 = { id: 1, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M', loser_accounts: 'L1', loser_count: 1, environment: 'Sandbox', org_id: 'ORG1', field_overrides: {} };
  const e2 = { id: 2, source_type: 'merge_id', source_key: 'M2', survivor_account: 'N', loser_accounts: 'K1', loser_count: 1, environment: 'Sandbox', org_id: 'ORG1', field_overrides: {} };
  d.queue.list = async () => [e1, e2];
  d.cluster = { cluster_detail: async (key) => ({ accounts: key === 'M1' ? [{ account: 'M' }, { account: 'L1' }] : [{ account: 'N' }, { account: 'K1' }] }) };
  // Cancel takes effect at the SECOND set-boundary check (after set 1 was processed).
  let checks = 0;
  d.control = { is_cancelled: () => { checks += 1; return checks >= 2; }, clear: () => {} };
  const out = await mexec.process([1, 2], {}, d);
  assert.equal(out.cancelled, true);
  assert.equal(out.processed, 1);          // only set 1 ran
  assert.equal(out.simulated, 1);
  assert.equal(out.remaining, 1);          // set 2 left untouched
  assert.equal(d.calls.history.length, 1); // no history row for the un-run set
  assert.equal(d.calls.run.finished.status, 'cancelled');
});
