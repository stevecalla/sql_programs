'use strict';
// salesforce_email_queue module — server API (Phase 2). Ported from the standalone app's web/routes.js,
// re-namespaced under /api/salesforce-email-queue/* and gated by the `email-queue` panel. Read-only.
// Rewired for the platform: AI runs data-in (fetch thread/history here, pass to services/ai — no SF
// dependency in the brain); corrections use the DB store; knowledge/context use services/knowledge.
// Dropped (platform owns them): auth/login/logout/me, admin users/console/logs/pm2. EQ admin config +
// queue-access management move to Phase 4. Server-side analytics logging is deferred to Phase 4.
const { require_panel, require_admin } = require('../../auth/require_auth');
const sf = require('./sf');
const ai = require('../../services/ai');
const kb = require('../../services/knowledge');
const grounding = require('../../services/knowledge/grounding');     // shared curated-knowledge gatherer (same one the chatbot uses)
const chunk_store = require('../../services/knowledge/chunk_store');  // shared URL/web-page chunk store
const url_fetch = require('../../services/knowledge/url_fetch');      // shared URL fetch + chunk pipeline (allow-list enforced)
const corrections = require('../../services/corrections');
const corr_store = require('../../services/corrections/mysql_store');
const queue_access = require('./store/queue_access');
const kb_data_dir = require('../../services/knowledge/data_dir');
const auth_store = require('../../auth/auth_store');
const analytics = require('./metrics/events');
const metrics_report = require('./metrics/metrics_report');
const metrics_ask = require('./metrics/ask');
const console_registry = require('./admin/console_registry');
const console_runner = require('./admin/console_runner');
const log_ring = require('./admin/log_ring');
const PM2_PROCESS_NAME = process.env.EQ_PM2_PROCESS || process.env.PM2_PROCESS_NAME || 'usat_apps';
function open_sse(res) { res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); if (res.flushHeaders) try { res.flushHeaders(); } catch (e) {} }

// Salesforce env: 'prod' (SF_PROD_*) or 'sandbox' (SF_DEV_*). Read from the module config.json; the
// admin toggle lands in Phase 4. Defaults to production.
function sf_env() {
  try { return (kb_data_dir.read_config() || {}).sf_env === 'sandbox' ? 'sandbox' : 'prod'; } catch (e) { return 'prod'; }
}
function show_test_banner() {
  try { return (kb_data_dir.read_config() || {}).show_test_banner !== false; } catch (e) { return true; }
}
const ADMIN_LANDINGS = ['/metrics', '/admin', '/'];
const SF_ENVS = ['prod', 'sandbox'];
function admin_landing() {
  try { const v = (kb_data_dir.read_config() || {}).admin_landing; return ADMIN_LANDINGS.indexOf(v) >= 0 ? v : '/metrics'; } catch (e) { return '/metrics'; }
}
// Master on/off switch for outbound send. Default OFF (false) — send stays disabled until an admin turns it
// on from Admin → Settings, so we can't accidentally email members before it's production-ready.
function send_enabled() {
  try { return (kb_data_dir.read_config() || {}).send_enabled === true; } catch (e) { return false; }
}
// Per-queue default "From" (verified Org-Wide Email Address) map: { <queue_id>: 'teamusa@usatriathlon.org', ... }.
// When an operator sends without picking a specific From, we look up the queue's default here.
function send_queue_from() {
  try { const m = (kb_data_dir.read_config() || {}).send_queue_from; return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; } catch (e) { return {}; }
}
// Wire the shared model registry to read the module config.json (so /admin Settings model edits take effect).
try { ai.set_config_reader(function () { try { return kb_data_dir.read_config() || {}; } catch (e) { return {}; } }); } catch (e) { /* ignore */ }

let _conn = null, _conn_env = null, _conn_user = '';
async function get_conn() {
  const env = sf_env();
  if (_conn && _conn_env === env) return _conn;
  const r = await sf.connect({ is_test: env === 'sandbox', role: 'read' });
  _conn = r.conn; _conn_env = env; _conn_user = r.username || _conn_user;   // SOAP fallback reports the run-as username
  return _conn;
}
// Separate WRITE connection for outbound (send). Under OAuth this is the same run-as user; under the SOAP
// fallback it can be a dedicated write user. Cached per env.
let _wconn = null, _wconn_env = null;
async function get_conn_write() {
  const env = sf_env();
  if (_wconn && _wconn_env === env) return _wconn;
  const r = await sf.connect({ is_test: env === 'sandbox', role: 'write' });
  _wconn = r.conn; _wconn_env = env;
  return _wconn;
}
// The "From" for a send is now resolved dynamically: either the operator picks a verified Org-Wide Email
// Address (GET /org-wide-emails) or it falls back to the queue's default (Admin → Settings). No hardcoded list.
let _cstore = null;
async function corr_store_get() { if (!_cstore) _cstore = await corr_store.create_store(); return _cstore; }
function err(res, e) { res.status(502).json({ ok: false, error: (e && e.message) || String(e) }); }

