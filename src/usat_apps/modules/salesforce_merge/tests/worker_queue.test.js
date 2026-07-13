'use strict';
// Phase 3 — worker job-queue coordination on salesforce_merge_run (no DB; an in-memory fake `query`
// models just the rows). Covers the functions the worker breakout added: enqueue, claim_next (atomic,
// FIFO, no double-claim, kind filter), DB-backed cancel (request_cancel / is_cancelled), and set_result
// (executor-summary parity). These are the pieces that make multi-worker + cross-process cancel safe.
//   node --test src/usat_apps/modules/salesforce_merge/tests/worker_queue.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const RUN = require('../store/merge_run');

// Minimal in-memory stand-in for the run table — matches the exact SQL merge_run.js issues.
function fakeDB() {
  const rows = [];
  let seq = 0;
  return async function query(sql, params) {
    params = params || [];
    if (/CREATE TABLE|ALTER TABLE/i.test(sql)) return {};
    if (/^INSERT/i.test(sql)) {
      rows.push({ seq: seq++, run_id: String(params[0]), kind: params[1], mode: params[2],
        status: 'queued', params: params[7], claimed_by: null, claimed_at: null, cancel_requested: 0, result: null });
      return { insertId: seq };
    }
    if (/SET status = "running", claimed_by/i.test(sql)) {           // claim_next UPDATE
      const token = params[0]; const kinds = params.slice(1);
      const cand = rows.filter((r) => r.status === 'queued' && r.claimed_by == null && kinds.indexOf(r.kind) >= 0)
        .sort((a, b) => a.seq - b.seq)[0];
      if (!cand) return { affectedRows: 0 };
      cand.status = 'running'; cand.claimed_by = token; cand.claimed_at = cand.seq;
      return { affectedRows: 1 };
    }
    if (/WHERE claimed_by = \? AND status = "running"/i.test(sql)) { // claim_next SELECT
      const token = params[0];
      const r = rows.filter((x) => x.claimed_by === token && x.status === 'running').sort((a, b) => b.seq - a.seq)[0];
      return r ? [r] : [];
    }
    if (/SET cancel_requested = 1/i.test(sql)) {                     // request_cancel
      const r = rows.find((x) => x.run_id === String(params[0]) && x.status === 'running');
      if (r) r.cancel_requested = 1;
      return { affectedRows: r ? 1 : 0 };
    }
    if (/SELECT cancel_requested/i.test(sql)) {                      // is_cancelled
      const r = rows.find((x) => x.run_id === String(params[0]));
      return r ? [{ cancel_requested: r.cancel_requested }] : [];
    }
    if (/SET result = \?/i.test(sql)) {                              // set_result
      const r = rows.find((x) => x.run_id === String(params[1]));
      if (r) r.result = params[0];
      return { affectedRows: r ? 1 : 0 };
    }
    if (/WHERE run_id = \?/i.test(sql)) {                            // get
      const r = rows.find((x) => x.run_id === String(params[0]));
      return r ? [r] : [];
    }
    return {};
  };
}

test('enqueue inserts a queued run carrying its params', async () => {
  const q = fakeDB();
  const e = await RUN.enqueue({ kind: 'merge', mode: 'simulate', created_by: 'x', params: { ids: [1, 2], opts: { mode: 'simulate' } } }, q);
  assert.equal(e.status, 'queued');
  assert.ok(e.run_id.startsWith('mrun-'), 'merge run id prefix');
  const row = await RUN.get(e.run_id, q);
  assert.equal(row.status, 'queued');
  assert.deepEqual(JSON.parse(row.params), { ids: [1, 2], opts: { mode: 'simulate' } });
});

test('claim_next atomically claims the oldest queued run; no double-claim across workers', async () => {
  const q = fakeDB();
  const a = await RUN.enqueue({ kind: 'merge', mode: 'simulate', params: {} }, q);
  const b = await RUN.enqueue({ kind: 'merge', mode: 'simulate', params: {} }, q);
  const c1 = await RUN.claim_next(['merge'], 'w1', q);
  const c2 = await RUN.claim_next(['merge'], 'w2', q);
  assert.equal(c1.run_id, a.run_id, 'worker 1 gets the oldest (FIFO)');
  assert.equal(c2.run_id, b.run_id, 'worker 2 gets the next — never the same row');
  assert.notEqual(c1.run_id, c2.run_id);
  assert.equal(await RUN.claim_next(['merge'], 'w3', q), null, 'nothing left to claim');
});

test('claim_next respects the kind filter (merge vs restore)', async () => {
  const q = fakeDB();
  await RUN.enqueue({ kind: 'restore', mode: 'simulate', params: {} }, q);
  assert.equal(await RUN.claim_next(['merge'], 'w1', q), null, 'a merge worker skips a restore job');
  const got = await RUN.claim_next(['restore'], 'w1', q);
  assert.ok(got && got.kind === 'restore');
});

test('DB-backed cancel: request_cancel sets the flag, is_cancelled reads it (cross-process)', async () => {
  const q = fakeDB();
  const e = await RUN.enqueue({ kind: 'merge', mode: 'execute', params: {} }, q);
  await RUN.claim_next(['merge'], 'w1', q);   // cancel only applies to a running run
  assert.equal(await RUN.is_cancelled(e.run_id, q), false);
  await RUN.request_cancel(e.run_id, q);
  assert.equal(await RUN.is_cancelled(e.run_id, q), true);
});

test('is_cancelled is false for a null/unknown run', async () => {
  const q = fakeDB();
  assert.equal(await RUN.is_cancelled(null, q), false);
  assert.equal(await RUN.is_cancelled('nope', q), false);
});

test('set_result stores the executor summary (UI parity with the pre-worker response)', async () => {
  const q = fakeDB();
  const e = await RUN.enqueue({ kind: 'merge', mode: 'simulate', params: {} }, q);
  await RUN.set_result(e.run_id, { done: 0, simulated: 3, skipped: 1, failed: 0 }, q);
  const row = await RUN.get(e.run_id, q);
  assert.deepEqual(JSON.parse(row.result), { done: 0, simulated: 3, skipped: 1, failed: 0 });
});
