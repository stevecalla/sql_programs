'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const run = require('../store/merge_run');

// In-memory fake of the run table keyed by run_id.
function fakeDb() {
  const rows = {};
  const query = async (sql, params) => {
    if (/^CREATE TABLE/i.test(sql)) return {};
    if (/^REPLACE INTO/i.test(sql)) {
      const [run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds, current_label, created_by] = params;
      rows[run_id] = { run_id, kind, mode, environment, org_id, total_ops, total_sets, est_seconds,
        completed_ops: 0, completed_sets: 0, current_label, status: 'running', created_by, started_at: 'now', finished_at: null };
      return {};
    }
    if (/^UPDATE/i.test(sql) && /status = \?/.test(sql)) { // finish
      const runId = params[params.length - 1];
      if (rows[runId]) { rows[runId].status = params[0]; rows[runId].finished_at = 'now'; if (params[3]) rows[runId].current_label = params[3]; }
      return {};
    }
    if (/^UPDATE/i.test(sql)) { // progress update
      const runId = params[params.length - 1];
      const assigns = sql.match(/`(\w+)` = \?/g).map((m) => m.replace(/`| = \?/g, ''));
      assigns.forEach((k, i) => { if (rows[runId]) rows[runId][k] = params[i]; });
      return {};
    }
    if (/^SELECT/i.test(sql) && /WHERE run_id/.test(sql)) return rows[params[0]] ? [rows[params[0]]] : [];
    if (/^SELECT/i.test(sql)) return Object.values(rows); // latest
    return {};
  };
  return { query, rows };
}

test('start creates a running row; update advances progress; finish closes it', async () => {
  const db = fakeDb();
  await run.start({ run_id: 'r1', kind: 'merge', mode: 'execute', environment: 'Sandbox', total_ops: 13, total_sets: 1, est_seconds: 26 }, db.query);
  let r = await run.get('r1', db.query);
  assert.equal(r.status, 'running');
  assert.equal(r.total_ops, 13);
  assert.equal(r.completed_ops, 0);

  await run.update('r1', { completed_ops: 4, current_label: 'Set 1 of 1 · batch 4/13' }, db.query);
  r = await run.get('r1', db.query);
  assert.equal(r.completed_ops, 4);
  assert.match(r.current_label, /batch 4\/13/);

  await run.finish('r1', { status: 'done', completed_ops: 13, completed_sets: 1, current_label: 'Complete' }, db.query);
  r = await run.get('r1', db.query);
  assert.equal(r.status, 'done');
  assert.equal(r.finished_at, 'now');
});

test('latest returns the most recent run', async () => {
  const db = fakeDb();
  await run.start({ run_id: 'r1', kind: 'merge', mode: 'simulate' }, db.query);
  const r = await run.latest('merge', db.query);
  assert.equal(r.run_id, 'r1');
});
