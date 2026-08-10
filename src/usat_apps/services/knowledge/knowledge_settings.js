'use strict';
// SHARED knowledge/retrieval settings — the single source of truth both the chatbot and the email queue read
// so they retrieve identically. Persisted under a `knowledge` key in the SAME external config.json the rest
// of the app config uses (services/knowledge/data_dir), namespaced so it never clobbers `chatbot` or others.
//
// retrieval_weight: SEMANTIC weight in [0,1]. 0 = keyword only (BM25-lite; embeddings OFF, no embed calls).
//                   1 = semantic only. Anything between = hybrid blend. This one number doubles as on/off.
// embed_models:     a REGISTRY of embedding models (mirrors the AI model registry) — each { provider, model,
//                   label, is_default, price_in, dim }. The is_default row is the ACTIVE embedding model
//                   (produces chunk vectors; changing it makes existing vectors stale => reindex). price_in is
//                   USD per 1M tokens (embeddings bill input tokens only) and drives embedding-cost tracking.
const data_dir = require('./data_dir');

// Built-in seed registry (used until an admin saves a custom list). Prices are OpenAI list prices per 1M tokens.
const SEED_MODELS = [
  { provider: 'openai', model: 'text-embedding-3-small', label: 'OpenAI · text-embedding-3-small', dim: 1536, price_in: 0.02, is_default: true },
  { provider: 'openai', model: 'text-embedding-3-large', label: 'OpenAI · text-embedding-3-large', dim: 3072, price_in: 0.13, is_default: false },
];
const KNOWN_DIMS = { 'text-embedding-3-small': 1536, 'text-embedding-3-large': 3072, 'text-embedding-ada-002': 1536 };
const DEFAULT_MODEL = 'text-embedding-3-small';

function clamp01(x) { const n = Number(x); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function num(v, d) { const n = Number(v); return isFinite(n) && n >= 0 ? n : d; }

// Normalize one registry entry (defensive: external/editable config). Embeddings run through the OpenAI path,
// so provider is pinned to 'openai' for now; dim falls back to the known dimension for the model, else 1536.
function clean_model(e) {
  if (!e || typeof e !== 'object') return null;
  const model = String(e.model || '').trim();
  if (!model) return null;
  return {
    provider: 'openai',
    model: model.slice(0, 80),
    label: String(e.label || model).slice(0, 80),
    is_default: !!e.is_default,
    price_in: num(e.price_in, 0),
    dim: (function () { const d = parseInt(e.dim, 10); return (isFinite(d) && d > 0) ? d : (KNOWN_DIMS[model] || 1536); })(),
  };
}

// The active registry: saved config.embed_models if present + valid, else the seed list. Guarantees exactly
// one is_default (first entry if none/many flagged).
function list_models() {
  let rows = null;
  try {
    const cfg = data_dir.read_config() || {};
    if (Array.isArray(cfg.embed_models) && cfg.embed_models.length) rows = cfg.embed_models.map(clean_model).filter(Boolean);
  } catch (e) { rows = null; }
  if (!rows || !rows.length) rows = SEED_MODELS.map(function (m) { return Object.assign({}, m); });
  if (!rows.some(function (r) { return r.is_default; })) rows[0].is_default = true;
  else { let seen = false; rows.forEach(function (r) { if (r.is_default && seen) r.is_default = false; else if (r.is_default) seen = true; }); }
  return rows;
}

function default_entry() { const all = list_models(); return all.filter(function (m) { return m.is_default; })[0] || all[0]; }
function model_info(id) { return list_models().filter(function (m) { return m.model === id; })[0] || default_entry(); }

// Price (USD per 1M INPUT tokens) for an embedding model string — registry entry wins, else 0.
function price_in_for(model) { const hit = list_models().filter(function (m) { return m.model === model; })[0]; return hit ? (Number(hit.price_in) || 0) : 0; }
// Estimated USD cost for `tokens` embedded with `model`. Rounded to 6 decimals (embeddings are input-only).
function embed_cost_for(model, tokens) { return Math.round(((Number(tokens) || 0) / 1e6) * price_in_for(model) * 1e6) / 1e6; }

// Persist the embedding-model registry (from the admin panel). Normalizes + guarantees one default.
function save_models(listIn) {
  const rows = (Array.isArray(listIn) ? listIn : []).map(clean_model).filter(Boolean);
  if (!rows.length) throw new Error('at least one embedding model is required');
  if (!rows.some(function (r) { return r.is_default; })) rows[0].is_default = true;
  else { let seen = false; rows.forEach(function (r) { if (r.is_default && seen) r.is_default = false; else if (r.is_default) seen = true; }); }
  let cfg = {}; try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  cfg.embed_models = rows; data_dir.write_config(cfg);
  return list_models();
}

function get() {
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const k = (cfg.knowledge && typeof cfg.knowledge === 'object') ? cfg.knowledge : {};
  const weight = clamp01(k.retrieval_weight);              // default 0 -> keyword only (off)
  const def = default_entry();
  return {
    retrieval_weight: weight,
    embeddings_enabled: weight > 0,
    embedding_model: def.model,
    embedding_provider: def.provider,
    embedding_dim: def.dim,
    embedding_price_in: def.price_in,
    models: list_models().map(function (m) { return Object.assign({ id: m.model }, m); }),
  };
}

function set(partial) {
  partial = partial || {};
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const cur = (cfg.knowledge && typeof cfg.knowledge === 'object') ? cfg.knowledge : {};
  const next = Object.assign({}, cur);
  if (partial.retrieval_weight !== undefined) next.retrieval_weight = clamp01(partial.retrieval_weight);
  cfg.knowledge = next;
  data_dir.write_config(cfg);
  // Selecting an embedding model just marks it the registry default (the registry is the source of truth).
  if (partial.embedding_model !== undefined) {
    const rows = list_models().map(function (m) { return Object.assign({}, m, { is_default: m.model === partial.embedding_model }); });
    if (!rows.some(function (r) { return r.is_default; }) && rows[0]) rows[0].is_default = true;
    save_models(rows);
  }
  return get();
}

module.exports = { get, set, list_models, save_models, price_in_for, embed_cost_for, model_info, default_entry, SEED_MODELS, DEFAULT_MODEL };
