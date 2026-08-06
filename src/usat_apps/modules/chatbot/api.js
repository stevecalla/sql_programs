'use strict';
// chatbot module API — the internal operator surface (email-queue-style). All endpoints are keyed by QUEUE
// (the SF email-queue queue whose CURATED knowledge + operator corrections ground the bot). Pick a queue in
// the left rail and the whole surface — grounding, corrections, context, conversation log — switches to that
// queue's context space. Queue availability = the live Salesforce list filtered by the shared queue_access.
//
// STRICT grounding: answer only from curated knowledge (+ corrections); if it isn't there, say so and point
// to USA Triathlon. NEVER touches raw email-queue cases / member PII. Every turn is logged to
// chatbot_conversations (transcript + counts), keyed by (channel, queue) — fire-and-forget, never blocks.
const { require_panel, require_admin } = require('../../auth/require_auth');
const ai = require('../../services/ai');
const kb = require('../../services/knowledge');
const url_fetch = require('../../services/knowledge/url_fetch');
const chunk_store = require('../../services/knowledge/chunk_store');
const corrections = require('../../services/corrections');
const corr_store = require('../../services/corrections/mysql_store');
const convo_store = require('./conversations');
const settings = require('./settings');
const sf = require('../../services/salesforce');             // shared SF client — connect + list_queues only (no email-queue module, no case/PII reads)
const queue_access = require('../../services/queue_access');  // shared queue allow-list (same model as the email queue)
const kb_data_dir = require('../../services/knowledge/data_dir');

const P = '/api/chatbot';
const gate = require_panel('chatbot');
const MAX_MSG = 2000;
// Soft DEFAULT selection only (which queue is pre-picked) — NOT an allowlist. Queue AVAILABILITY comes from
// Salesforce (sf.list_queues) filtered by the SHARED queue_access rules (services/queue_access), the same
// access model as the email queue. There is no chatbot-specific queue allowlist.
const DEFAULT_QUEUE = process.env.CHATBOT_QUEUE || 'Team USA';   // exact SF queue name; slug -> team_usa
const CHANNEL = process.env.CHATBOT_CHANNEL || 'internal-poc';
const RETRIEVE_N = Number(process.env.CHATBOT_RETRIEVE_N || 8);

// Retrieval: rank this queue's knowledge CHUNKS (URL context + any file-derived chunks) against a question
// and return a grounding block + provenance. Never throws — grounding must not break a chat/ask.
async function retrieve(queue, question) {
  try {
    const used = await chunk_store.select_chunks(queue, question, RETRIEVE_N);
    return { block: chunk_store.knowledge_from_chunks(used), used: used || [] };
  } catch (e) { return { block: '', used: [] }; }
}
// File knowledge (existing pipeline) + retrieved chunk block, most-relevant chunks first.
function combine_knowledge(fileK, chunkBlock) {
  const parts = [];
  if (chunkBlock && String(chunkBlock).trim()) parts.push(String(chunkBlock).trim());
  if (fileK && String(fileK).trim()) parts.push(String(fileK).trim());
  return parts.join('\n\n');
}
function provenance(used) {
  return (used || []).map(function (u) { return { source_ref: u.source_ref, source_title: u.source_title, category: u.category, score: u.score }; });
}

