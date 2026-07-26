'use strict';
// submission_history.test.js — non-PII run log store, exercised with an injectable fake query (no MySQL).
// Verifies the SQL/branch logic: record_start (INSERT running + returns id), record_finish (UPDATE with
// counts + status), mark_interrupted (running->interrupted), recent (LIMIT), counts_by_status (ROLLUP
// NULL -> TOTAL).
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

test('record_start inserts a running row and returns the new id', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : (/INSERT INTO/i.test(sql) ? { insertId: 42 } : {}));
  const out = await history.record_start({ ran_by: 'skip', event_name: 'Boulder Tri', event_sanction_id: '123456', certificates_requested: 12 }, q);
  assert.deepStrictEqual(out, { id: 42 });
  const ins = q.calls.find((c) => /INSERT INTO/i.test(c.sql));
  assert.match(ins.sql, /"running"/);
  assert.match(ins.sql, /NOW\(\)/);                 // started_at = NOW()
  assert.ok(ins.params.includes('skip') && ins.params.includes(12));  // no holder data, just meta + count
});

test('record_finish updates status + outcome counts', async () => {
  const q = fakeDb(() => ({}));
  await history.record_finish(42, { status: 'partial', submitted: 10, failed: 0, skipped: 2 }, q);
  const upd = q.calls.find((c) => /UPDATE/i.test(c.sql));
  assert.match(upd.sql, /certificates_submitted = \?/);
  assert.match(upd.sql, /finished_at = NOW\(\)/);
  assert.deepStrictEqual(upd.params, ['partial', 10, 0, 2, 42]);
});

test('record_finish with null id is a no-op (no query)', async () => {
  const q = fakeDb(() => ({}));
  await history.record_finish(null, { status: 'completed' }, q);
  assert.strictEqual(q.calls.length, 0);
});

test('mark_interrupted flips running rows', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : { affectedRows: 3 });
  const r = await history.mark_interrupted(q);
  assert.strictEqual(r.interrupted, 3);
  const upd = q.calls.find((c) => /UPDATE/i.test(c.sql) && !isDDL(c.sql));
  assert.match(upd.sql, /status = "interrupted"/);
  assert.match(upd.sql, /WHERE status = "running"/);
});

test('recent selects newest-first with a bounded LIMIT and no holder columns', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : [{ id: 1, status: 'completed' }]);
  await history.recent(5, q);
  const sel = q.calls.find((c) => /SELECT/i.test(c.sql) && /FROM/i.test(c.sql));
  assert.match(sel.sql, /ORDER BY started_at DESC/);
  assert.match(sel.sql, /LIMIT 5/);
  assert.doesNotMatch(sel.sql, /holder_/);          // never selects holder data (none exists)
});

test('counts_by_status maps the ROLLUP null row to TOTAL', async () => {
  const q = fakeDb((sql) => isDDL(sql) ? {} : [
    { status: 'completed', runs: 380 }, { status: 'running', runs: 2 }, { status: null, runs: 382 },
  ]);
  const out = await history.counts_by_status(q);
  assert.match(q.calls.find((c) => /SELECT status/i.test(c.sql)).sql, /GROUP BY status WITH ROLLUP/);
  assert.deepStrictEqual(out[out.length - 1], { status: 'TOTAL', runs: 382 });
  assert.deepStrictEqual(out[0], { status: 'completed', runs: 380 });
});
