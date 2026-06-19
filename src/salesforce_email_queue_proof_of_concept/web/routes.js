'use strict';
// JSON API for the web app. Login/logout are public; everything else is gated by require_auth.
// The Salesforce connection is cached. Reads + AI reuse the same engine as the CLI. No SF writes.
const sf = require('../sf');
const ai = require('../ai');
const faq = require('../ai/faq');
const corrections = require('../store/corrections');
const store = require('../auth/auth_store');
const session = require('../auth/session');
const { require_auth } = require('../auth/require_auth');

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

function mount(app) {
  app.post('/api/login', function (req, res) {
    const b = req.body || {};
    const v = store.valid_user(b.user, b.pass);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const token = session.sign({ user: v.user, ts: Date.now() }, store.session_secret());
    res.setHeader('Set-Cookie', session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000));
    res.json({ ok: true, user: v.user });
  });
  app.post('/api/logout', function (req, res) { res.setHeader('Set-Cookie', session.COOKIE + '=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.get('/api/me', require_auth, function (req, res) { res.json({ ok: true, user: req.user }); });

  app.get('/api/queues', require_auth, async function (req, res) {
    try { const c = await get_conn(); res.json({ ok: true, queues: await sf.list_queues(c, { with_open_counts: true }), instance_url: c.instanceUrl || '' }); } catch (e) { err(res, e); }
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
    try { res.json(Object.assign({ ok: true }, await sf.status_counts(await get_conn(), req.query.queue))); } catch (e) { err(res, e); }
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
    try {
      const b = req.body || {};
      const r = await ai.respond_to_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, fetch_attachments: true, faq: await faq.load_knowledge(b.queue), corrections: corrections.grounding_lines(12, { queue: b.queue, user: req.user }) });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { err(res, e); }
  });
  app.post('/api/ai/ask', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      const r = await ai.ask_about_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, question: b.question, history: b.history, faq: await faq.load_knowledge(b.queue), corrections: corrections.grounding_lines(12, { queue: b.queue, user: req.user }) });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { err(res, e); }
  });

  app.post('/api/ai/triage', require_auth, async function (req, res) {
    try { const b = req.body || {}; const r = await ai.triage_case({ conn: await get_conn(), case_id: b.caseId, provider: b.provider, faq: await faq.load_knowledge(b.queue) }); res.json(Object.assign({ ok: true }, r)); }
    catch (e) { err(res, e); }
  });
  app.get('/api/corrections', require_auth, function (req, res) { res.json({ ok: true, corrections: corrections.list(false) }); });
  app.post('/api/corrections', require_auth, function (req, res) {
    const b = req.body || {};
    const r = corrections.add({ note: b.note, scope: b.scope, queue: b.queue, case_id: b.caseId, question: b.question, author: req.user });
    res.json({ ok: !!r, correction: r });
  });

  app.get('/api/context', require_auth, function (req, res) {
    try { const q = req.query.queue || ''; res.json({ ok: true, files: faq.list_context_meta(q), dir: faq.CONTEXT_DIR, faq_chars: faq.load_faq(q).length, corrections: corrections.list(true).length }); } catch (e) { err(res, e); }
  });
  app.post('/api/context', require_auth, function (req, res) {
    try {
      const b = req.body || {};
      const buf = Buffer.from(String(b.content_base64 || ''), 'base64');
      if (!buf.length) throw new Error('empty file');
      if (buf.length > 5 * 1024 * 1024) throw new Error('file too large (5 MB max)');
      const saved = faq.save_context_file(b.scope, b.queue, b.name, buf);
      res.json({ ok: true, saved: saved });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'upload failed' }); }
  });

  // Salesforce writes are intentionally disabled in this POC.
  app.post('/api/send', require_auth, function (req, res) { res.status(403).json({ ok: false, error: 'Sending to Salesforce is not enabled in this build.' }); });
}
module.exports = mount;
