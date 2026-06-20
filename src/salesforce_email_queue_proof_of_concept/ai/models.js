'use strict';
// SINGLE SOURCE OF TRUTH for selectable AI models across EVERY AI feature in this app:
// triage, draft (respond), ask-about-case, and the metrics "Ask your data" box.
//   ADD OR ADJUST MODELS HERE — nowhere else.
// Each entry: { provider, model, label, is_default? }. The provider id ('openai' | 'anthropic')
// routes to the shared transport in ai/providers.js. The OpenAI model tracks OPENAI_MODEL and the
// Claude Sonnet model tracks ANTHROPIC_MODEL from .env (with sensible fallbacks), so a deployment
// can re-point the default model without a code change.
function list() {
  return [
    { provider: 'openai',    model: process.env.OPENAI_MODEL    || 'gpt-4o-mini',            label: 'ChatGPT (OpenAI)',        is_default: true },
    { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',      label: 'Claude Sonnet (rich)' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',                             label: 'Claude Haiku (fast/cheap)' }
  ];
}

// The default registry entry (explicit is_default, else the first entry).
function default_model() {
  const all = list();
  return all.filter(function (m) { return m.is_default; })[0] || all[0];
}

module.exports = { list, default_model };
