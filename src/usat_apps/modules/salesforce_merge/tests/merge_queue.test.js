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
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [{ status: 'queued' }];   // latest = active
    return {};
  };
  await assert.rejects(() => q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'] }, query),
    /already in the merge queue/i);
  assert.ok(!calls.some((s) => /^INSERT/i.test(s)), 'no INSERT when duplicate');
});

test('add rejects an already-merged set (latest status = done) with a MERGED error', async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [{ status: 'done' }];   // already merged
    return {};
  };
  await assert.rejects(() => q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'] }, query),
    /already been merged/i);
  assert.ok(!calls.some((s) => /^INSERT/i.test(s)), 'no INSERT when already merged');
});

test('add ALLOWS re-adding a set whose latest status is restored', async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/^INSERT/i.test(sql)) return { insertId: 5 };
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [{ status: 'restored' }];
    return {};
  };
  const r = await q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'] }, query);
  assert.equal(r.id, 5);
  assert.ok(calls.some((s) => /^INSERT/i.test(s)), 'INSERT issued for a restored set');
});

test('as_losers normalizes string and array', () => {
  assert.deepEqual(q.as_losers('B; C ;;D'), ['B', 'C', 'D']);
  assert.deepEqual(q.as_losers(['X', ' Y ']), ['X', 'Y']);
});

test('list selects newest first; remove deletes by id', async () => {
  const f = fake();
  const rows = await q.list(f.query);
  assert.equal(rows.length, 1);
  assert.ok(f.calls.some((c) => /ORDER BY q\.id DESC/i.test(c.sql)));
  await q.remove(7, f.query);
  const del = f.calls.find((c) => /^DELETE/i.test(c.sql));
  assert.equal(del.params[0], 7);
});

test('add_many queues each entry, counts active as skipped and merged separately', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^INSERT/i.test(sql)) return { insertId: 1 };
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) {
      if (params[1] === 'DUP') return [{ status: 'queued' }];    // already staged -> skipped
      if (params[1] === 'MRG') return [{ status: 'done' }];      // already merged -> merged
      return [];
    }
    return {};
  };
  const r = await q.add_many([
    { source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'] },
    { source_key: 'M2', survivor_account: 'DUP', loser_accounts: ['C'] },
    { source_key: 'M3', survivor_account: 'MRG', loser_accounts: ['D'] },
    { source_key: 'M4', survivor_account: 'E', loser_accounts: ['F'] },
  ], query);
  assert.equal(r.queued, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.merged, 1);
});

test('add persists field_overrides + child_counts as JSON; list parses them back', async () => {
  let stored = null;
  const insertQuery = async (sql, params) => {
    if (/^INSERT/i.test(sql)) { stored = params; return { insertId: 7 }; }
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [];
    return {};
  };
  await q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'],
    field_overrides: { PersonEmail: 'B' }, child_counts: { total: 5, by: { Opportunity: 5 } } }, insertQuery);
  // last two INSERT params are the JSON-serialized overrides + child counts
  // created_at_mtn + created_at_utc are now the last two INSERT params (event-table convention),
  // so field_overrides + child_counts sit at length-4 / length-3.
  assert.equal(stored[stored.length - 4], JSON.stringify({ PersonEmail: 'B' }));
  assert.equal(stored[stored.length - 3], JSON.stringify({ total: 5, by: { Opportunity: 5 } }));
  assert.match(String(stored[stored.length - 2]), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/, 'created_at_mtn');
  assert.match(String(stored[stored.length - 1]), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/, 'created_at_utc');

  const listQuery = async (sql) => {
    if (/CREATE TABLE|ALTER TABLE/i.test(sql)) return {};
    if (/^SELECT/i.test(sql)) return [{ id: 7, survivor_account: 'A', field_overrides: '{"PersonEmail":"B"}', child_counts: '{"total":5}' }];
    return {};
  };
  const rows = await q.list(listQuery);
  assert.deepEqual(rows[0].field_overrides, { PersonEmail: 'B' });
  assert.deepEqual(rows[0].child_counts, { total: 5 });
});

test('add persists environment + org_id (alignment lineage for cross-env safety)', async () => {
  let stored = null;
  const query = async (sql, params) => {
    if (/^INSERT/i.test(sql)) { stored = params; return { insertId: 8 }; }
    if (/WHERE source_key = \? AND survivor_account/i.test(sql)) return [];
    return {};
  };
  await q.add({ source_key: 'M1', survivor_account: 'A', loser_accounts: ['B'], environment: 'Sandbox', org_id: '00DSB000' }, query);
  assert.equal(stored[11], 'Sandbox'); // environment column
  assert.equal(stored[12], '00DSB000'); // org_id column
});

test('set_status approves only queued entries', async () => {
  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); if (/^UPDATE/i.test(sql)) return { affectedRows: 2 }; return {}; };
  const r = await q.set_status([1, 2, 3], 'approved', query);
  const upd = calls.find((c) => /^UPDATE/i.test(c.sql));
  assert.ok(/status = 'queued'/.test(upd.sql), 'only queued -> approved');
  assert.equal(upd.params[0], 'approved');
  assert.equal(r.updated, 2);
});

test('list applies a status filter when given', async () => {
  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); if (/^SELECT/i.test(sql)) return []; return {}; };
  await q.list(query, 'approved');
  const sel = calls.find((c) => /^SELECT q\.\*/i.test(c.sql));
  assert.ok(/WHERE q.status = \?/.test(sel.sql));
  assert.deepEqual(sel.params, ['approved']);
});
