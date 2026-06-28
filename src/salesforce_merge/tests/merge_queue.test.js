'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const q = require('../store/merge_queue');

function fake() {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^INSERT/i.test(sql)) return { insertId: 42 };
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [];   // dup check: none
    if (/^SELECT/i.test(sql)) return [{ id: 1, survivor_account: 'A', loser_accounts: 'B;C', loser_count: 2, status: 'queued' }];
    return {};
  };
  return { calls, query };
}

test('add inserts survivor + joined losers + count', async () => {
  const f = fake();
  const r = await q.add({ created_by: 'skip', source_type: 'merge_id', source_key: 'M1',
    survivor_account: 'A', survivor_contact: 'C1', loser_accounts: ['B', 'C'], master_rule: 'mergeid' }, f.query);
  assert.equal(r.id, 42);
  assert.equal(r.loser_count, 2);
  const ins = f.calls.find((c) => /^INSERT/i.test(c.sql));
  assert.ok(ins, 'INSERT issued');
  assert.equal(ins.params[5], 'B;C');
  assert.equal(ins.params[6], 2);
  assert.equal(ins.params[1], 'merge_id');
  assert.ok(f.calls.some((c) => /CREATE TABLE IF NOT EXISTS/i.test(c.sql)), 'ensures table');
});

test('add rejects a duplicate set (same source_key + survivor, still queued)', async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [{ id: 9 }];   // already queued
    return {};
  };
  await assert.rejects(() => q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'] }, query),
    /already in the merge queue/i);
  assert.ok(!calls.some((s) => /^INSERT/i.test(s)), 'no INSERT when duplicate');
});

test('as_losers normalizes string and array', () => {
  assert.deepEqual(q.as_losers('B; C ;;D'), ['B', 'C', 'D']);
  assert.deepEqual(q.as_losers(['X', ' Y ']), ['X', 'Y']);
});

test('list selects newest first; remove deletes by id', async () => {
  const f = fake();
  const rows = await q.list(f.query);
  assert.equal(rows.length, 1);
  assert.ok(f.calls.some((c) => /ORDER BY id DESC/i.test(c.sql)));
  await q.remove(7, f.query);
  const del = f.calls.find((c) => /^DELETE/i.test(c.sql));
  assert.equal(del.params[0], 7);
});
