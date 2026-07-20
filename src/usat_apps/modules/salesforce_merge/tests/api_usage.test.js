'use strict';
// Phase 2 — passive SF API-usage capture store. No DB: a stub pool records inserts and returns synthetic
// rows for the aggregations. Covers usage_from_conn parsing, the fire-and-forget record() (columns +
// no-op-on-missing + never-throws), and the report queries.
const test = require('node:test');
const assert = require('node:assert');
const api_usage = require('../store/api_usage');

function stub() {
  const inserts = [];
  const pool = {
    async query(sql, args) {
      const s = String(sql);
      if (/^\s*CREATE TABLE/i.test(s)) return [[], []];
      if (/^\s*INSERT INTO/i.test(s)) { inserts.push(args); return [{ insertId: 1 }, []]; }
      if (/GROUP BY op/.test(s)) return [[{ op: 'probe', snapshots: 3, runs: 0, min_used: 100, max_used: 180, api_max: 100000 }], []];
      if (/run_id = \?/.test(s)) return [[{ run_id: 'r1', op: 'merge', env: 'Sandbox', n: 2, start_used: 200, end_used: 260, cost: 60 }], []];
      if (/ORDER BY created_at_utc ASC/.test(s)) return [[{ created_at_mtn: '2026-07-13 10:00:00', api_used: 120, api_max: 100000, op: 'probe', env: 'Production' }], []];
      return [[], []];
    },
  };
  return { pool, inserts };
}

test('usage_from_conn reads {used,max} from conn.limitInfo.apiUsage', () => {
  assert.deepStrictEqual(api_usage.usage_from_conn({ limitInfo: { apiUsage: { used: 5, limit: 10 } } }), { used: 5, max: 10 });
  assert.strictEqual(api_usage.usage_from_conn({}), null);
  assert.strictEqual(api_usage.usage_from_conn(null), null);
  assert.strictEqual(api_usage.usage_from_conn({ limitInfo: { apiUsage: { used: NaN, limit: 10 } } }), null);
});

test('record inserts a snapshot with the right columns', async () => {
  const { pool, inserts } = stub();
  await api_usage.record({ env: 'Production', org_id: '00D', op: 'probe', run_id: null, actor: 'skip', used: 120, max: 100000 }, pool);
  assert.strictEqual(inserts.length, 1);
  const a = inserts[0]; // [utc, mtn, env, org_id, op, run_id, actor, api_used, api_max, apex_used, apex_max, bulk_used, bulk_max, source]
  assert.strictEqual(a[2], 'Production');
  assert.strictEqual(a[4], 'probe');
  assert.strictEqual(a[7], 120);
  assert.strictEqual(a[8], 100000);
  assert.strictEqual(a[9], null);    // apex_used — not provided → null
  assert.strictEqual(a[13], 'web');  // source (shifted by the 4 apex/bulk columns)
});

test('record stores async-Apex + Bulk usage when provided', async () => {
  const { pool, inserts } = stub();
  await api_usage.record({ env: 'Sandbox', op: 'merge', used: 1, max: 2, apex_used: 500, apex_max: 250000, bulk_used: 3, bulk_max: 15000 }, pool);
  const a = inserts[0];
  assert.strictEqual(a[9], 500);     // apex_used
  assert.strictEqual(a[10], 250000); // apex_max
  assert.strictEqual(a[11], 3);      // bulk_used
  assert.strictEqual(a[12], 15000);  // bulk_max
});

test('record is a no-op when used/max are missing', async () => {
  const { pool, inserts } = stub();
  await api_usage.record({ env: 'Production', op: 'probe', used: null, max: null }, pool);
  assert.strictEqual(inserts.length, 0);
});

test('record never throws even if the pool errors', async () => {
  const pool = { async query() { throw new Error('db down'); } };
  await api_usage.record({ env: 'x', op: 'probe', used: 1, max: 2 }, pool);
  assert.ok(true, 'did not throw');
});

test('summary_by_op returns per-op rows', async () => {
  const { pool } = stub();
  const rows = await api_usage.summary_by_op(pool, { days: 1, env: 'Production' });
  assert.strictEqual(rows[0].op, 'probe');
  assert.strictEqual(rows[0].snapshots, 3);
});

test('run_cost returns the max-min used delta for a run', async () => {
  const { pool } = stub();
  const r = await api_usage.run_cost(pool, 'r1');
  assert.strictEqual(r.cost, 60);
  assert.strictEqual(r.op, 'merge');
});

test('list_recent returns chronological points', async () => {
  const { pool } = stub();
  const rows = await api_usage.list_recent(pool, { days: 1, env: 'Production' });
  assert.strictEqual(rows[0].api_used, 120);
});

test('latest returns the newest snapshot for an env (no live call)', async () => {
  const pool = { async query(sql) {
    if (/ORDER BY created_at_utc DESC LIMIT 1/.test(String(sql))) return [[{ created_at_mtn: '2026-07-13 11:00:00', created_at_utc: '2026-07-13 17:00:00', env: 'Production', org_id: '00D', op: 'probe', api_used: 150, api_max: 100000 }], []];
    return [[], []];
  } };
  const r = await api_usage.latest(pool, 'Production');
  assert.strictEqual(r.api_used, 150);
  assert.strictEqual(r.op, 'probe');
});

test('recent_runs groups per run_id with a max-min cost', async () => {
  const pool = { async query(sql) {
    if (/GROUP BY run_id ORDER BY MAX\(created_at_utc\) DESC/.test(String(sql))) {
      return [[{ run_id: 'mrun-1', op: 'merge', env: 'Production', actor: 'skip', snapshots: 2, start_used: 100, end_used: 160, cost: 60, last_seen: '2026-07-13 12:00:00' }], []];
    }
    return [[], []];
  } };
  const rows = await api_usage.recent_runs(pool, { days: 7, env: 'Production' });
  assert.strictEqual(rows[0].run_id, 'mrun-1');
  assert.strictEqual(rows[0].cost, 60);
});
