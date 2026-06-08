'use strict';
// The ask() pipeline, fully offline: mock provider + mock pool (no LLM, no DB).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ctx = require('../metrics/ask/context');
const { ask, extract_sql } = require('../metrics/ask/ask');
const T = require('../metrics/metrics_config').TABLE;

function mock_pool(rows) { return { query: async function () { return [rows, []]; } }; }
function mock_provider(plan_replies, answer) {
  let i = 0;
  return {
    id: 'mock', default_model: function () { return 'mock'; },
    chat: async function (o) {
      if (o.system === ctx.PLAN_SYSTEM) { const r = plan_replies[Math.min(i, plan_replies.length - 1)]; i++; return r; }
      return answer;
    }
  };
}

describe('ask_pipeline (offline: mock provider + pool)', () => {
  test('extract_sql strips code fences and leading prose', () => {
    assert.equal(extract_sql('```sql\nSELECT 1 FROM ' + T + ';\n```'), 'SELECT 1 FROM ' + T);
    assert.equal(extract_sql('Here you go: SELECT 2 FROM ' + T), 'SELECT 2 FROM ' + T);
  });
  test('happy path: plans, guards (LIMIT injected), runs, answers', async () => {
    const prov = mock_provider(['SELECT event_name, COUNT(*) AS n FROM ' + T + ' GROUP BY event_name'], 'Mostly page views.');
    const r = await ask('event mix?', { provider_impl: prov, pool: mock_pool([{ event_name: 'page_view', n: 9 }]), schema: 'schema' });
    assert.equal(r.ok, true);
    assert.match(r.sql, /LIMIT 1000$/);
    assert.equal(r.answer, 'Mostly page views.');
  });
  test('repairs once when the first query is rejected by the guard', async () => {
    const prov = mock_provider(['SELECT * FROM membership_data', 'SELECT COUNT(*) AS n FROM ' + T], 'There were 5.');
    const r = await ask('how many?', { provider_impl: prov, pool: mock_pool([{ n: 5 }]), schema: 'schema' });
    assert.equal(r.ok, true);
    assert.ok(r.steps.some(function (s) { return s.kind === 'error'; }), 'recorded a repair step');
    assert.match(r.sql, new RegExp(T));
  });
  test('gives up (ok:false) if it never produces a safe query', async () => {
    const prov = mock_provider(['DROP TABLE ' + T, 'DELETE FROM ' + T], 'unused');
    const r = await ask('delete stuff', { provider_impl: prov, pool: mock_pool([]), schema: 'schema', max_attempts: 2 });
    assert.equal(r.ok, false);
    assert.match(r.answer, /Could not produce a valid read-only query/);
  });
  test('definitional question is answered from context, no SQL/DB', async () => {
    let pool_called = false;
    const pool = { query: async function () { pool_called = true; return [[], []]; } };
    const prov = mock_provider(['NO_SQL'], 'Green/amber/red are overall mapping-quality bands.');
    const r = await ask('what do the scorecard bands represent?', { provider_impl: prov, pool: pool, schema: 'schema' });
    assert.equal(r.ok, true);
    assert.equal(r.sql, null);
    assert.equal(pool_called, false);
    assert.match(r.answer, /bands/);
  });
  test('out-of-scope question is declined, not substituted', async () => {
    let queried = false;
    const pool = { query: async function () { queried = true; return [[], []]; } };
    const prov = mock_provider(['OUT_OF_SCOPE'], 'unused');
    const r = await ask('how many members signed up?', { provider_impl: prov, pool: pool, schema: 'schema' });
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'out_of_scope');
    assert.equal(r.sql, null);
    assert.equal(queried, false);
    assert.match(r.answer, /not available|out of scope|only answer/i);
  });
  test('flags truncation when the row cap is hit', async () => {
    const rows = Array.from({ length: 5 }, function (_u, i) { return { d: i }; });
    const prov = mock_provider(['SELECT created_at_mtn FROM ' + T], 'ok');
    const r = await ask('daily series', { provider_impl: prov, pool: mock_pool(rows), schema: 'schema', max_limit: 5 });
    assert.equal(r.truncated, true);
    assert.equal(r.rows.length, 5);
  });
});
