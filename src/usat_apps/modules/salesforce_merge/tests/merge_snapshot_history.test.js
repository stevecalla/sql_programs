'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const snap = require('../store/merge_snapshot');
const hist = require('../store/merge_history');

test('snapshot.save writes account rows (survivor/loser) + child rows, with keep-latest delete', async () => {
  const inserts = []; const deletes = [];
  const query = async (sql, params) => {
    if (/^INSERT/i.test(sql)) inserts.push(params);
    if (/^DELETE/i.test(sql)) deletes.push(params);
    return {};
  };
  const entry = { id: 5, source_type: 'merge_id', source_key: 'M1', survivor_account: 'A' };
  const accounts = [{ account: 'A', contact: 'C1', Name: 'Keep' }, { account: 'B', contact: 'C2', Name: 'Lose' }];
  const children = [{ account: 'B', object: 'Opportunity', id: '006X', parent_field: 'AccountId', parent_id: 'B' }];
  const r = await snap.save('run-1', entry, accounts, children, query);
  assert.equal(r.saved, 3);
  assert.equal(r.accounts, 2);
  assert.equal(r.children, 1);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0][0], 5);
  const roles = inserts.map((p) => p[4]);
  assert.deepEqual(roles, ['survivor', 'loser', 'child']);
  assert.equal(inserts[0][5], 'A');
  assert.ok(JSON.parse(inserts[0][9]).Name === 'Keep');
  assert.equal(inserts[2][7], 'child');
  assert.equal(JSON.parse(inserts[2][9]).object, 'Opportunity');
  assert.equal(inserts[2][8], 'Opportunity'); // child_object column
  assert.equal(inserts[0][10], 'A'); // survivor_account column
});

test('history.write inserts a row and list selects newest first', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^INSERT/i.test(sql)) return { insertId: 9 };
    if (/^SELECT/i.test(sql)) return [{ id: 9, result: 'simulated' }];
    return {};
  };
  const r = await hist.write({ run_id: 'run-1', queue_id: 5, survivor_account: 'A', loser_count: 1,
    environment: 'Sandbox', org_id: '00Dxx', snapshot_saved: true, result: 'simulated', reason: 'safe mode' }, query);
  assert.equal(r.id, 9);
  const rows = await hist.list({ limit: 50 }, query);
  assert.equal(rows.length, 1);
  assert.ok(calls.some((c) => /ORDER BY id DESC/i.test(c.sql)));
});

test('history.write persists diff_json (audit) and list parses it back', async () => {
  let stored = null;
  const diff = { kind: 'restore', reset: [{ field: 'PersonEmail', value: 'a@b.com' }], kept: ['Phone'] };
  const query = async (sql, params) => {
    if (/^INSERT/i.test(sql)) { stored = params; return { insertId: 3 }; }
    if (/^SELECT/i.test(sql)) return [{ id: 3, result: 'restored', diff_json: JSON.stringify(diff) }];
    return {};
  };
  await hist.write({ run_id: 'r', result: 'restored', reason: 'x', diff }, query);
  assert.equal(stored[stored.length - 3], JSON.stringify(diff), 'diff_json stored before the two timestamps');
  const rows = await hist.list({ limit: 10 }, query);
  assert.deepEqual(rows[0].diff, diff, 'diff parsed back from diff_json');
});
