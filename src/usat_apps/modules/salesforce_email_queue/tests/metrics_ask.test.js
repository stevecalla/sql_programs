'use strict';
// Ask-your-data read-only SQL guard for the Salesforce Email Queue module, scoped to the
// salesforce_email_queue_events table. Pure — no DB, no network.
//
// Ported from the POC's tests/ask.test.js (SQL-guard cases only) and mirrors the platform Ask guard in
// src/usat_apps/tests/metrics.test.js, pointed at THIS module's ask. The platform module's ask() is
// ask(pool, opts) reusing services/ai — NOT the POC's provider-injection brain ask(question,{provider_impl}).
// So the POC's OUT_OF_SCOPE / NO_SQL / definition / ask_sql brain-mode cases are intentionally NOT ported.
//
// Two deviations from the platform test, driven by the REAL module source:
//   * ask.js does not export have_key(), and list_models() is NOT key-gated (services/ai/models.list
//     always returns the builtin registry), so the "list_models() is empty without a key" assertion and
//     ask.have_key() do not apply here.
//   * Because list_models().default is therefore never null, the module's own NO_AI_KEY branch is
//     unreachable; the no-key rejection that actually fires comes from services/ai providers.complete()
//     with code 'NO_API_KEY'. The gate is asserted on that code below.
const test = require('node:test');
const assert = require('node:assert');
const ask = require('../metrics/ask');

const T = ask.TABLE;   // 'salesforce_email_queue_events'

// ---- read-only SELECT guard (single SELECT over the events table only, LIMIT enforced) ----
test('assert_safe_select accepts a plain SELECT over ' + T + ' and enforces a LIMIT', function () {
  const out = ask.assert_safe_select('SELECT ai_provider, COUNT(*) n FROM ' + T + ' GROUP BY ai_provider');
  assert.match(out, /^SELECT/i);
  assert.match(out, /LIMIT \d+/i, 'a LIMIT is appended when absent');
});

test('assert_safe_select rejects non-SELECT, multi-statement, and write queries', function () {
  const bad = [
    'DELETE FROM ' + T,
    'UPDATE ' + T + ' SET is_test=1',
    "INSERT INTO " + T + " (event_name) VALUES ('x')",
    'DROP TABLE ' + T,
    'SELECT 1 FROM ' + T + '; DROP TABLE ' + T,
    '',
  ];
  for (const sql of bad) {
    assert.throws(function () { ask.assert_safe_select(sql); }, /.*/, 'should reject: ' + JSON.stringify(sql));
  }
});

test('assert_safe_select rejects multiple statements', function () {
  assert.throws(
    function () { ask.assert_safe_select('SELECT 1 FROM ' + T + '; SELECT 2 FROM ' + T); },
    /single statement/i
  );
});

test('assert_safe_select rejects reading any table other than ' + T + ' (enforces ask.TABLE)', function () {
  assert.throws(
    function () { ask.assert_safe_select('SELECT * FROM users LIMIT 10'); },
    new RegExp(T + ' table is allowed', 'i')
  );
});

test('assert_safe_select caps an over-large LIMIT to MAX_LIMIT', function () {
  const out = ask.assert_safe_select('SELECT * FROM ' + T + ' LIMIT 999999');
  assert.match(out, new RegExp('LIMIT ' + ask.MAX_LIMIT + '\\b'));
});

test('assert_safe_select strips comments so a blocked keyword inside a comment is neutralized', function () {
  // Comments/strings are stripped before scanning, so the smuggled "; drop" is removed and the remaining
  // query is a plain safe SELECT — the guard returns safe SQL with a LIMIT (no rejection).
  const out = ask.assert_safe_select('SELECT ai_ok FROM ' + T + ' /* ; drop table x */');
  assert.match(out, /^SELECT/i);
  assert.match(out, /LIMIT \d+/i);
  // a real second statement (outside a comment) is still rejected
  assert.throws(
    function () { ask.assert_safe_select('SELECT 1 FROM ' + T + '; DROP TABLE ' + T); },
    /single statement|blocked|read-only/i
  );
});

// ---- no-key gate ----
function withoutKeys(fn) {
  return async function () {
    const a = process.env.ANTHROPIC_API_KEY, o = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
    try { await fn(); }
    finally {
      if (a !== undefined) process.env.ANTHROPIC_API_KEY = a;
      if (o !== undefined) process.env.OPENAI_API_KEY = o;
    }
  };
}

test('list_models() returns the { models, default } shape', function () {
  const m = ask.list_models();
  assert.ok(m && Array.isArray(m.models), 'returns { models: [...] }');
  assert.ok('default' in m, 'exposes a default model id');
});

test('ask() rejects (no AI key) without ever touching the DB', withoutKeys(async function () {
  const pool = { query: function () { throw new Error('DB must not be reached'); } };
  await assert.rejects(
    function () { return ask.ask(pool, { question: 'how many AI calls?' }); },
    function (e) { assert.strictEqual(e.code, 'NO_API_KEY'); return true; }
  );
}));
