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
const corrections = require('../../services/corrections');
const corr_store = require('../../services/corrections/mysql_store');
const queue_access = require('./store/queue_access');
const kb_data_dir = require('../../services/knowledge/data_dir');
const analytics = require('./metrics/events');
const metrics_report = require('./metrics/metrics_report');
const metrics_ask = require('./metrics/ask');

// Salesforce env: 'prod' (SF_PROD_*) or 'sandbox' (SF_DEV_*). Read from the module config.json; the
// admin toggle lands in Phase 4. Defaults to production.
function sf_env() {
  try { return (kb_data_dir.read_config() || {}).sf_env === 'sandbox' ? 'sandbox' : 'prod'; } catch (e) { return 'prod'; }
}
function show_test_banner() {
  try { return (kb_data_dir.read_config() || {}).show_test_banner !== false; } catch (e) { return true; }
}

let _conn = null, _conn_env = null;
async function get_conn() {
  const env = sf_env();
  if (_conn && _conn_env === env) return _conn;
  const r = await sf.connect({ is_test: env === 'sandbox', role: 'read' });
  _conn = r.conn; _conn_env = env;
  return _conn;
}
let _cstore = null;
async function corr_store_get() { if (!_cstore) _cstore = await corr_store.create_store(); return _cstore; }
function err(res, e) { res.status(502).json({ ok: false, error: (e && e.message) || String(e) }); }

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

  app.get(P + '/ping', gate, function (req, res) { res.json({ ok: true, module: 'salesforce_email_queue' }); });
  app.get(P + '/config', gate, function (req, res) { res.json({ ok: true, sf_env: sf_env(), show_test_banner: show_test_banner() }); });

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
      const knowledge = await kb.load_knowledge(b.queue);
      const images = await kb.load_context_images(b.queue);
      const corr = await corrections.grounding_lines(await corr_store_get(), 12, { queue: b.queue, user: req.user });
      const r = await ai.respond_to_case({ thread: thread, sender_history: sender_history, attachments_text: attachments_text, provider: b.provider, model: b.model, faq: knowledge, images: images, corrections: corr });
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
      const knowledge = await kb.load_knowledge(b.queue);
      const images = await kb.load_context_images(b.queue);
      const corr = await corrections.grounding_lines(await corr_store_get(), 12, { queue: b.queue, user: req.user });
      const r = await ai.ask_about_case({ thread: thread, sender_history: sender_history, question: b.question, history: b.history, provider: b.provider, model: b.model, faq: knowledge, images: images, corrections: corr });
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
      const r = await ai.triage_case({ thread: thread, provider: b.provider, model: b.model, faq: await kb.load_knowledge(b.queue) });
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

  // Read-only build: Send reply / status change are mocked (no SF writes). Kept so the UI buttons work.
  app.post(P + '/send', gate, function (req, res) {
    const b = req.body || {};
    log_sf(req, b, { event_name: 'send_email', sf_action: 'send', sf_ok: 0, sf_error: 'sending not enabled in this build', ai_reply_chars: (b.body || '').length });
    res.json({ ok: true, mocked: true, note: 'read-only build — no Salesforce write' });
  });
  app.post(P + '/status', gate, function (req, res) {
    const b = req.body || {};
    log_sf(req, b, { event_name: 'status_change', sf_action: 'status_change', status_to: b.status || '', sf_ok: 0, sf_error: 'status change not enabled in this build' });
    res.json({ ok: true, mocked: true, note: 'read-only build — no Salesforce write' });
  });
}

module.exports = { mount };