// The retrieval QUERY for a case: the latest inbound (customer) message text, optionally prefixed with an
// operator question. Curated-knowledge retrieval only — this text is used to RANK shared knowledge chunks,
// never stored. Bounded so a huge thread can't blow up the query.
function thread_query(thread, extra) {
  const inbound = (thread || []).filter(function (m) { return m && m.incoming; });
  const last = inbound[inbound.length - 1] || (thread || [])[(thread || []).length - 1] || {};
  // Message shape from sf/sf_threads.js: text_new (quoted history stripped) / text_raw, plus subject.
  const body = String(last.text_new || last.text_raw || last.subject || '');
  return [String(extra || ''), body].filter(Boolean).join(' ').slice(0, 2000);
}
// The queue a URL request targets (query or body); URL knowledge is queue-keyed, shared with the chatbot.
function eq_pick_queue(req) { return String((req.query && req.query.queue) || (req.body && req.body.queue) || ''); }

// ---- analytics helpers (fire-and-forget; never throw/block a request) ----
function provider_label(p) { return p === 'anthropic' ? 'claude' : 'chatgpt'; }
// is_test is driven ONLY by ?metrics_test=1 (query or body) — not role/env/session.
function mtest(req) { try { return (String((req.query && req.query.metrics_test) || (req.body && req.body.metrics_test) || '') === '1') ? 1 : 0; } catch (e) { return 0; } }
// Common case/session context on every server-logged event. The browser may send body.meta (visitor/
// session ids + tz/local time/viewport/theme/page) so server events carry the same metadata as browser ones.
function ev_ctx(req, body) {
  const m = (body && body.meta) || {};
  return {
    actor: req.user,
    queue: (body && body.queue) || '', queue_id: (body && body.queue_id) || '',
    case_id: (body && body.case_id) || '', case_number: (body && body.case_number) || '',
    visitor_id: m.visitor_id || null, session_id: m.session_id || null,
    is_returning: (m.is_returning != null ? m.is_returning : null),
    page_path: m.page_path || null, event_at_local: m.event_at_local || null,
    client_tz: m.client_tz || null, local_hour: (m.local_hour != null ? m.local_hour : null),
    local_dow: (m.local_dow != null ? m.local_dow : null),
    viewport: m.viewport || null, theme: m.theme || null, engine: m.engine || 'react',
    is_test: mtest(req)
  };
}
function log_ai(req, body, fields) {
  try { analytics.log(Object.assign({ event_name: 'ai_call', ai_provider: provider_label(body && body.provider), ai_model: ai.resolve_model(body && body.provider, body && body.model) }, ev_ctx(req, body), fields || {})); } catch (e) { /* never break the app */ }
}
function log_sf(req, body, fields) {
  try { analytics.log(Object.assign(ev_ctx(req, body), fields || {})); } catch (e) { /* never break the app */ }
}
// Token + estimated-cost fields from an AI result's usage block (cost = tokens x per-model price).
function token_cost(r, body) {
  const u = (r && r.usage) || {};
  const pt = u.prompt_tokens || 0, ct = u.completion_tokens || 0;
  const model = (r && r.ai_model) || ai.resolve_model(body && body.provider, body && body.model);
  return { ai_prompt_tokens: pt, ai_completion_tokens: ct, ai_cost_usd: ai.cost_for(model, pt, ct) };
}

