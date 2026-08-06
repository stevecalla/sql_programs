'use strict';
// SHARED knowledge/retrieval settings — the single source of truth both the chatbot and the email queue read
// so they retrieve identically. Persisted under a `knowledge` key in the SAME external config.json the rest
// of the app config uses (services/knowledge/data_dir), namespaced so it never clobbers `chatbot` or others.
//
// retrieval_weight: SEMANTIC weight in [0,1]. 0 = keyword only (BM25-lite; embeddings OFF, no embed calls).
//                   1 = semantic only. Anything between = hybrid blend. This one number doubles as on/off.
// embedding_model:  which model produces chunk vectors (change => existing vectors go stale => reindex).
const data_dir = require('./data_dir');

const KNOWN_MODELS = [
  { id: 'text-embedding-3-small', provider: 'openai', dim: 1536, label: 'OpenAI · text-embedding-3-small' },
  { id: 'text-embedding-3-large', provider: 'openai', dim: 3072, label: 'OpenAI · text-embedding-3-large' },
];
const DEFAULT_MODEL = 'text-embedding-3-small';

function clamp01(x) { const n = Number(x); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function norm_model(id) { return KNOWN_MODELS.some(function (m) { return m.id === id; }) ? id : DEFAULT_MODEL; }
function model_info(id) { return KNOWN_MODELS.find(function (m) { return m.id === norm_model(id); }); }

function get() {
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const k = (cfg.knowledge && typeof cfg.knowledge === 'object') ? cfg.knowledge : {};
  const weight = clamp01(k.retrieval_weight);              // default 0 -> keyword only (off)
  const model = norm_model(k.embedding_model);
  return {
    retrieval_weight: weight,
    embeddings_enabled: weight > 0,
    embedding_model: model,
    embedding_provider: (model_info(model) || {}).provider || 'openai',
    embedding_dim: (model_info(model) || {}).dim || 1536,
    models: KNOWN_MODELS,
  };
}

function set(partial) {
  partial = partial || {};
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const cur = (cfg.knowledge && typeof cfg.knowledge === 'object') ? cfg.knowledge : {};
  const next = Object.assign({}, cur);
  if (partial.retrieval_weight !== undefined) next.retrieval_weight = clamp01(partial.retrieval_weight);
  if (partial.embedding_model !== undefined) next.embedding_model = norm_model(partial.embedding_model);
  cfg.knowledge = next;
  data_dir.write_config(cfg);
  return get();
}

module.exports = { get, set, KNOWN_MODELS, DEFAULT_MODEL, model_info };
