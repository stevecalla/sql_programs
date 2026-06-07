'use strict';
// B1 (history) + G1 (live snapshot) + G2 (corrections) grounding, fully offline.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ctx = require('../metrics/ask/context');
const { ask, format_history } = require('../metrics/ask/ask');
const corrections = require('../metrics/ask/corrections');
const live = require('../metrics/ask/live');
const T = require('../metrics/metrics_config').TABLE;

function mock_pool(rows) { return { query: async function () { return [rows, []]; } }; }

describe('format_history (B1)', () => {
  test('empty / non-array -> null', () => {
    assert.equal(format_history(null), null);
    assert.equal(format_history([]), null);
  });
  test('turns become a compact Q/SQL/A block', () => {
    const h = format_history([{ q: 'how many visits?', sql: 'SELECT 1', answer: 'There were 5.\nmore' }]);
    assert.match(h, /Q: how many visits\?/);
    assert.match(h, /SQL: SELECT 1/);
    assert.match(h, /A: There were 5\./);
  });
  test('keeps only the last 4 turns', () => {
    const many = Array.from({ length: 7 }, function (_u, i) { return { q: 'q' + i, answer: 'a' + i }; });
    const h = format_history(many);
    assert.ok(!/q0\b/.test(h) && /q6/.test(h));
  });
});

describe('prompt builders thread the extra grounding', () => {
  const extra = { history: 'Q: earlier?\n  A: yes', live: 'LIVE_SNAP_X', corrections: 'CORR_NOTE_X' };
  test('build_plan_prompt includes history + live + corrections + question + schema', () => {
    const p = ctx.build_plan_prompt('now what?', 'SCHEMA_Y', null, extra);
    assert.match(p, /CORR_NOTE_X/);
    assert.match(p, /LIVE_SNAP_X/);
    assert.match(p, /earlier\?/);
    assert.match(p, /SCHEMA_Y/);
    assert.match(p, /now what\?/);
  });
  test('build_answer_prompt includes corrections', () => {
    const a = ctx.build_answer_prompt('q', { sql: 'SELECT 1', rows: [{ n: 1 }], truncated: false }, extra);
    assert.match(a, /CORR_NOTE_X/);
  });
  test('build_define_prompt includes corrections + live', () => {
    const d = ctx.build_define_prompt('what is x?', extra);
    assert.match(d, /CORR_NOTE_X/);
    assert.match(d, /LIVE_SNAP_X/);
  });
  test('builders are backward-compatible without extra', () => {
    assert.match(ctx.build_plan_prompt('q', 'S', null), /q/);
    assert.ok(!/CORR_NOTE_X/.test(ctx.build_plan_prompt('q', 'S', null)));
  });
});

describe('ask() forwards history/live/corrections into the prompts', () => {
  function capturing_provider(plan_reply, answer) {
    const seen = { plan: null, answer: null };
    return { id: 'mock', default_model: function () { return 'mock'; }, seen: seen,
      chat: async function (o) {
        if (o.system === ctx.PLAN_SYSTEM) { seen.plan = o.user; return plan_reply; }
        seen.answer = o.user; return answer;
      } };
  }
  test('planner + answerer see the injected context', async () => {
    const prov = capturing_provider('SELECT COUNT(*) AS n FROM ' + T, 'ok');
    await ask('and mobile?', { provider_impl: prov, pool: mock_pool([{ n: 1 }]), schema: 'S',
      live: 'LIVE_SNAP_X', corrections: 'CORR_NOTE_X', history: [{ q: 'how many visits?', sql: 'SELECT 1', answer: '5' }] });
    assert.match(prov.seen.plan, /LIVE_SNAP_X/);
    assert.match(prov.seen.plan, /CORR_NOTE_X/);
    assert.match(prov.seen.plan, /how many visits\?/);
    assert.match(prov.seen.answer, /CORR_NOTE_X/);
  });
});

describe('corrections.grounding_text (G2)', () => {
  test('formats active corrections; empty -> null', async () => {
    const txt = await corrections.grounding_text(mock_pool([
      { id: 2, note: 'active user excludes internal test visits', question: 'how many active users?' }
    ]), 12);
    assert.match(txt, /active user excludes internal test visits/);
    assert.match(txt, /re: "how many active users\?"/);
    assert.equal(await corrections.grounding_text(mock_pool([]), 12), null);
  });
});

describe('live.live_snapshot (G1) degrades gracefully', () => {
  test('null pool -> null', async () => {
    assert.equal(await live.live_snapshot(null, {}), null);
  });
  test('failing pool -> null (never throws)', async () => {
    const bad = { query: async function () { throw new Error('db down'); } };
    assert.equal(await live.live_snapshot(bad, {}), null);
  });
});
