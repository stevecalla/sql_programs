'use strict';
// JSON API for the web app. Login/logout are public; everything else is gated by require_auth.
// The Salesforce connection is cached. Reads + AI reuse the same engine as the CLI. No SF writes.
const sf = require('../sf');
const ai = require('../ai');
const faq = require('../ai/faq');
const corrections = require('../store/corrections');
const queue_access = require('../store/queue_access');
const store = require('../auth/auth_store');
const session = require('../auth/session');
const { require_auth, require_admin } = require('../auth/require_auth');

let _conn = null;
async function get_conn() {
  if (_conn) return _conn;
  const cfg = sf.sf_config({ is_test: false });
  const ck = sf.check_sf_config(cfg);
  if (!ck.ok) throw new Error('Salesforce not configured: ' + ck.missing.join(', '));
  _conn = await sf.make_connection(cfg);
  return _conn;
}
function err(res, e) { res.status(502).json({ ok: false, error: (e && e.message) || String(e) }); }
// Minimal RFC-4180-ish delimited parser (handles quoted fields + embedded delimiters/newlines).
function parse_delimited(text, delim) {
  const rows = []; let row = [], field = '', i = 0, q = false; const s = String(text == null ? '' : text);
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else { q = false; } }
      else { field += ch; }
    } else if (ch === '"') { q = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else { field += ch; }
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function mount(app, deps) {
  // Server-side analytics logger (injected by the server, which owns the DB pool). No-op in tests /
  // when analytics is off, so mount(app) keeps working unchanged.
  const analytics = (deps && deps.analytics) || { log: function () {}, enabled: function () { return false; } };
  // Normalize a provider id to the label stored in analytics.
  function provider_label(p) { return p === 'anthropic' ? 'claude' : 'chatgpt'; }
  // Fire-and-forget AI-call event (never throws, never blocks the response).
  function log_ai(req, body, fields) {
    try {
      analytics.log(Object.assign({
        event_name: 'ai_call', actor: req.user,
        queue: (body && body.queue) || '', queue_id: (body && body.queueId) || '',
        ai_provider: provider_label(body && body.provider),
        is_test: (body && (body._test === 1 || body._test === '1')) ? 1 : 0
      }, fields || {}));
    } catch (e) { /* analytics must never break the app */ }
  }

  app.post('/api/login', function (req, res) {
    const b = req.body || {};
    const v = store.valid_user(b.user, b.pass);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const token = session.sign({ user: v.user, role: v.role || 'user', ts: Date.now() }, store.session_secret());
    res.setHeader('Set-Cookie', session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000));
    res.json({ ok: true, user: v.user, role: v.role || 'user' });
  });
  app.post('/api/logout', function (req, res) { res.setHeader('Set-Cookie', session.COOKIE + '=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.get('/api/me', require_auth, function (req, res) { res.json({ ok: true, user: req.user, role: req.role }); });

  app.get('/api/queues', require_auth, async function (req, res) {
    try {
      const c = await get_conn();
      const all = await sf.list_queues(c, { with_open_counts: true });
      // Enforce the allow-list: non-admins only see queues they're permitted (general default or a
      // per-user override). Admins see all. Managed from /admin.
      const visible = queue_access.filter_queues(all, req.user, req.role);
      res.json({ ok: true, queues: visible, instance_url: c.instanceUrl || '' });
    } catch (e) { err(res, e); }
  });
  app.get('/api/statuses', require_auth, async function (req, res) {
    try {
      const c = await get_conn(); const meta = await c.sobject('Case').describe();
      const f = (meta.fields || []).filter(function (x) { return x.name === 'Status'; })[0];
      res.json({ ok: true, statuses: ((f && f.picklistValues) || []).filter(function (v) { return v.active; }).map(function (v) { return v.value; }) });
    } catch (e) { err(res, e); }
  });
  app.get('/api/cases', require_auth, async function (req, res) {
    try {
      // Allow-list guard: a non-admin may not read cases from a queue they aren't permitted.
      if (req.query.queue && !queue_access.is_allowed(req.user, req.role, req.query.queue)) {
        return res.status(403).json({ ok: false, error: 'queue not permitted' });
      }
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
  app.get('/api/status-counts', require_auth, async function (req, res) {
    try {
      if (req.query.queue && !queue_access.is_allowed(req.user, req.role, req.query.queue)) {
        return res.status(403).json({ ok: false, error: 'queue not permitted' });
      }
      res.json(Object.assign({ ok: true }, await sf.status_counts(await get_conn(), req.query.queue)));
    } catch (e) { err(res, e); }
  });
  app.get('/api/thread', require_auth, async function (req, res) {
    try { res.json({ ok: true, thread: await sf.get_thread(await get_conn(), req.query.caseId) }); } catch (e) { err(res, e); }
  });
  app.get('/api/attachment/:cvid/text', require_auth, async function (req, res) {
    try {
      const c = await get_conn(); const buf = await sf.fetch_content_version_bytes(c, req.params.cvid);
      const r = await ai.extract_text(buf, { file_extension: String(req.query.ext || ''), title: String(req.query.title || 'attachment') });
      res.json({ ok: true, text: r.text, note: r.note });
    } catch (e) { err(res, e); }
  });

  app.get('/api/attachment/:cvid/table', require_auth, async function (req, res) {
    try {
      const c = await get_conn(); const buf = await sf.fetch_content_version_bytes(c, req.params.cvid);
      const ext = String(req.query.ext || '').toLowerCase();
      let rows = null, note = '';
      if (ext === 'csv' || ext === 'tsv') {
        rows = parse_delimited(buf.toString('utf8'), ext === 'tsv' ? '\t' : ',');
      } else if (ext === 'xlsx' || ext === 'xls') {
        try {
          const XLSX = require('xlsx');
          const wb = XLSX.read(buf, { type: 'buffer' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
          note = 'Sheet: ' + wb.SheetNames[0] + (wb.SheetNames.length > 1 ? ' (of ' + wb.SheetNames.length + ')' : '');
        } catch (e) { note = 'Spreadsheet parser not installed - run "npm install xlsx" at the repo root to preview .xlsx/.xls as a table.'; }
      } else { note = 'Not a tabular file.'; }
      if (rows) rows = rows.slice(0, 500); // cap
      res.json({ ok: true, rows: rows, note: note });
    } catch (e) { err(res, e); }
  });

  // Read-only SOQL runner: SELECT statements only, executed via the integration connection.
  app.post('/api/soql', require_auth, async function (req, res) {
    try {
      const q = String((req.body && req.body.q) || '').trim();
      if (!/^select\s/i.test(q)) return res.status(400).json({ ok: false, error: 'Only SELECT queries are allowed.' });
      if (/[;]|\b(update|delete|insert|upsert|merge|undelete)\b/i.test(q)) return res.status(400).json({ ok: false, error: 'Only a single read-only SELECT is allowed.' });
      const c = await get_conn();
      const r = await c.query(q);
      res.json({ ok: true, total: r.totalSize, done: r.done, records: (r.records || []).map(function (x) { const o = Object.assign({}, x); delete o.attributes; return o; }) });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  app.post('/api/ai/respond', require_auth, async function (req, res) {
    const b = req.body || {};
    const t0 = Date.now();
    try {
      const knowledge = await faq.load_knowledge(b.queue);
      const images = await faq.load_context_images(b.queue);
      const corr = corrections.grounding_lines(12, { queue: b.queue, user: req.user });
      const r = await ai.respond_to_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, fetch_attachments: true, faq: knowledge, images: images, corrections: corr });
      log_ai(req, b, {
        ai_action: 'respond', ai_verdict: (r.verdict || '').toUpperCase(),
        ai_latency_ms: Date.now() - t0, ai_prompt_chars: r.context_chars || 0,
        ai_reply_chars: (r.body || '').length, ai_used_images: images && images.length ? 1 : 0,
        ai_grounded: (knowledge && knowledge.length) || (images && images.length) || (corr && corr.length) ? 1 : 0,
        ai_correction_count: (corr && corr.length) || 0, ai_ok: 1
      });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) {
      log_ai(req, b, { ai_action: 'respond', ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) });
      err(res, e);
    }
  });
  app.post('/api/ai/ask', require_auth, async function (req, res) {
    const b = req.body || {};
    const action = b.action === 'acknowledge' ? 'acknowledge' : 'ask';
    const t0 = Date.now();
    try {
      const knowledge = await faq.load_knowledge(b.queue);
      const images = await faq.load_context_images(b.queue);
      const corr = corrections.grounding_lines(12, { queue: b.queue, user: req.user });
      const r = await ai.ask_about_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, question: b.question, history: b.history, faq: knowledge, images: images, corrections: corr });
      log_ai(req, b, {
        ai_action: action, ai_latency_ms: Date.now() - t0, ai_prompt_chars: r.context_chars || 0,
        ai_reply_chars: (r.answer || '').length, ai_used_images: images && images.length ? 1 : 0,
        ai_grounded: (knowledge && knowledge.length) || (images && images.length) || (corr && corr.length) ? 1 : 0,
        ai_correction_count: (corr && corr.length) || 0, ai_ok: 1
      });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) {
      log_ai(req, b, { ai_action: action, ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) });
      err(res, e);
    }
  });

  app.post('/api/ai/triage', require_auth, async function (req, res) {
    const b = req.body || {};
    const t0 = Date.now();
    try {
      const r = await ai.triage_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, faq: await faq.load_knowledge(b.queue) });
      log_ai(req, b, { ai_action: 'triage', ai_intent: r.status || '', ai_verdict: r.status || '', ai_latency_ms: Date.now() - t0, ai_ok: 1 });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) {
      log_ai(req, b, { ai_action: 'triage', ai_latency_ms: Date.now() - t0, ai_ok: 0, ai_error: ((e && e.message) || 'error').slice(0, 60) });
      err(res, e);
    }
  });
  app.get('/api/corrections', require_auth, function (req, res) { res.json({ ok: true, corrections: corrections.list(false) }); });
  app.post('/api/corrections', require_auth, function (req, res) {
    const b = req.body || {};
    const r = corrections.add({ note: b.note, scope: b.scope, queue: b.queue, case_id: b.caseId, question: b.question, author: req.user });
    res.json({ ok: !!r, correction: r });
  });

  app.get('/api/context', require_auth, async function (req, res) {
    try { const q = req.query.queue || ''; const knowledge = await faq.load_knowledge(q); res.json({ ok: true, files: await faq.list_context_meta(q), dir: await faq.context_dir(), knowledge_chars: knowledge.length, corrections: corrections.list(true).length }); } catch (e) { err(res, e); }
  });
  app.post('/api/context', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      const buf = Buffer.from(String(b.content_base64 || ''), 'base64');
      if (!buf.length) throw new Error('empty file');
      if (buf.length > 25 * 1024 * 1024) throw new Error('file too large (25 MB max)');
      const saved = await faq.save_context_file(b.scope, b.queue, b.name, buf, b.folder);
      res.json({ ok: true, saved: saved });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'upload failed' }); }
  });

  app.get('/api/context/raw', require_auth, async function (req, res) {
    try {
      const fsx = require('fs'); const pathx = require('path');
      const p = await faq.find_context_path(req.query.queue, req.query.name);
      const ext = pathx.extname(p).toLowerCase().replace('.', '');
      const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
        txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8', tsv: 'text/tab-separated-values; charset=utf-8',
        json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="' + pathx.basename(p).replace(/[\r\n"]/g, '') + '"');
      res.send(fsx.readFileSync(p));
    } catch (e) { res.status(404).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.post('/api/context-exclude', require_auth, function (req, res) {
    try { const b = req.body || {}; faq.set_context_excluded(b.key, !!b.excluded); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.get('/api/context/file', require_auth, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await faq.read_context_file(req.query.scope, req.query.queue, req.query.name))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- /admin: queue allow-list management (admin only) ----
  // GET returns every Salesforce queue + the current allow-list + the app's named users, so the
  // admin page can render checkboxes for the global default and per-user overrides.
  app.get('/api/admin/queue-access', require_admin, async function (req, res) {
    try {
      const c = await get_conn();
      const queues = await sf.list_queues(c, { with_open_counts: false });
      res.json({ ok: true, queues: queues, access: queue_access.get(), users: store.list_users().map(function (u) { return u.user; }) });
    } catch (e) { err(res, e); }
  });
  // POST sets the global default and/or a per-user override.
  //   { default: "all" | [queueId...] }                  -> set global default
  //   { user: "<name>", queues: "all" | [queueId...] }   -> set a per-user override
  //   { user: "<name>", clear: true }                     -> remove a per-user override
  app.post('/api/admin/queue-access', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      if (b.default !== undefined) queue_access.set_default(b.default);
      if (b.user && b.clear) queue_access.clear_user(b.user);
      else if (b.user && b.queues !== undefined) queue_access.set_user(b.user, b.queues);
      res.json({ ok: true, access: queue_access.get() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // ---- /admin: user management (Access pane, admin only) ----
  // GET returns .env recovery accounts (non-removable) + stored users, each with role.
  app.get('/api/admin/users', require_admin, function (req, res) {
    try {
      const env = store.env_accounts().map(function (u) { return { user: u.user, role: u.role, source: 'env', removable: false }; });
      const stored = store.list_users().map(function (u) { return { user: u.user, role: u.role || 'user', sf_email: u.sf_email || '', source: 'stored', removable: true }; });
      res.json({ ok: true, users: env.concat(stored) });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  // POST add/update a stored user: { user, pass, role: 'admin'|'user', sf_email? }. Also used for reset (same user + new pass).
  app.post('/api/admin/users', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      const user = String(b.user || '').trim();
      const pass = String(b.pass || '');
      if (!user) return res.status(400).json({ ok: false, error: 'username required' });
      if (pass.length < 4) return res.status(400).json({ ok: false, error: 'password must be at least 4 characters' });
      const role = b.role === 'admin' ? 'admin' : 'user';
      const r = store.add_user(user, pass, b.sf_email != null ? String(b.sf_email) : null, role);
      res.json({ ok: true, user: r.user, role: r.role });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  // POST remove a stored user: { user }. .env accounts can't be removed.
  app.post('/api/admin/users/remove', require_admin, function (req, res) {
    try {
      const user = String((req.body && req.body.user) || '').trim();
      if (!user) return res.status(400).json({ ok: false, error: 'username required' });
      const isEnv = store.env_accounts().some(function (u) { return u.user === user; });
      if (isEnv) return res.status(400).json({ ok: false, error: 'cannot remove a .env recovery account' });
      const removed = store.remove_user(user);
      // also drop any per-user queue override so we don't leave orphaned access entries
      try { queue_access.clear_user(user); } catch (e) { /* ignore */ }
      res.json({ ok: removed, error: removed ? null : 'no such user' });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });

  // Salesforce writes are intentionally disabled in this POC.
  app.post('/api/send', require_auth, function (req, res) { res.status(403).json({ ok: false, error: 'Sending to Salesforce is not enabled in this build.' }); });
}
module.exports = mount;
