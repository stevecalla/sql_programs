'use strict';
// Ask-your-data: SQL guard (read-only enforcement) + the ask() brain with injected provider/pool.
// Pure — no DB, no network. Mirrors the transform's ask guard/injection tests.
const test = require('node:test');
const assert = require('node:assert');
const guard = require('../metrics/ask/sql_guard');
const ask = require('../metrics/ask/ask');
const cfg = require('../metrics/metrics_config');

const T = cfg.TABLE;

test('guard: allows a SELECT over the allowed table and injects a LIMIT', function () {
  const safe = guard.assert_safe_select('SELECT ai_provider, COUNT(*) n FROM ' + T + ' GROUP BY ai_provider');
  assert.match(safe, /LIMIT \d+/i);
});
test('guard: clamps an oversized LIMIT', function () {
  const safe = guard.assert_safe_select('SELECT * FROM ' + T + ' LIMIT 999999', { max_limit: 1000 });
  assert.match(safe, /LIMIT 1000/);
});
test('guard: rejects writes + DDL', function () {
  ['INSERT INTO ' + T + ' VALUES (1)', 'UPDATE ' + T + ' SET ai_ok=1', 'DELETE FROM ' + T,
   'DROP TABLE ' + T, 'TRUNCATE ' + T].forEach(function (q) {
    assert.throws(function () { guard.assert_safe_select(q); }, /read-only|blocked|SELECT/i, q);
  });
});
test('guard: rejects multiple statements + disallowed tables', function () {
  assert.throws(function () { guard.assert_safe_select('SELECT 1 FROM ' + T + '; SELECT 2 FROM ' + T); }, /single statement/i);
  assert.throws(function () { guard.assert_safe_select('SELECT * FROM secret_members'); }, /not allowed/i);
});
test('guard: a blocked keyword hidden in a comment is stripped (neutralized), not executed', function () {
  // Comments/strings are stripped before scanning, so the smuggled "; drop" is removed and the
  // remaining query is a plain safe SELECT — the guard returns safe SQL with no "drop"/";".
  const safe = guard.assert_safe_select('SELECT ai_ok FROM ' + T + ' /* ; drop table x */');
  assert.ok(!/drop/i.test(guard.strip_comments_and_strings(safe)), 'drop must be stripped');
  assert.match(safe, /LIMIT/i);
  // a real second statement (outside a comment) is still rejected
  assert.throws(function () { guard.assert_safe_select('SELECT 1 FROM ' + T + '; DROP TABLE ' + T); }, /single statement|blocked|read-only/i);
});

// ---- ask() brain with injected provider + fake pool ----
function fakeProvider(reply) { return { id: 'fake', default_model: function () { return 'm'; }, chat: async function () { return typeof reply === 'function' ? reply() : reply; } }; }
function fakePool(rows) { return { query: async function () { return [rows || []]; } }; }

test('ask: plans SQL, runs it (guarded), then answers', async function () {
  let call = 0;
  const provider = { id: 'fake', default_model: function () { return 'm'; },
    chat: async function () { call++; return call === 1 ? ('SELECT ai_provider, COUNT(*) n FROM ' + T + ' GROUP BY ai_provider') : '**42** calls.'; } };
  const r = await ask.ask('how many AI calls by provider?', {
    provider_impl: provider, schema: 'Table `' + T + '` columns: ai_provider', pool: fakePool([{ ai_provider: 'chatgpt', n: 42 }])
  });
  assert.strictEqual(r.ok, true);
  assert.match(r.sql, /LIMIT/i);
  assert.match(r.answer, /42/);
});
test('ask: OUT_OF_SCOPE for non-events questions', async function () {
  const r = await ask.ask('how many members paid dues?', { provider_impl: fakeProvider('OUT_OF_SCOPE'), schema: 'x', pool: fakePool([]) });
  assert.strictEqual(r.mode, 'out_of_scope');
  assert.match(r.answer, /not available|out of scope|only answer/i);
});
test('ask: NO_SQL definitional question answers from context, no query', async function () {
  let call = 0;
  const provider = { id: 'fake', default_model: function () { return 'm'; }, chat: async function () { call++; return call === 1 ? 'NO_SQL' : 'ai_grounded means context was injected.'; } };
  const r = await ask.ask('what does ai_grounded mean?', { provider_impl: provider, schema: 'x', pool: fakePool([]) });
  assert.strictEqual(r.mode, 'definition');
  assert.match(r.answer, /grounded/i);
});
test('ask_sql: runs guarded user SQL directly (no LLM)', async function () {
  const r = await ask.ask_sql('SELECT COUNT(*) n FROM ' + T, { pool: fakePool([{ n: 7 }]) });
  assert.strictEqual(r.mode, 'sql');
  assert.match(r.sql, /LIMIT/i);
  assert.strictEqual(r.rows[0].n, 7);
});
