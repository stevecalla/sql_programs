'use strict';
// Guided playbooks (test_guide) + eval scenarios structure + run_eval gating. Offline.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const guide = require('../metrics/ask/test_guide');
const { SCENARIOS } = require('../metrics/ask/eval/scenarios');
const { run_eval } = require('../metrics/ask/eval/run_eval');

describe('test_guide playbooks', () => {
  test('exposes corrections + threads guides', () => {
    assert.ok(guide.GUIDES.corrections && guide.GUIDES.threads);
    assert.equal(guide.CORRECTIONS_GUIDE.id, 'corrections');
    assert.equal(guide.THREADS_GUIDE.id, 'threads');
  });
  test('format_guide renders title, steps, and the expectation', () => {
    const out = guide.format_guide(guide.CORRECTIONS_GUIDE);
    assert.match(out, /power users/);
    assert.match(out, /ask:correct/);
    assert.match(out, /Expected:/);
    const th = guide.format_guide(guide.THREADS_GUIDE);
    assert.match(th, /break that down by file type/);
    assert.match(th, /thread/i);
  });
});

describe('eval scenarios', () => {
  test('every scenario has an id, kind, and at least one turn', () => {
    assert.ok(SCENARIOS.length >= 3);
    for (const sc of SCENARIOS) {
      assert.ok(sc.id && sc.kind && Array.isArray(sc.turns) && sc.turns.length >= 1, 'bad scenario ' + sc.id);
      for (const t of sc.turns) {
        assert.ok(typeof t.q === 'string' && t.q.length > 0);
        if (t.expect_sql) assert.ok(t.expect_sql instanceof RegExp);
      }
    }
  });
  test('includes the power-user correction and the breakdown thread', () => {
    const ids = SCENARIOS.map(function (s) { return s.id; });
    assert.ok(ids.indexOf('correction_power_user') >= 0);
    assert.ok(ids.indexOf('thread_breakdown') >= 0);
  });
});

describe('run_eval gating', () => {
  test('skips cleanly when no API key is present', async () => {
    const saved_o = process.env.OPENAI_API_KEY, saved_a = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await run_eval({ provider: 'openai' });
      assert.equal(out.skipped, true);
      assert.match(out.reason, /API key/);
    } finally {
      if (saved_o != null) process.env.OPENAI_API_KEY = saved_o;
      if (saved_a != null) process.env.ANTHROPIC_API_KEY = saved_a;
    }
  });
});