function parse_delimited(text, delim) {
  const rows = []; let row = [], field = '', i = 0, q = false; const s = String(text == null ? '' : text);
  while (i < s.length) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else { q = false; } } else { field += ch; } }
    else if (ch === '"') { q = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else { field += ch; }
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Collect extracted text for a thread's attachments (fetch bytes via SF, extract via services/ai).
async function collect_attachment_text(conn, thread) {
  const out = [];
  for (let i = 0; i < (thread || []).length; i++) {
    const atts = thread[i].attachments || [];
    for (let j = 0; j < atts.length; j++) {
      const a = atts[j];
      try {
        const buf = await sf.fetch_content_version_bytes(conn, a.content_version_id);
        const r = await ai.extract_text(buf, { file_extension: a.file_extension, title: a.title, content_size: a.content_size });
        out.push({ name: a.title + '.' + a.file_extension, text: r.text, note: r.note });
      } catch (e) { out.push({ name: a.title, text: '', note: '[' + a.title + ': download failed]' }); }
    }
  }
  return out;
}

const P = '/api/salesforce-email-queue';

function mount(app) {
  const gate = require_panel('email-queue');
  try { log_ring.install(console); } catch (e) { /* never block mount on logging */ }

  app.get(P + '/ping', gate, function (req, res) { res.json({ ok: true, module: 'salesforce_email_queue' }); });
  app.get(P + '/config', gate, async function (req, res) {
    let sf_user = _conn_user;
    if (!sf_user) { try { await get_conn(); sf_user = _conn_user; } catch (e) { /* connection optional here */ } }
    res.json({ ok: true, sf_env: sf_env(), show_test_banner: show_test_banner(), sf_user: sf_user || '', send_enabled: send_enabled(), send_queue_from: send_queue_from() });
  });

  // Verified Org-Wide Email Addresses (OWEAs) available as a "From" for outbound send. Dynamic — reads the
  // live list from Salesforce so the operator/admin dropdowns reflect whatever support inboxes are verified
  // (e.g. once teamusa@ is verified it shows up here automatically). Panel-gated (operators need it too).
  app.get(P + '/org-wide-emails', gate, async function (req, res) {
    try {
      const c = await get_conn();
      const r = await c.query('SELECT Id, Address, DisplayName, IsAllowAllProfiles FROM OrgWideEmailAddress ORDER BY DisplayName');
      res.json({ ok: true, addresses: (r.records || []).map(function (x) { return { id: x.Id, address: x.Address, display_name: x.DisplayName || '', all_profiles: !!x.IsAllowAllProfiles }; }) });
    } catch (e) { err(res, e); }
  });

  app.get(P + '/queues', gate, async function (req, res) {
    try {
      const c = await get_conn();
      const all = await sf.list_queues(c, { with_open_counts: true });
      const visible = queue_access.filter_queues(all, req.user, req.role);
      res.json({ ok: true, queues: visible, instance_url: c.instanceUrl || '' });
    } catch (e) { err(res, e); }
  });
  app.get(P + '/statuses', gate, async function (req, res) {
    try {
      const c = await get_conn(); const meta = await c.sobject('Case').describe();
      const f = (meta.fields || []).filter(function (x) { return x.name === 'Status'; })[0];
      res.json({ ok: true, statuses: ((f && f.picklistValues) || []).filter(function (v) { return v.active; }).map(function (v) { return v.value; }) });
    } catch (e) { err(res, e); }
  });
  app.get(P + '/cases', gate, async function (req, res) {
    try {
      if (req.query.queue && !queue_access.is_allowed(req.user, req.role, req.query.queue)) return res.status(403).json({ ok: false, error: 'queue not permitted' });
      const c = await get_conn();
      const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
      const cases = await sf.list_queue_cases(c, { queue_id: req.query.queue, status: req.query.status || 'open', limit: lim, date_from: req.query.from || '', date_to: req.query.to || '', date_field: req.query.field || 'LastModifiedDate' });
      const ids = cases.map(function (x) { return x.case_id; });
      const att = await sf.cases_with_attachments(c, ids); const mc = await sf.message_counts(c, ids);
      const lk = (req.query.links === '1') ? await sf.cases_with_links(c, ids) : {};
      cases.forEach(function (x) { x.has_attachment = !!att[x.case_id]; x.message_count = mc[x.case_id] || 0; var L = lk[x.case_id]; x.link_count = L ? L.count : 0; x.first_link = L ? L.first : ''; });
      res.json({ ok: true, cases: cases, limit: lim });
    } catch (e) { err(res, e); }
  });
  app.get(P + '/status-counts', gate, async function (req, res) {
    try {
      if (req.query.queue && !queue_access.is_allowed(req.user, req.role, req.query.queue)) return res.status(403).json({ ok: false, error: 'queue not permitted' });
      res.json(Object.assign({ ok: true }, await sf.status_counts(await get_conn(), req.query.queue)));
    } catch (e) { err(res, e); }
  });
  app.get(P + '/thread', gate, async function (req, res) {
    try { res.json({ ok: true, thread: await sf.get_thread(await get_conn(), req.query.case_id) }); } catch (e) { err(res, e); }
  });

  app.get(P + '/attachment/:cvid/text', gate, async function (req, res) {
    try {
      const c = await get_conn(); const buf = await sf.fetch_content_version_bytes(c, req.params.cvid);
      const r = await ai.extract_text(buf, { file_extension: String(req.query.ext || ''), title: String(req.query.title || 'attachment') });
      res.json({ ok: true, text: r.text, note: r.note });
    } catch (e) { err(res, e); }
  });
  app.get(P + '/attachment/:cvid/raw', gate, async function (req, res) {
    try {
      const c = await get_conn(); const buf = await sf.fetch_content_version_bytes(c, req.params.cvid);
      const ext = String(req.query.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', pdf: 'application/pdf' };
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buf);
    } catch (e) { err(res, e); }
  });
  app.get(P + '/attachment/:cvid/table', gate, async function (req, res) {
    try {
      const c = await get_conn(); const buf = await sf.fetch_content_version_bytes(c, req.params.cvid);
      const ext = String(req.query.ext || '').toLowerCase();
      let rows = null, note = '';
      if (ext === 'csv' || ext === 'tsv') { rows = parse_delimited(buf.toString('utf8'), ext === 'tsv' ? '\t' : ','); }
      else if (ext === 'xlsx' || ext === 'xls') {
        try { const XLSX = require('xlsx'); const wb = XLSX.read(buf, { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]]; rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }); note = 'Sheet: ' + wb.SheetNames[0]; }
        catch (e) { note = 'Spreadsheet parser not installed.'; }
      } else { note = 'Not a tabular file.'; }
      if (rows) rows = rows.slice(0, 500);
      res.json({ ok: true, rows: rows, note: note });
    } catch (e) { err(res, e); }
  });

  app.post(P + '/soql', gate, async function (req, res) {
    try {
      const q = String((req.body && req.body.q) || '').trim();
      if (!/^select\s/i.test(q)) return res.status(400).json({ ok: false, error: 'Only SELECT queries are allowed.' });
      if (/[;]|\b(update|delete|insert|upsert|merge|undelete)\b/i.test(q)) return res.status(400).json({ ok: false, error: 'Only a single read-only SELECT is allowed.' });
      const c = await get_conn(); const r = await c.query(q);
      res.json({ ok: true, total: r.totalSize, done: r.done, records: (r.records || []).map(function (x) { const o = Object.assign({}, x); delete o.attributes; return o; }) });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  app.get(P + '/ai/models', gate, function (req, res) {
    try { res.json(ai.list_models()); } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/ai/respond', gate, async function (req, res) {
    const b = req.body || {}; const t0 = Date.now();
    try {
      const c = await get_conn();
      const thread = await sf.get_thread(c, b.case_id);
      const sender_email = ai.find_sender_email(thread);
      const sender_history = sender_email ? await sf.get_sender_history(c, { email: sender_email, exclude_case_id: b.case_id }) : [];
      const attachments_text = await collect_attachment_text(c, thread);
      // Shared curated knowledge: context files + retrieved URL/web-page chunks (same gatherer the chatbot uses).
      const g = await grounding.gather(b.queue, thread_query(thread));
      const knowledge = g.knowledge;
      const images = await kb.load_context_images(b.queue);
      const corr = await corrections.grounding_lines(await corr_store_get(), 12, { queue: b.queue, user: req.user });
      const r = await ai.respond_to_case({ thread: thread, sender_history: sender_history, attachments_text: attachments_text, provider: b.provider, model: b.model, faq: knowledge, images: images, corrections: corr });
      r.sources = grounding.provenance(g.used);
      log_ai(req, b, Object.assign({
        ai_action: 'respond', ai_verdict: (r.verdict || '').toUpperCase(), ai_latency_ms: Date.now() - t0,
        ai_prompt_chars: r.context_chars || 0, ai_reply_chars: (r.body || '').length,
        ai_used_images: images && images.length ? 1 : 0,
        ai_grounded: ((knowledge && knowledge.length) || (images && images.length) || (corr && corr.length)) ? 1 : 0,
        ai_correction_count: (corr && corr.length) || 0, ai_ok: 1
      }, token_cost(r, b)));
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { log_ai(req, b, { ai_action: 'respond', ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) }); err(res, e); }
  });
  app.post(P + '/ai/ask', gate, async function (req, res) {
    const b = req.body || {}; const action = b.action === 'acknowledge' ? 'acknowledge' : 'ask'; const t0 = Date.now();
    try {
      const c = await get_conn();
      const thread = await sf.get_thread(c, b.case_id);
      const sender_email = ai.find_sender_email(thread);
      const sender_history = sender_email ? await sf.get_sender_history(c, { email: sender_email, exclude_case_id: b.case_id }) : [];
      // Shared curated knowledge, retrieved against the operator's question + latest customer message.
      const g = await grounding.gather(b.queue, thread_query(thread, b.question));
      const knowledge = g.knowledge;
      const images = await kb.load_context_images(b.queue);
      const corr = await corrections.grounding_lines(await corr_store_get(), 12, { queue: b.queue, user: req.user });
      const r = await ai.ask_about_case({ thread: thread, sender_history: sender_history, question: b.question, history: b.history, provider: b.provider, model: b.model, faq: knowledge, images: images, corrections: corr });
      r.sources = grounding.provenance(g.used);
      log_ai(req, b, Object.assign({
        ai_action: action, ai_latency_ms: Date.now() - t0, ai_prompt_chars: r.context_chars || 0,
        ai_reply_chars: (r.answer || '').length, ai_used_images: images && images.length ? 1 : 0,
        ai_grounded: ((knowledge && knowledge.length) || (images && images.length) || (corr && corr.length)) ? 1 : 0,
        ai_correction_count: (corr && corr.length) || 0, ai_ok: 1
      }, token_cost(r, b)));
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { log_ai(req, b, { ai_action: action, ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) }); err(res, e); }
  });
  app.post(P + '/ai/triage', gate, async function (req, res) {
    const b = req.body || {}; const t0 = Date.now();
    try {
      const thread = await sf.get_thread(await get_conn(), b.case_id);
      const g = await grounding.gather(b.queue, thread_query(thread));   // shared curated knowledge (files + URL chunks)
      const r = await ai.triage_case({ thread: thread, provider: b.provider, model: b.model, faq: g.knowledge });
      log_ai(req, b, Object.assign({ ai_action: 'triage', ai_intent: r.status || '', ai_verdict: r.status || '',
        ai_latency_ms: Date.now() - t0, ai_prompt_chars: r.prompt_chars || 0,
        ai_reply_chars: (r.reply_chars != null ? r.reply_chars : (r.reason || '').length), ai_used_images: 0, ai_ok: 1 }, token_cost(r, b)));
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { log_ai(req, b, { ai_action: 'triage', ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) }); err(res, e); }
  });

  app.get(P + '/corrections', gate, async function (req, res) {
    try { res.json({ ok: true, corrections: await corrections.list(await corr_store_get(), false) }); } catch (e) { err(res, e); }
  });
  app.post(P + '/corrections', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const r = await corrections.add({ note: b.note, scope: b.scope, queue: b.queue, case_id: b.case_id, question: b.question, author: req.user }, await corr_store_get());
      res.json({ ok: !!r, correction: r });
    } catch (e) { err(res, e); }
  });

  app.get(P + '/context', gate, async function (req, res) {
    try {
      const q = req.query.queue || ''; const knowledge = await kb.load_knowledge(q);
      res.json({ ok: true, files: await kb.list_context_meta(q), dir: await kb.context_dir(), knowledge_chars: knowledge.length });
    } catch (e) { err(res, e); }
  });
  app.post(P + '/context', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const buf = Buffer.from(String(b.content_base64 || ''), 'base64');
      if (!buf.length) throw new Error('empty file');
      if (buf.length > 25 * 1024 * 1024) throw new Error('file too large (25 MB max)');
      res.json({ ok: true, saved: await kb.save_context_file(b.scope, b.queue, b.name, buf, b.folder) });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'upload failed' }); }
  });
  app.post(P + '/context-exclude', gate, function (req, res) {
    try { const b = req.body || {}; kb.set_context_excluded(b.key, !!b.excluded); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.get(P + '/context/file', gate, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await kb.read_context_file(req.query.scope, req.query.queue, req.query.name))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  // Raw bytes for a context file (used to render PDFs / images inline in the Context viewer).
  app.get(P + '/context/raw', gate, async function (req, res) {
    try {
      const fp = await kb.find_context_path(req.query.queue || '', req.query.name || '');
      if (!fp) return res.status(404).json({ ok: false, error: 'context file not found' });
      const ext = String(req.query.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv' };
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(require('fs').readFileSync(fp));
    } catch (e) { err(res, e); }
  });

  // ---- URL context sources (curated web pages -> chunks) — SHARED with the chatbot (one knowledge base) ----
  // These wrap the SAME shared services (url_fetch + chunk_store) keyed by queue+scope, so a page added here
  // grounds the chatbot too, and vice versa. Curated knowledge only — never touches cases/PII/chat turns.
  app.get(P + '/context-urls', gate, async function (req, res) {
    const queue = eq_pick_queue(req);
    try { res.json({ ok: true, queue: queue, sources: await chunk_store.list_sources(queue) }); }
    catch (e) { err(res, e); }
  });
  app.get(P + '/context-url/chunks', gate, async function (req, res) {
    try { res.json({ ok: true, chunks: await chunk_store.list_chunks(req.query.source_ref, req.query.scope, eq_pick_queue(req)) }); }
    catch (e) { err(res, e); }
  });
  app.post(P + '/context-url', gate, async function (req, res) {
    const b = req.body || {}; const queue = eq_pick_queue(req);
    const url = String(b.url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'A URL is required.' });
    const added_by = (req.user && (req.user.username || req.user.email)) || '';
    try {
      const r = await url_fetch.add_or_refresh(url, { scope: b.scope === 'global' ? 'global' : 'queue', queue: queue, added_by: added_by, needs_js: !!b.needs_js });
      if (!r.ok) return res.status(400).json({ ok: false, error: r.reason || 'fetch failed', source_ref: r.source_ref });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { err(res, e); }
  });
  app.post(P + '/context-url/refresh', gate, async function (req, res) {
    const b = req.body || {}; const queue = eq_pick_queue(req);
    try {
      const r = await url_fetch.add_or_refresh(String(b.source_ref || ''), { scope: b.scope === 'global' ? 'global' : 'queue', queue: queue, added_by: (req.user && (req.user.username || req.user.email)) || '', needs_js: !!b.needs_js });
      res.json(Object.assign({ ok: r.ok }, r));
    } catch (e) { err(res, e); }
  });
  app.post(P + '/context-url/remove', gate, async function (req, res) {
    const b = req.body || {}; const queue = eq_pick_queue(req);
    try { await chunk_store.remove_source(String(b.source_ref || ''), b.scope === 'global' ? 'global' : 'queue', queue); res.json({ ok: true }); }
    catch (e) { err(res, e); }
  });
  app.post(P + '/context-chunk-exclude', gate, async function (req, res) {
    const b = req.body || {};
    try { await chunk_store.set_excluded(b.id, !!b.excluded); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.post(P + '/retrieve-preview', gate, async function (req, res) {
    const b = req.body || {}; const queue = eq_pick_queue(req);
    const question = String(b.question || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: 'Empty question.' });
    try { const g = await grounding.retrieve(queue, question, Number(b.n) || grounding.DEFAULT_N); res.json({ ok: true, queue: queue, mode: g.mode, results: g.used }); }
    catch (e) { err(res, e); }
  });

  // Browser analytics ingest — the module's own events table (rich queue/case/AI columns). The server
  // stamps actor/is_test/env over the client body. Panel-gated so only signed-in operators can log.
  app.post(P + '/event', gate, function (req, res) { try { analytics.ingest_http(req, req.user, req.role); } catch (e) { /* never throws */ } res.status(204).end(); });

  // ---- Metrics dashboard (/metrics/sf-email-queue) — gated by the email-queue-metrics panel ----
  app.get(P + '/metrics-report', require_panel('email-queue-metrics'), async function (req, res) {
    try {
      const pool = await require('../../store/db').get_pool();
      await analytics.ensure(pool);
      res.json({ ok: true, report: await metrics_report.build_report(pool, { days: Number(req.query.days) || 7, include_test: String(req.query.test) === '1' }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post(P + '/metrics-purge-test', require_admin, async function (req, res) {
    try { const pool = await require('../../store/db').get_pool(); res.json({ ok: true, ...(await metrics_report.purge_test(pool)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get(P + '/metrics-ask-models', require_panel('email-queue-metrics'), function (req, res) {
    try { res.json({ ok: true, ...metrics_ask.list_models() }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post(P + '/metrics-ask', require_panel('email-queue-metrics'), async function (req, res) {
    try {
      const b = req.body || {};
      const pool = await require('../../store/db').get_pool();
      res.json(await metrics_ask.ask(pool, { question: b.question, model: b.model, history: b.history, mode: b.mode, sql: b.sql }));
    } catch (e) { res.status(e.code === 'NO_AI_KEY' ? 501 : 400).json({ ok: false, error: e.message }); }
  });
  app.post(P + '/metrics-ask-correct', require_panel('email-queue-metrics'), function (req, res) {
    try {
      const b = req.body || {};
      const note = String(b.note || '').trim();
      if (!note) return res.status(400).json({ ok: false, error: 'no correction text' });
      res.json({ ok: true, count: metrics_ask.add_correction(note, b.question, b.answer, req.user) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- EQ Admin (Settings / Access) — admin-only, ported 1:1 from the standalone app's /admin ----
  app.get(P + '/admin/config', require_admin, function (req, res) {
    res.json({ ok: true, admin_landing: admin_landing(), choices: ADMIN_LANDINGS, ai_models: ai.list_models(), sf_env: sf_env(), sf_envs: SF_ENVS, show_test_banner: show_test_banner(), send_enabled: send_enabled(), send_queue_from: send_queue_from() });
  });
  app.post(P + '/admin/config', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      const cfg = kb_data_dir.read_config() || {};
      // Salesforce env — special-cased: persist, drop the cached SF connection (next read rebuilds against
      // the other org), and return early (mirrors the POC reset_conn behavior).
      if (b.sf_env !== undefined) {
        if (SF_ENVS.indexOf(b.sf_env) < 0) return res.status(400).json({ ok: false, error: 'invalid sf_env' });
        cfg.sf_env = b.sf_env; kb_data_dir.write_config(cfg); _conn = null; _conn_env = null;
        return res.json({ ok: true, admin_landing: admin_landing(), ai_models: ai.list_models(), sf_env: sf_env() });
      }
      if (b.admin_landing !== undefined) {
        if (ADMIN_LANDINGS.indexOf(b.admin_landing) < 0) return res.status(400).json({ ok: false, error: 'invalid landing page' });
        cfg.admin_landing = b.admin_landing;
      }
      if (b.show_test_banner !== undefined) cfg.show_test_banner = !!b.show_test_banner;
      // Master send switch (boolean) — the app-wide kill switch for outbound email.
      if (b.send_enabled !== undefined) cfg.send_enabled = !!b.send_enabled;
      // Per-queue default "From" map: { <queue_id>: '<verified address>' }. Empty string clears a queue's entry.
      if (b.send_queue_from !== undefined) {
        if (b.send_queue_from === null || typeof b.send_queue_from !== 'object' || Array.isArray(b.send_queue_from)) return res.status(400).json({ ok: false, error: 'send_queue_from must be an object' });
        const map = {};
        Object.keys(b.send_queue_from).forEach(function (k) { const v = String(b.send_queue_from[k] || '').trim(); if (v) map[String(k)] = v.slice(0, 254); });
        cfg.send_queue_from = map;
      }
      if (b.ai_models !== undefined) {
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
        cfg.ai_models = rows;
      }
      kb_data_dir.write_config(cfg);
      res.json({ ok: true, admin_landing: admin_landing(), ai_models: ai.list_models(), sf_env: sf_env(), show_test_banner: show_test_banner(), send_enabled: send_enabled(), send_queue_from: send_queue_from() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.get(P + '/admin/queue-access', require_admin, async function (req, res) {
    try {
      const c = await get_conn();
      const queues = await sf.list_queues(c, { with_open_counts: false });
      const users = auth_store.env_accounts().map(function (u) { return u.user; }).concat(auth_store.list_users().map(function (u) { return u.user; }));
      queue_access.prune_users(users);   // self-heal: drop queue overrides for accounts removed in Users & access
      res.json({ ok: true, queues: queues, access: queue_access.get(), users: users });
    } catch (e) { err(res, e); }
  });
  app.post(P + '/admin/queue-access', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      if (b.default !== undefined) queue_access.set_default(b.default);
      if (b.user && b.clear) queue_access.clear_user(b.user);
      else if (b.user && b.queues !== undefined) queue_access.set_user(b.user, b.queues);
      res.json({ ok: true, access: queue_access.get() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- EQ Admin — Overview (config status), Operations (console), Logs. Admin-only. ----
  app.get(P + '/admin/status', require_admin, async function (req, res) {
    let analytics_db = false;
    try { const pool = await require('../../store/db').get_pool(); await pool.query('SELECT 1'); analytics_db = true; } catch (e) { analytics_db = false; }
    const sf_cfg = Object.keys(process.env).some(function (k) { return /^SF_.*USER/i.test(k); });
    res.json({
      ok: true, user: req.user,
      salesforce_configured: sf_cfg,
      openai_key: !!process.env.OPENAI_API_KEY,
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      analytics_db: analytics_db,
      admin_login_configured: !!(process.env.USATAPPS_ADMIN_USER || process.env.USATAPPS_TEST_USER),
      user_login_configured: (function () { try { return auth_store.list_users().length > 0; } catch (e) { return false; } })(),
      ngrok_enabled: false
    });
  });

  app.get(P + '/admin-console/commands', require_admin, function (req, res) {
    res.json({ ok: true, sections: console_runner.commands(), runs: console_runner.list_runs(), audit: console_runner.recent_audit() });
  });
  app.post(P + '/admin-console/run', require_admin, function (req, res) {
    const b = req.body || {};
    const item = console_registry.ALL.filter(function (i) { return String(i.id) === String(b.id); })[0];
    const r = console_runner.start_run(item, b.params, b.confirm);
    res.json(r);
  });
  app.get(P + '/admin-console/stream/:run_id', require_admin, function (req, res) { open_sse(res); console_runner.subscribe(req.params.run_id, res); });
  app.post(P + '/admin-console/kill/:run_id', require_admin, function (req, res) { res.json(console_runner.kill_run(req.params.run_id)); });

  app.get(P + '/admin-logs', require_admin, function (req, res) { res.json({ ok: true, lines: log_ring.tail(req.query.n) }); });
  app.get(P + '/admin-logs/stream', require_admin, function (req, res) { open_sse(res); log_ring.subscribe(res); });
  app.get(P + '/admin-pm2', require_admin, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await log_ring.read_pm2(PM2_PROCESS_NAME))); }
    catch (e) { res.json({ ok: true, under_pm2: false, reason: (e && e.message) || 'error' }); }
  });

  // Send a case reply THROUGH Salesforce (SF delivers to the member + logs it on the case thread). MVP:
  // requires a case, recipient, non-empty body, and a permitted verified "from". Sends as the write connection.
  app.post(P + '/send', gate, async function (req, res) {
    const b = req.body || {};
    const case_id = String(b.case_id || '');
    const to = String(b.to || '').trim();
    let from = String(b.from || '').trim();
    const subject = String(b.subject || '');
    const body = String(b.body || '');
    // Master kill switch: send stays off until an admin enables it in Admin → Settings.
    if (!send_enabled()) return res.status(403).json({ ok: false, error: 'Email send is turned off. An admin can enable it in Admin → Settings → Email sending.' });
    if (!case_id) return res.status(400).json({ ok: false, error: 'No case selected.' });
    if (!to) return res.status(400).json({ ok: false, error: 'A recipient (To) is required.' });
    if (!body.trim()) return res.status(400).json({ ok: false, error: 'The reply is empty.' });
    // Resolve the "From": a blank or "queue-default" sentinel falls back to this queue's configured default
    // address (Admin → Settings → Per-queue From). Keyed by queue_id, then queue name. Empty = SF chooses.
    if (!from || from === 'queue-default') {
      const map = send_queue_from();
      from = String(map[String(b.queue_id || '')] || map[String(b.queue || '')] || '').trim();
    }
    // Method toggle: default is Apex case-reply (threaded, can send from a verified org-wide address).
    // Only an explicit direct/emailSimple choice uses the direct path; anything unspecified -> Apex.
    const method = String(b.method || '').toLowerCase();
    const useApex = !(method === 'emailsimple' || method === 'direct' || method === 'simple');
    try {
      const conn = await get_conn_write();
      const r = useApex
        ? await sf.send_case_email_apex(conn, { case_id: case_id, to: to, from: from, subject: subject, body: body, sender_user: _conn_user })
        : await sf.send_case_email(conn, { case_id: case_id, to: to, from: from, subject: subject, body: body, sender_user: _conn_user });
      log_sf(req, b, { event_name: 'send_email', sf_action: 'send', sf_ok: 1, ai_reply_chars: body.length });
      res.json({ ok: true, sent: true, via: r.via || 'direct', id: r.id || null, sent_as: r.sent_as || null, from_used: r.from_used || null, note: r.note || null, logged: !!r.logged, log_error: r.log_error || null });
    } catch (e) {
      log_sf(req, b, { event_name: 'send_email', sf_action: 'send', sf_ok: 0, sf_error: String((e && e.message) || 'send failed').slice(0, 380), ai_reply_chars: body.length });
      res.status(502).json({ ok: false, error: (e && e.message) || 'send failed' });
    }
  });
  app.post(P + '/status', gate, function (req, res) {
    const b = req.body || {};
    log_sf(req, b, { event_name: 'status_change', sf_action: 'status_change', status_to: b.status || '', sf_ok: 0, sf_error: 'status change not enabled in this build' });
    res.json({ ok: true, mocked: true, note: 'read-only build — no Salesforce write' });
  });
}

module.exports = { mount };
