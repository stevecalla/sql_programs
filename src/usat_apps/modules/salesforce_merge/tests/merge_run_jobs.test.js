'use strict';
// Phase 1 (parallel workers) — job_progress aggregation + cancel_job, on a small in-memory fake.
const { test } = require('node:test');
const assert = require('node:assert');
const run = require('../store/merge_run');

// Fake keyed by run_id; seed with rows carrying job_id/status/completed_sets so we can exercise the
// aggregation + cancel SQL without MySQL.
function fakeDb(seed) {
  const rows = { ...(seed || {}) };
  const query = async (sql, params) => {
    if (/^CREATE TABLE/i.test(sql) || /^ALTER TABLE/i.test(sql)) return {};
    if (/^SELECT/i.test(sql) && /WHERE job_id = \?/.test(sql)) {
      const jid = params[0];
      const list = Object.values(rows).filter((r) => r.job_id === jid)
        .sort((a, b) => (a.batch_index || 0) - (b.batch_index || 0));
      return list;
    }
    if (/^UPDATE/i.test(sql) && /cancel_requested = 1/.test(sql) && /status = "running"/.test(sql)) {
      const jid = params[0]; let n = 0;
      Object.values(rows).forEach((r) => { if (r.job_id === jid && r.status === 'running') { r.cancel_requested = 1; n += 1; } });
      return { affectedRows: n };
    }
    if (/^UPDATE/i.test(sql) && /SET status = "cancelled"/.test(sql)) { // cancel_job: queued -> cancelled
      const jid = params[params.length - 1]; let n = 0;
      Object.values(rows).forEach((r) => { if (r.job_id === jid && r.status === 'queued') { r.status = 'cancelled'; r.finished_at = 'now'; n += 1; } });
      return { affectedRows: n };
    }
    if (/^UPDATE/i.test(sql) && /SET status = "held"/.test(sql)) { // hold_job: queued -> held
      const jid = params[params.length - 1]; let n = 0;
      Object.values(rows).forEach((r) => { if (r.job_id === jid && r.status === 'queued') { r.status = 'held'; n += 1; } });
      return { affectedRows: n };
    }
    if (/^UPDATE/i.test(sql) && /SET status = "queued"/.test(sql) && /status = "held"/.test(sql)) { // resume_job: held -> queued
      const jid = params[0]; let n = 0;
      Object.values(rows).forEach((r) => { if (r.job_id === jid && r.status === 'held') { r.status = 'queued'; r.cancel_requested = 0; n += 1; } });
      return { affectedRows: n };
    }
    return {};
  };
  return { query, rows };
}

function seedJob() {
  return {
    a: { run_id: 'a', job_id: 'job-1', kind: 'merge', mode: 'execute', batch_index: 1, batch_total: 3, status: 'done', total_sets: 2, completed_sets: 2, total_ops: 2, completed_ops: 2, claimed_by: 'w100-x-1', started_at: 't1' },
    b: { run_id: 'b', job_id: 'job-1', kind: 'merge', mode: 'execute', batch_index: 2, batch_total: 3, status: 'running', total_sets: 2, completed_sets: 1, total_ops: 2, completed_ops: 1, claimed_by: 'w200-y-2', started_at: 't2' },
    c: { run_id: 'c', job_id: 'job-1', kind: 'merge', mode: 'execute', batch_index: 3, batch_total: 3, status: 'queued', total_sets: 2, completed_sets: 0, total_ops: 2, completed_ops: 0, claimed_by: null, started_at: 't3' },
  };
}

test('job_progress aggregates sets, counts distinct running workers, rolls up status', async () => {
  const db = fakeDb(seedJob());
  const p = await run.job_progress('job-1', db.query);
  assert.equal(p.runs_total, 3);
  assert.equal(p.runs_done, 1);          // only 'a' is terminal
  assert.equal(p.completed_sets, 3);     // 2 + 1 + 0
  assert.equal(p.total_sets, 6);
  assert.equal(p.workers_active, 1);     // only 'b' is running (one distinct pid prefix)
  assert.equal(p.status, 'running');     // has running/queued
  assert.equal(p.runs.length, 3);
  assert.equal(p.runs[0].batch_index, 1);
});

test('job_progress status = done only when all terminal + no error/cancel', async () => {
  const seed = seedJob();
  seed.b.status = 'done'; seed.b.completed_sets = 2; seed.c.status = 'done'; seed.c.completed_sets = 2;
  const db = fakeDb(seed);
  const p = await run.job_progress('job-1', db.query);
  assert.equal(p.status, 'done');
  assert.equal(p.completed_sets, 6);
  assert.equal(p.workers_active, 0);
});

test('job_progress returns null for an unknown job', async () => {
  const db = fakeDb({});
  assert.equal(await run.job_progress('nope', db.query), null);
});

test('cancel_job flags running chunks + removes queued chunks', async () => {
  const db = fakeDb(seedJob());
  const r = await run.cancel_job('job-1', db.query);
  assert.equal(r.cancelled, 1);   // 'b' running → cancel_requested
  assert.equal(r.removed, 1);     // 'c' queued → cancelled before start
  assert.equal(db.rows.b.cancel_requested, 1);
  assert.equal(db.rows.c.status, 'cancelled');
  assert.equal(db.rows.a.status, 'done'); // terminal untouched
});

test('hold_job pauses (queued→held, running flagged) and resume_job puts held→queued', async () => {
  const db = fakeDb(seedJob());
  const h = await run.hold_job('job-1', 'async Apex cap reached', db.query);
  assert.equal(h.held, 1);        // 'c' queued → held
  assert.equal(h.stopping, 1);    // 'b' running → cancel_requested (finishes its set then stops)
  assert.equal(db.rows.c.status, 'held');
  assert.equal(db.rows.b.cancel_requested, 1);

  // paused rollup: held present, nothing queued
  const p = await run.job_progress('job-1', db.query);
  assert.equal(p.status, 'paused');
  assert.equal(p.runs_held, 1);

  const rr = await run.resume_job('job-1', db.query);
  assert.equal(rr.resumed, 1);    // 'c' held → queued
  assert.equal(db.rows.c.status, 'queued');
  assert.equal(db.rows.c.cancel_requested, 0);
});
