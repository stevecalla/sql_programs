'use strict';
// Single model registry: one source of truth for triage / draft / ask / metrics Ask-box. Covers the
// built-in list shape, the OPENAI_MODEL env-tracking default, seeded pricing + cost math, and the
// admin config override.
//
// ADAPTATION: the real registry takes its override from an injected config reader
// (models.set_config_reader(fn)) rather than the POC's EQ_DATA_DIR/config.json file. The override test
// wires a fake reader and restores the no-op reader afterward so later reads fall back to defaults.
const test = require('node:test');
const assert = require('node:assert');
const models = require('../models');

test('registry lists models with provider+model+label and exactly one default', function () {
  const list = models.list();
  assert.ok(Array.isArray(list) && list.length >= 1, 'non-empty list');
  list.forEach(function (m) { assert.ok(m.provider && m.model && m.label, 'each entry has provider/model/label'); });
  assert.strictEqual(list.filter(function (m) { return m.is_default; }).length, 1, 'exactly one is_default');
  assert.strictEqual(models.default_model().model, list.filter(function (m) { return m.is_default; })[0].model);
});

test('OpenAI registry entry tracks OPENAI_MODEL from env', function () {
  const prev = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = 'gpt-test-123';
  try { assert.strictEqual(models.list().filter(function (m) { return m.provider === 'openai'; })[0].model, 'gpt-test-123'); }
  finally { if (prev === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = prev; }
});

test('price_for returns seeded prices; cost_for multiplies tokens x price', function () {
  const p = models.price_for('claude-sonnet-4-6');
  assert.strictEqual(p.in, 3.00); assert.strictEqual(p.out, 15.00);
  // 1,000,000 in @ $3 + 1,000,000 out @ $15 = $18.00
  assert.strictEqual(models.cost_for('claude-sonnet-4-6', 1000000, 1000000), 18.0);
  // unknown model -> $0 (until priced in /admin)
  assert.strictEqual(models.cost_for('totally-unknown-model', 1000000, 1000000), 0);
});

test('set_config_reader lets an admin ai_models list override the registry', function () {
  try {
    models.set_config_reader(function () {
      return { ai_models: [
        { provider: 'anthropic', model: 'claude-z', label: 'Z', is_default: true, price_in: 2, price_out: 9 }
      ] };
    });
    const l = models.list();
    assert.strictEqual(l.length, 1);
    assert.strictEqual(l[0].model, 'claude-z');
    assert.strictEqual(l[0].is_default, true);
    assert.strictEqual(models.default_model().model, 'claude-z');
    assert.strictEqual(models.price_for('claude-z').in, 2);
    assert.strictEqual(models.cost_for('claude-z', 1e6, 1e6), 11);   // 1*2 + 1*9
  } finally {
    models.set_config_reader(function () { return {}; });   // restore built-in defaults for any later read
  }
});
