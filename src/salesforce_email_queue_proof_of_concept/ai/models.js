'use strict';
// SINGLE SOURCE OF TRUTH for selectable AI models across EVERY AI feature in this app:
// triage, draft (respond), ask-about-case, and the metrics "Ask your data" box.
//
// The list is EDITABLE at runtime from /admin -> Settings (stored in the external config.json as
// `ai_models`). When no config is saved, the built-in defaults below apply. Each entry:
//   { provider, model, label, is_default?, price_in?, price_out? }
//   - provider  'openai' | 'anthropic' (routes to the transport in ai/providers.js)
//   - model     the exact API model string
//   - price_in / price_out  USD per 1,000,000 tokens (input / output) for cost tracking
// The OpenAI default model tracks OPENAI_MODEL and Claude Sonnet tracks ANTHROPIC_MODEL from .env.
const data_dir = require('../data_dir');

// Published list prices (USD per 1M tokens), captured from the official pricing pages
//   OpenAI:   https://developers.openai.com/api/docs/pricing   (standard, short-context)
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
// Used to SEED new model entries. They can drift — edit them in /admin -> Settings. Models not listed
// here default to 0 (cost shows $0) until a price is set.

const DEFAULT_PRICES = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-5.1': { in: 1.25, out: 10.00 },
  'gpt-5.4': { in: 2.50, out: 15.00 },
  'gpt-5.4-mini': { in: 0.75, out: 4.50 },
  'gpt-5.4-nano': { in: 0.20, out: 1.25 },
  'gpt-5.5': { in: 5.00, out: 30.00 },
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-haiku-4-5-20251001': { in: 1.00, out: 5.00 },
  'claude-haiku-4-5': { in: 1.00, out: 5.00 },
  'claude-opus-4-8': { in: 5.00, out: 25.00 }
};

function seed_price(model) { return DEFAULT_PRICES[model] || { in: 0, out: 0 }; }

// Built-in default list (used when /admin has not saved a custom list). Prices seeded from the table.
function builtin() {
  const openai_model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const sonnet_model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  function row(provider, model, label, is_default) {
    const p = seed_price(model);
    return { provider: provider, model: model, label: label, is_default: !!is_default, price_in: p.in, price_out: p.out };
  }
  return [
    row('openai', openai_model, 'ChatGPT (OpenAI)', true),
    row('anthropic', sonnet_model, 'Claude Sonnet (rich)', false),
    row('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku (fast/cheap)', false)
  ];
}

// Normalize one config-supplied entry into a complete model row (defensive: external/editable input).
function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const provider = e.provider === 'anthropic' ? 'anthropic' : 'openai';
  const model = String(e.model || '').trim();
  if (!model) return null;
  const label = String(e.label || model).slice(0, 60);
  const seed = seed_price(model);
  const num = function (v, d) { const n = Number(v); return isFinite(n) && n >= 0 ? n : d; };
  return {
    provider: provider, model: model, label: label, is_default: !!e.is_default,
    price_in: num(e.price_in, seed.in), price_out: num(e.price_out, seed.out)
  };
}

// The active model list: the saved config.ai_models if present + valid, else the built-in defaults.
// Guarantees exactly one is_default (first entry if none/many flagged).
function list() {
  let rows = null;
  try {
    const cfg = data_dir.read_config() || {};
    if (Array.isArray(cfg.ai_models) && cfg.ai_models.length) {
      rows = cfg.ai_models.map(clean).filter(Boolean);
    }
  } catch (e) { rows = null; }
  if (!rows || !rows.length) rows = builtin();
  if (!rows.some(function (r) { return r.is_default; })) rows[0].is_default = true;
  else { let seen = false; rows.forEach(function (r) { if (r.is_default && seen) r.is_default = false; else if (r.is_default) seen = true; }); }
  return rows;
}

// The default registry entry (explicit is_default, else the first entry).
function default_model() {
  const all = list();
  return all.filter(function (m) { return m.is_default; })[0] || all[0];
}

// The fallback model STRING for one provider (its is_default row, else its first row, else '').
// This is the single place providers.js gets its last-resort model, so no model string is
// hardcoded in the transport layer.
function default_for(provider) {
  const all = list();
  const m = all.filter(function (x) { return x.provider === provider && x.is_default; })[0]
         || all.filter(function (x) { return x.provider === provider; })[0];
  return m ? m.model : '';
}

// Price (USD per 1M tokens) for a model string: the configured/registry entry wins, else the seed
// table, else zero. Returns { in, out }.
function price_for(model) {
  if (!model) return { in: 0, out: 0 };
  const hit = list().filter(function (m) { return m.model === model; })[0];
  if (hit) return { in: Number(hit.price_in) || 0, out: Number(hit.price_out) || 0 };
  return seed_price(model);
}

// Estimated USD cost of one call given the model + token counts. Rounded to 6 decimals.
function cost_for(model, prompt_tokens, completion_tokens) {
  const p = price_for(model);
  const pt = Number(prompt_tokens) || 0, ct = Number(completion_tokens) || 0;
  const usd = (pt / 1e6) * p.in + (ct / 1e6) * p.out;
  return Math.round(usd * 1e6) / 1e6;
}

module.exports = { list, default_model, default_for, price_for, cost_for, DEFAULT_PRICES, builtin };
