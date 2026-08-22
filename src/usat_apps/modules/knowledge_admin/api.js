'use strict';
// Shared Knowledge & AI admin API — governs the ONE knowledge base both the chatbot and the email queue
// ground on. NEUTRAL namespace (/api/knowledge-admin), admin-only. Settings live under the shared `knowledge`
// config key. Curated knowledge only — nothing here reads conversations, cases, or member PII.
//   GET  /api/knowledge-admin/settings   -> { settings, status, allowlist }
//   POST /api/knowledge-admin/settings   { retrieval_weight?, embedding_model? }
//   POST /api/knowledge-admin/reindex    { max? }  -> { embedded, remaining, status }
//   GET  /api/knowledge-admin/status     -> { settings, status, allowlist }   (for polling)
//   GET/POST /api/knowledge-admin/allowlist   { allowlist:[host] }
const { require_admin } = require('../../auth/require_auth');
const settings = require('../../services/knowledge/knowledge_settings');
const chunk_store = require('../../services/knowledge/chunk_store');
const reindex = require('../../services/knowledge/reindex');
const url_fetch = require('../../services/knowledge/url_fetch');
const ai = require('../../services/ai');                              // shared model registry (list both surfaces pick from)
const kb_data_dir = require('../../services/knowledge/data_dir');     // shared config.json read/write
const sf = require('../../services/salesforce');                     // read-only SF (queue names only, no cases/PII)
const queue_access = require('../../services/queue_access');          // shared queue allow-list (who sees which queues)
const auth_store = require('../../auth/auth_store');

// The model registry reads the same external config.json (idempotent — the email module sets this too).
try { ai.set_config_reader(function () { try { return kb_data_dir.read_config() || {}; } catch (e) { return {}; } }); } catch (e) { /* ignore */ }

const P = '/api/knowledge-admin';

// Read-only Salesforce connection (queue names only). The shared client owns the connection + self-heals
// (TTL refresh + reconnect-on-session-error); SF reads go through sf.run(ro(), …), no private cache here.
function sf_env() { try { const c = kb_data_dir.read_config() || {}; return c.sf_env === 'sandbox' ? 'sandbox' : 'prod'; } catch (e) { return 'prod'; } }
function ro() { return { is_test: sf_env() === 'sandbox', role: 'read' }; }

async function snapshot() {
  const st = settings.get();
  let status = { total: 0, embedded: 0, stale: 0, missing: 0, model: st.embedding_model };
  try { status = await chunk_store.embedding_status(st.embedding_model); } catch (e) { /* table may be empty/new */ }
  let allowlist = [];
  try { allowlist = url_fetch.get_allowlist(); } catch (e) { allowlist = []; }
  return { settings: st, status: status, allowlist: allowlist };
}

function mount(app) {
  app.get(P + '/settings', require_admin, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await snapshot())); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/settings', require_admin, async function (req, res) {
    const b = req.body || {};
    try {
      const patch = {};
      if (b.retrieval_weight !== undefined) patch.retrieval_weight = b.retrieval_weight;
      if (b.embedding_model !== undefined) patch.embedding_model = b.embedding_model;
      settings.set(patch);
      res.json(Object.assign({ ok: true }, await snapshot()));
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  // Backfill/refresh vectors for the current model, up to `max` per call (click again to continue).
  app.post(P + '/reindex', require_admin, async function (req, res) {
    const b = req.body || {};
    try { res.json(Object.assign({ ok: true }, await reindex.reindex({ max: Number(b.max) || 500, force: !!b.force }))); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'reindex failed' }); }
  });
  app.get(P + '/status', require_admin, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await snapshot())); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  // Shared web allowlist (moves here from the chatbot admin; the chatbot's own route still works too).
  app.get(P + '/allowlist', require_admin, function (req, res) {
    try { res.json({ ok: true, allowlist: url_fetch.get_allowlist() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/allowlist', require_admin, function (req, res) {
    const b = req.body || {};
    try { res.json({ ok: true, allowlist: url_fetch.set_allowlist(Array.isArray(b.allowlist) ? b.allowlist : []) }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- Shared AI model registry (the list BOTH surfaces pick from) — migrated from the email admin ----
  app.get(P + '/models', require_admin, function (req, res) {
    try { res.json({ ok: true, ai_models: ai.list_models() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/models', require_admin, function (req, res) {
    const b = req.body || {};
    try {
      if (!Array.isArray(b.ai_models)) return res.status(400).json({ ok: false, error: 'ai_models must be an array' });
      const num = function (v, d) { const n = Number(v); return isFinite(n) && n >= 0 ? n : d; };
      const rows = b.ai_models.map(function (e) {
        if (!e || typeof e !== 'object') return null;
        const model = String(e.model || '').trim(); if (!model) return null;
        return { provider: e.provider === 'anthropic' ? 'anthropic' : 'openai', model: model.slice(0, 60), label: String(e.label || model).slice(0, 60), is_default: !!e.is_default, price_in: num(e.price_in, 0), price_out: num(e.price_out, 0) };
      }).filter(Boolean);
      if (!rows.length) return res.status(400).json({ ok: false, error: 'at least one model is required' });
      if (!rows.some(function (r) { return r.is_default; })) rows[0].is_default = true;
      else { let seen = false; rows.forEach(function (r) { if (r.is_default && seen) r.is_default = false; else if (r.is_default) seen = true; }); }
      const cfg = kb_data_dir.read_config() || {}; cfg.ai_models = rows; kb_data_dir.write_config(cfg);
      res.json({ ok: true, ai_models: ai.list_models() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- Shared EMBEDDING model registry (mirrors the AI model registry) — default/provider/model/label/cost ----
  app.get(P + '/embed-models', require_admin, async function (req, res) {
    try { res.json({ ok: true, embed_models: settings.list_models(), status: await chunk_store.embedding_status(settings.get().embedding_model) }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/embed-models', require_admin, async function (req, res) {
    const b = req.body || {};
    try {
      if (!Array.isArray(b.embed_models)) return res.status(400).json({ ok: false, error: 'embed_models must be an array' });
      const saved = settings.save_models(b.embed_models);   // normalizes + guarantees exactly one default
      res.json({ ok: true, embed_models: saved, status: await chunk_store.embedding_status(settings.get().embedding_model) });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- Shared queue access (who sees which queues) — migrated from the email admin. SF names only ----
  app.get(P + '/queue-access', require_admin, async function (req, res) {
    try {
      const queues = await sf.run(ro(), function (c) { return sf.list_queues(c, { with_open_counts: false }); });
      const users = auth_store.env_accounts().map(function (u) { return u.user; }).concat(auth_store.list_users().map(function (u) { return u.user; }));
      queue_access.prune_users(users);   // drop overrides for accounts removed in Users & access
      res.json({ ok: true, queues: queues, access: queue_access.get(), users: users });
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'queue list failed' }); }
  });
  app.post(P + '/queue-access', require_admin, function (req, res) {
    const b = req.body || {};
    try {
      if (b.default !== undefined) queue_access.set_default(b.default);
      if (b.user && b.clear) queue_access.clear_user(b.user);
      else if (b.user && b.queues !== undefined) queue_access.set_user(b.user, b.queues);
      res.json({ ok: true, access: queue_access.get() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
}

module.exports = { mount };
