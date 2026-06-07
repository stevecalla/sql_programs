'use strict';
// Grounding (events_context.yaml) loads and the prompt builders are correct.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ctx = require('../metrics/ask/context');

describe('ask_context (grounding)', () => {
  test('yaml loads with the required sections', () => {
    const c = ctx.load_context();
    assert.equal(c.dataset.table, 'race_results_transform_events');
    assert.ok(c.rules && c.rules.length >= 5);
    assert.ok(c.events && c.events.page_view);
    assert.ok(c.metrics && c.metrics.unique_visitors);
    assert.ok(Array.isArray(c.example_questions) && c.example_questions.length >= 5);
  });
  test('plan/answer prompts include the question, schema, and read-only rule', () => {
    const p = ctx.build_plan_prompt('how many visits?', 'Table x cols...', null);
    assert.match(p, /how many visits\?/);
    assert.match(p, /Table x cols/);
    assert.match(ctx.PLAN_SYSTEM, /READ-ONLY/i);
    const a = ctx.build_answer_prompt('q', { sql: 'SELECT 1', rows: [{ n: 5 }], truncated: false });
    assert.match(a, /Rows \(JSON/);
  });
});
