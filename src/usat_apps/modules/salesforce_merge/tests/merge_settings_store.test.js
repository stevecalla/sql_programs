'use strict';
// Phase 2 — DB-backed settings store on a small in-memory fake (no MySQL). Covers ensure/get/set +
// DB->env->default precedence + coerce-on-write + set_many.
const test = require('node:test');
const assert = require('node:assert');
const store = require('../store/merge_settings_store');

function fakeDb() {
  const rows = {}; // skey -> sval
  const query = async (sql, params) => {
    const s = String(sql);
    if (/^CREATE TABLE/i.test(s)) return {};
    if (/^INSERT INTO/i.test(s)) { rows[params[0]] = params[1]; return {}; }
    if (/^SELECT skey, sval/i.test(s)) return Object.keys(rows).map((k) => ({ skey: k, sval: rows[k] }));
    return {};
  };
  return { query, rows };
}

test('get falls back to default when the table is empty', async () => {
  const db = fakeDb();
  assert.equal(await store.get('chunk_size', db.query), 5);
  assert.equal(await store.get('parallel_enabled', db.query), true);
});

test('set coerces+clamps before storing; get then reads it (DB wins over default)', async () => {
  const db = fakeDb();
  const r = await store.set('chunk_size', '999', 'skip', db.query);
  assert.equal(r.stored, 50);                 // clamped to max
  assert.equal(db.rows.chunk_size, '50');     // stored as string
  assert.equal(await store.get('chunk_size', db.query), 50);
});

test('DB value wins over env', async () => {
  const save = { ...process.env };
  process.env.MERGE_CHUNK_SIZE = '7';
  const db = fakeDb();
  assert.equal(await store.get('chunk_size', db.query), 7);  // env, no DB row yet
  await store.set('chunk_size', '9', 'skip', db.query);
  assert.equal(await store.get('chunk_size', db.query), 9);  // DB overrides env
  process.env = save;
});

test('set rejects unknown keys', async () => {
  const db = fakeDb();
  await assert.rejects(() => store.set('bogus', '1', 'skip', db.query), /unknown setting/);
});

test('set_many stores valid keys, ignores unknown', async () => {
  const db = fakeDb();
  const out = await store.set_many({ chunk_size: '3', worker_target: '2', bogus: 'x' }, 'skip', db.query);
  assert.deepStrictEqual(out, { chunk_size: 3, worker_target: 2 });
  assert.equal(db.rows.bogus, undefined);
});

test('get_all returns resolved value+source for every key', async () => {
  const db = fakeDb();
  await store.set('parallel_enabled', 'false', 'skip', db.query);
  const all = await store.get_all(db.query);
  assert.equal(all.parallel_enabled.value, false);
  assert.equal(all.parallel_enabled.source, 'db');
  assert.ok(all.apex_stop_threshold && 'value' in all.apex_stop_threshold);
});