// Loopback-only gate for the nightly cron endpoint (utilities/cron_get_url_context hits it on localhost:8022).
function local_only(req, res, next) {
  const ip = String((req.ip || (req.socket && req.socket.remoteAddress) || '')).replace('::ffff:', '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return next();
  return res.status(403).json({ ok: false, error: 'local only' });
}

// The queue this request targets: the requested SF queue name (verbatim, so slug() matches the email
// queue's knowledge folder), else the soft default. Access is governed by queue_access at the picker level.
function pick_queue(req) {
  const q = String((req.query && req.query.queue) || (req.body && req.body.queue) || '').trim();
  return q || DEFAULT_QUEUE;
}

// Salesforce connection (read-only, names only — never cases/PII). Cached per env.
function sf_env() { try { const c = kb_data_dir.read_config() || {}; return c.sf_env === 'sandbox' ? 'sandbox' : 'prod'; } catch (e) { return 'prod'; } }
let _conn = null, _conn_env = null;
async function get_conn() {
  const env = sf_env();
  if (_conn && _conn_env === env) return _conn;
  const r = await sf.connect({ is_test: env === 'sandbox', role: 'read' });
  _conn = (r && r.conn) || r; _conn_env = env;
  return _conn;
}
function norm_name(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

let _store = null;
async function get_store() { if (!_store) _store = await corr_store.create_store(); return _store; }

async function used_context(queue) {
  let meta = [];
  try { meta = await kb.list_context_meta(queue); } catch (e) { meta = []; }
  return (meta || []).filter(function (f) { return !f.excluded; });
}

function build_system(queue, knowledge, corr) {
  const kblock = (knowledge && String(knowledge).trim()) ? String(knowledge).trim() : '(no knowledge provided)';
  const cblock = (corr && corr.length) ? corr.map(function (c) { return '- ' + c; }).join('\n') : '';
  const name = String(queue || 'this program');
  return [
    'You are a USA Triathlon assistant for the "' + name + '" program. You help members and visitors with',
    'questions about USA Triathlon and the ' + name + ' program ONLY.',
    '',
    'Rules:',
    '- Answer ONLY using the KNOWLEDGE below (and CORRECTIONS). Do not use outside information.',
    "- If the answer is not in the KNOWLEDGE, say you don't have that information and suggest contacting",
    '  USA Triathlon. Do NOT guess or invent policy.',
    '- If the question is unrelated to USA Triathlon / ' + name + ", politely say that's outside what you can help with.",
    '- Never ask for or reveal personal or member data. Keep answers concise and friendly.',
    '- Write the program name exactly as: "' + name + '".',
    '',
    'KNOWLEDGE:',
    kblock,
    cblock ? ('\nCORRECTIONS (authoritative — follow these):\n' + cblock) : '',
  ].join('\n');
}

function mount(app) {
  // The available queues (left-rail picker): the live Salesforce queue list, filtered by the SHARED
  // queue_access rules for this user (admins see all) — same access model as the email queue. No
  // chatbot-specific allowlist. KEY = the SF-canonical name, so slug(key) matches the email queue's folder.
  app.get(P + '/queues', gate, async function (req, res) {
    let all = null;
    try { const c = await get_conn(); all = await sf.list_queues(c, { with_open_counts: false }); }
    catch (e) { all = null; }   // SF unreachable (e.g. dev without creds)
    if (!all) {
      // Fallback so the picker isn't empty: just the soft default queue.
      return res.json({ ok: true, default: DEFAULT_QUEUE, sf_aligned: false, queues: [{ key: DEFAULT_QUEUE, name: DEFAULT_QUEUE, label: DEFAULT_QUEUE, aligned: false }] });
    }
    const visible = queue_access.filter_queues(all, req.user, req.role);
    const queues = visible.map(function (q) { return { key: q.name, name: q.name, label: q.name, id: q.id, aligned: true }; });
    const dq = queues.find(function (q) { return norm_name(q.key) === norm_name(DEFAULT_QUEUE); });
    const def = (dq && dq.key) || (queues[0] && queues[0].key) || DEFAULT_QUEUE;
    res.json({ ok: true, default: def, sf_aligned: true, queues: queues });
  });

  // Available AI models (shared registry, same list the email queue edits in /admin Settings).
  app.get(P + '/ai/models', gate, function (req, res) {
    try { res.json(ai.list_models()); } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });

  // Settings — the bot's AI choice (provider + model). GET returns current + the model list; POST saves.
  app.get(P + '/settings', gate, function (req, res) {
    try { res.json({ ok: true, settings: settings.get(), models: ai.list_models() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/settings', gate, function (req, res) {
    const b = req.body || {};
    try { res.json({ ok: true, settings: settings.set({ provider: b.provider, model: b.model }) }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });

  // Scope + model + knowledge size for a queue (widget header).
  app.get(P + '/config', gate, async function (req, res) {
    const queue = pick_queue(req);
    let chars = 0;
    try { const k = await kb.load_knowledge(queue); chars = (k && k.length) || 0; } catch (e) { chars = 0; }
    const st = settings.get();
    res.json({ ok: true, scope: queue, queue: queue, provider: st.provider, model: ai.resolve_model(st.provider, st.model || null, process.env), knowledge_chars: chars });
  });

  // The exact context the bot grounds on (files + corrections count + dir). Names/sizes only.
  app.get(P + '/context', gate, async function (req, res) {
    const queue = pick_queue(req);
    try {
      const files = (await used_context(queue)).map(function (f) {
        return { name: f.name, base: f.base, scope: f.scope, folder: f.folder || '', ext: f.ext, size: f.size, key: f.key, excluded: !!f.excluded };
      });
      let knowledge_chars = 0;
      try { const k = await kb.load_knowledge(queue); knowledge_chars = (k && k.length) || 0; } catch (e) { knowledge_chars = 0; }
      let corr = [];
      try { corr = await corrections.grounding_lines(await get_store(), 12, { queue: queue }); } catch (e) { corr = []; }
      let dir = '';
      try { dir = await kb.context_dir(); } catch (e) { dir = ''; }
      res.json({ ok: true, scope: queue, queue: queue, knowledge_chars: knowledge_chars, corrections_used: corr.length, dir: dir, files: files });
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'context failed' }); }
  });

  // Preview ONE context file (text/table/image/pdf).
  app.get(P + '/context/file', gate, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await kb.read_context_file(req.query.scope, pick_queue(req), req.query.name))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // Raw bytes for inline PDF/image + download.
  app.get(P + '/context/raw', gate, async function (req, res) {
    try {
      const fp = await kb.find_context_path(pick_queue(req), req.query.name || '');
      if (!fp) return res.status(404).json({ ok: false, error: 'context file not found' });
      const ext = String(req.query.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv' };
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(require('fs').readFileSync(fp));
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // Upload a curated knowledge file to the queue (or global) scope.
  app.post(P + '/context', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    try {
      const buf = Buffer.from(String(b.data_base64 || ''), 'base64');
      if (!buf.length) return res.status(400).json({ ok: false, error: 'empty upload' });
      res.json({ ok: true, saved: await kb.save_context_file(b.scope, queue, b.name, buf, b.folder) });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // Include/exclude a context file from grounding (affects this shared knowledge store).
  app.post(P + '/context-exclude', gate, function (req, res) {
    try { const b = req.body || {}; kb.set_context_excluded(b.key, !!b.excluded); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- URL context sources (curated web pages -> chunks the bot retrieves over) ----
  // List URL sources for this queue (+ globals) with status + last-fetched.
  app.get(P + '/context-urls', gate, async function (req, res) {
    const queue = pick_queue(req);
    try { res.json({ ok: true, queue: queue, sources: await chunk_store.list_sources(queue) }); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'list failed' }); }
  });
  // Chunks for one source (the expandable chunks view).
  app.get(P + '/context-url/chunks', gate, async function (req, res) {
    try { res.json({ ok: true, chunks: await chunk_store.list_chunks(req.query.source_ref, req.query.scope, pick_queue(req)) }); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'chunks failed' }); }
  });
  // Add a URL: fetch now, chunk, store. { url, scope:'global'|'queue', needs_js? }
  app.post(P + '/context-url', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    const url = String(b.url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'A URL is required.' });
    const added_by = (req.user && (req.user.username || req.user.email)) || '';
    try {
      const r = await url_fetch.add_or_refresh(url, { scope: b.scope === 'global' ? 'global' : 'queue', queue: queue, added_by: added_by, needs_js: !!b.needs_js });
      if (!r.ok) return res.status(400).json({ ok: false, error: r.reason || 'fetch failed', source_ref: r.source_ref });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'add failed' }); }
  });
  // Refresh one source (re-fetch + re-chunk). { source_ref, scope, needs_js? }
  app.post(P + '/context-url/refresh', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    try {
      const r = await url_fetch.add_or_refresh(String(b.source_ref || ''), { scope: b.scope === 'global' ? 'global' : 'queue', queue: queue, added_by: (req.user && (req.user.username || req.user.email)) || '', needs_js: !!b.needs_js });
      res.json(Object.assign({ ok: r.ok }, r));
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'refresh failed' }); }
  });
  // Remove a source and its chunks. { source_ref, scope }
  app.post(P + '/context-url/remove', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    try { await chunk_store.remove_source(String(b.source_ref || ''), b.scope === 'global' ? 'global' : 'queue', queue); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'remove failed' }); }
  });
  // Include/exclude ONE chunk from grounding. { id, excluded }
  app.post(P + '/context-chunk-exclude', gate, async function (req, res) {
    const b = req.body || {};
    try { await chunk_store.set_excluded(b.id, !!b.excluded); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  // Retrieval PREVIEW — the top-N chunks a question WOULD pull (score + source + section). No turn, no log.
  app.post(P + '/retrieve-preview', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    const question = String(b.question || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: 'Empty question.' });
    try { res.json({ ok: true, queue: queue, results: await chunk_store.select_chunks(queue, question, Number(b.n) || RETRIEVE_N) }); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'preview failed' }); }
  });
  // Admin: the web-context allowlist (hostnames). GET returns it; POST replaces it. Admin role only.
  app.get(P + '/context-allowlist', require_admin, function (req, res) {
    try { res.json({ ok: true, allowlist: url_fetch.get_allowlist() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/context-allowlist', require_admin, function (req, res) {
    const b = req.body || {};
    try { res.json({ ok: true, allowlist: url_fetch.set_allowlist(Array.isArray(b.allowlist) ? b.allowlist : []) }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // Nightly refresh entry point — re-fetch + re-chunk every URL source. Loopback only (called by
  // utilities/cron_get_url_context on the server); not a user route.
  app.get(P + '/scheduled-refresh-urls', local_only, async function (req, res) {
    try { const results = await url_fetch.refresh_all(); res.json({ ok: true, refreshed: results.length, results: results }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'refresh failed' }); }
  });

  // Corrections (teach the AI) — shared store, filtered to the queue's relevant scope.
  app.get(P + '/corrections', gate, async function (req, res) {
    const queue = pick_queue(req);
    try {
      const all = await corrections.list(await get_store(), false);
      res.json({ ok: true, queue: queue, corrections: corrections.filter_scope(all, { queue: queue }) });
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'corrections failed' }); }
  });
  app.post(P + '/corrections', gate, async function (req, res) {
    const b = req.body || {}; const queue = pick_queue(req);
    const note = String(b.note || '').trim();
    if (!note) return res.status(400).json({ ok: false, error: 'A correction note is required.' });
    try {
      const author = (req.user && (req.user.username || req.user.email)) || '';
      const rec = await corrections.add({ note: note, question: b.question || '', queue: queue, scope: b.scope || 'queue', author: author }, await get_store());
      res.json({ ok: true, correction: rec });
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'add failed' }); }
  });

  // Conversation THREADS for the middle/left list (grouped by conversation_id).
  app.get(P + '/conversations', gate, async function (req, res) {
    const queue = pick_queue(req);
    const is_test = (req.query.is_test === '0') ? 0 : (req.query.is_test === '1' ? 1 : null);
    try {
      const threads = await convo_store.list_threads(queue, { is_test: is_test, limit: Number(req.query.limit) || 60, q: req.query.q || '', from: req.query.from || '', to: req.query.to || '' });
      res.json({ ok: true, queue: queue, threads: threads });
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'list failed' }); }
  });
  // One conversation's full transcript (center pane).
  app.get(P + '/conversation', gate, async function (req, res) {
    try { res.json({ ok: true, id: req.query.id, turns: await convo_store.by_conversation(req.query.id) }); }
    catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'load failed' }); }
  });

  // POST /api/chatbot/ask — operator INSPECTION: ask a question ABOUT the selected conversation and/or this
  // queue's knowledge. Does NOT create a bot turn / log anything — it's a review tool (like the email queue's
  // "Ask a question", but about our own logged conversation + curated knowledge, never a member case).
  app.post(P + '/ask', gate, async function (req, res) {
    const b = req.body || {};
    const question = String(b.question || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: 'Empty question.' });
    if (question.length > MAX_MSG) return res.status(400).json({ ok: false, error: 'Question too long.' });
    const queue = pick_queue(req);
    try {
      const fileK = await kb.load_knowledge(queue);
      const ret = await retrieve(queue, question);
      const knowledge = combine_knowledge(fileK, ret.block);
      let corr = [];
      try { corr = await corrections.grounding_lines(await get_store(), 12, { queue: queue }); } catch (e) { corr = []; }
      let convoText = '';
      if (b.conversation_id) {
        try {
          const turns = await convo_store.by_conversation(String(b.conversation_id).slice(0, 40));
          convoText = (turns || []).map(function (t) { return (t.role === 'bot' ? 'Assistant: ' : 'User: ') + String(t.text || ''); }).join('\n');
        } catch (e) { convoText = ''; }
      }
      const st = settings.get();
      const provider = st.provider || 'openai';
      const model = ai.resolve_model(provider, st.model || null, process.env);
      if (!model) return res.status(502).json({ ok: false, error: 'No AI model configured.' });
      const kblock = (knowledge && String(knowledge).trim()) ? String(knowledge).trim() : '(no knowledge provided)';
      const cblock = (corr && corr.length) ? corr.map(function (c) { return '- ' + c; }).join('\n') : '';
      const system = [
        'You are helping a USA Triathlon operator review the "' + queue + '" assistant. Answer the OPERATOR',
        'QUESTION about the CONVERSATION (if provided) and/or the assistant KNOWLEDGE below. Be concise and',
        'factual — you may summarize, critique, or check the assistant answers against the knowledge. This is an',
        'internal review tool; do NOT role-play as the member-facing bot.',
        '',
        'KNOWLEDGE:', kblock,
        cblock ? ('\nCORRECTIONS:\n' + cblock) : '',
      ].join('\n');
      const prompt = (convoText ? ('CONVERSATION (selected):\n' + convoText + '\n\n') : '') + 'OPERATOR QUESTION: ' + question;
      const raw = await ai.complete({ provider: provider, model: model, system: system, prompt: prompt });
      const out = ai.norm_completion(raw, model);
      res.json({ ok: true, answer: (out && out.text ? String(out.text).trim() : ''), model: out.model || model, sources: provenance(ret.used) });
      // Intentionally NOT logged to chatbot_conversations — inspection, not a bot turn.
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'ask failed' }); }
  });

  // Chat / test-the-assistant. { message, history?, conversation_id?, turn?, queue?, is_test? }
  app.post(P + '/chat', gate, async function (req, res) {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Empty message.' });
    if (message.length > MAX_MSG) return res.status(400).json({ ok: false, error: 'Message too long.' });
    const queue = pick_queue(req);
    const conversation_id = (b.conversation_id && String(b.conversation_id).slice(0, 40)) || convo_store.new_conversation_id();
    const turn = Number(b.turn || 0);
    const is_test = (b.is_test === 0 || b.is_test === false) ? 0 : 1;   // internal surface defaults to test
    const actor = (req.user && (req.user.username || req.user.email)) || null;
    try {
      const fileK = await kb.load_knowledge(queue);
      const ret = await retrieve(queue, message);
      const knowledge = combine_knowledge(fileK, ret.block);
      let corr = [];
      try { corr = await corrections.grounding_lines(await get_store(), 12, { queue: queue }); } catch (e) { corr = []; }
      let ctx_files = 0;
      try { ctx_files = (await used_context(queue)).length; } catch (e) { ctx_files = 0; }
      const st = settings.get();
      const provider = st.provider || 'openai';
      const model = ai.resolve_model(provider, st.model || null, process.env);
      if (!model) return res.status(502).json({ ok: false, error: 'No AI model configured — set the model in Settings (and the provider API key).' });

      const hist = Array.isArray(b.history) ? b.history.slice(-6) : [];
      const convo = hist.map(function (h) { return (h.role === 'bot' ? 'Assistant: ' : 'User: ') + String(h.text || ''); }).join('\n');
      const prompt = (convo ? (convo + '\n') : '') + 'User: ' + message + '\nAssistant:';

      const t0 = Date.now();
      const raw = await ai.complete({ provider: provider, model: model, system: build_system(queue, knowledge, corr), prompt: prompt });
      const latency_ms = Date.now() - t0;
      const out = ai.norm_completion(raw, model);
      const answer = (out && out.text ? String(out.text).trim() : '');
      const grounded = !!(knowledge && knowledge.length);

      res.json({ ok: true, answer: answer, grounded: grounded, model: out.model || model, conversation_id: conversation_id, queue: queue, sources: provenance(ret.used) });

      const base = { conversation_id: conversation_id, channel: CHANNEL, queue: queue, actor: actor, is_test: is_test };
      convo_store.log_turn(Object.assign({}, base, { turn: turn, role: 'user', text: message }));
      convo_store.log_turn(Object.assign({}, base, {
        turn: turn, role: 'bot', text: answer, provider: provider, model: out.model || model,
        grounded: grounded, knowledge_chars: (knowledge && knowledge.length) || 0,
        context_files: ctx_files, corrections_used: corr.length, latency_ms: latency_ms,
      }));
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'chat failed' }); }
  });
}

module.exports = { mount };
