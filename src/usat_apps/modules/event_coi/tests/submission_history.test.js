'use strict';
// submission_history.test.js — non-PII run log store, exercised with an injectable fake query (no MySQL).
// Verifies the lifecycle SQL: record_queued (INSERT queued + description), mark_in_progress, update_counts
// (per cert), record_finish (final status + description + counts), mark_server_restart, recent, counts.
const test = require('node:test');
const assert = require('node:assert');
const history = require('../store/submission_history');

function fakeDb(responder) {
  const calls = [];
  const q = async (sql, params) => { calls.push({ sql: sql, params: params || [] }); return responder(sql, params || [], calls.length); };
  q.calls = calls;
  return q;
}
const isDDL = (sql) => /CREATE TABLE|ALTER TABLE/i.test(sql);

test('record_queued inserts status=queued with its description and returns the id', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : (/INSERT INTO/i.test(sql) ? { insertId: 42 } : {}));
  const out = await history.record_queued({ ran_by: 'skip', event_name: 'Boulder Tri', event_sanction_id: '123456', certificates_requested: 12 }, q);
  assert.deepStrictEqual(out, { id: 42 });
  const ins = q.calls.find((c) => /INSERT INTO/i.test(c.sql));
  assert.match(ins.sql, /"queued"/);
  assert.ok(ins.params.includes(history.desc('queued')));   // status_description written
  assert.ok(ins.params.includes('skip') && ins.params.includes(12));
});

test('mark_in_progress flips queued -> in_progress + sets started_at_mtn', async () => {
  const q = fakeDb(() => ({}));
  await history.mark_in_progress(42, q);
  const upd = q.calls[q.calls.length - 1];
  assert.match(upd.sql, /status = "in_progress"/);
  assert.match(upd.sql, /started_at_mtn = COALESCE\(started_at_mtn, \?\)/);
  assert.match(upd.sql, /WHERE id = \? AND status = "queued"/);
  assert.ok(upd.params.includes(history.desc('in_progress')));
});

test('update_counts writes only the counts (no status, no finished_at)', async () => {
  const q = fakeDb(() => ({}));
  await history.update_counts(42, { submitted: 5, failed: 1, skipped: 2 }, q);
  const upd = q.calls[q.calls.length - 1];
  assert.match(upd.sql, /certificates_submitted = \?/);
  assert.doesNotMatch(upd.sql, /status =/);
  assert.doesNotMatch(upd.sql, /finished_at/);
  assert.deepStrictEqual(upd.params, [5, 1, 2, 42]);
});

test('record_finish sets status + description + counts + finished_at_mtn', async () => {
  const q = fakeDb(() => ({}));
  await history.record_finish(42, { status: 'complete', submitted: 10, failed: 0, skipped: 2 }, q);
  const upd = q.calls[q.calls.length - 1];
  assert.match(upd.sql, /finished_at_mtn = \?/);
  assert.strictEqual(upd.params[0], 'complete');
  assert.strictEqual(upd.params[1], history.desc('complete'));
  assert.deepStrictEqual(upd.params.slice(2, 5), [10, 0, 2]);
  assert.match(String(upd.params[5]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);  // Mountain wall-clock
  assert.strictEqual(upd.params[6], 42);
});

test('record_finish / mark_in_progress / update_counts with null id are no-ops', async () => {
  const q = fakeDb(() => ({}));
  await history.record_finish(null, { status: 'complete' }, q);
  await history.mark_in_progress(null, q);
  await history.update_counts(null, {}, q);
  assert.strictEqual(q.calls.length, 0);
});

test('mark_server_restart flips queued AND in_progress rows', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : { affectedRows: 3 });
  const r = await history.mark_server_restart(q);
  assert.strictEqual(r.reset, 3);
  const upd = q.calls.find((c) => /UPDATE/i.test(c.sql) && !isDDL(c.sql));
  assert.match(upd.sql, /status = "server_restart"/);
  assert.match(upd.sql, /WHERE status IN \("queued", "in_progress"\)/);
});

test('recent: newest-first, includes status_description, no holder columns', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : [{ id: 1, status: 'complete' }]);
  await history.recent(5, q);
  const sel = q.calls.find((c) => /SELECT/i.test(c.sql) && /FROM/i.test(c.sql));
  assert.match(sel.sql, /status_description/);
  assert.match(sel.sql, /ORDER BY started_at_mtn DESC, id DESC/);
  assert.match(sel.sql, /LIMIT 5/);
  assert.doesNotMatch(sel.sql, /holder_/);
});

test('counts_by_status maps the ROLLUP null row to TOTAL', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : [{ status: 'complete', runs: 5 }, { status: null, runs: 5 }]);
  const out = await history.counts_by_status(q);
  assert.match(q.calls.find((c) => /SELECT status/i.test(c.sql)).sql, /GROUP BY status WITH ROLLUP/);
  assert.deepStrictEqual(out[out.length - 1], { status: 'TOTAL', runs: 5 });
});
