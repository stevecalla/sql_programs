'use strict';
// JSON API for the reporting app (Phase 0/1 — read-only).
//   GET  /api/status              public health check
//   POST /api/login               { username, password } -> sets signed-cookie session
//   POST /api/logout              clears the session
//   GET  /api/me                  current user + panels (401 if not signed in)
//   POST /api/event               auth-gated; fire-and-forget usage analytics (204)
//   GET  /api/metrics-report      panel 'metrics'; recent usage counts
//   GET  /api/bootstrap           panel 'participation-maps'; the participation-maps data payload
//   GET  /api/admin/users         admin; list env + stored users
//   POST /api/admin/users         admin; add/update a stored user
//   POST /api/admin/users/remove  admin; remove a stored user
//   GET  /api/admin/panel-access  admin; panel catalog + allow-list
//   POST /api/admin/panel-access  admin; set default / per-user access
const session = require('../auth/session');
const store = require('../auth/auth_store');
const panel_access = require('../auth/panel_access');
const { require_auth, require_admin, require_panel } = require('../auth/require_auth');
const analytics = require('../metrics/events');
const metrics_report = require('../metrics/metrics_report');
const ask = require('../metrics/ask');
const participation = require('../store/participation_read');
const db = require('../store/db');
const fs = require('fs');
const path = require('path');
const DASH_TMPL = path.join(__dirname, '..', 'store', 'participation_dashboard.tmpl.html');

module.exports = function mount(app) {
  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'reporting', login_configured: store.login_configured(), time: new Date().toISOString() });
  });

  app.post('/api/login', function (req, res) {
    const body = req.body || {};
    const v = store.valid_user(body.username, body.password);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const token = session.sign({ user: v.user, role: v.role, ts: Date.now() }, store.session_secret());
    res.setHeader('Set-Cookie', session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000));
    res.json({ ok: true, user: v.user, role: v.role, panels: panel_access.effective_panels(v.user, v.role) });
  });

  app.post('/api/logout', function (req, res) {
    res.setHeader('Set-Cookie', session.COOKIE + '=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', function (req, res) {
    const cookies = session.parse_cookies(req.headers.cookie);
    const p = session.verify(cookies[session.COOKIE], store.session_secret());
    if (!p) return res.status(401).json({ ok: false });
    res.json({ ok: true, user: p.user, role: p.role || 'user', panels: panel_access.effective_panels(p.user, p.role || 'user') });
  });

  // ---- Usage analytics (mirrors the merge tool's /api/event stack) ----
  app.post('/api/event', require_auth, function (req, res) {
    analytics.ingest_http(req, req.user, req.role).finally(function () { try { res.status(204).end(); } catch (e) { /* gone */ } });
  });
  app.get('/api/metrics-report', require_panel('metrics'), async function (req, res) {
    try {
      const pool = await db.get_pool();
      await analytics.ensure(pool);   // create/migrate the events table if nothing has been logged yet
      const days = Number(req.query.days) || 7;
      const report = await metrics_report.build_report(pool, { days });
      res.json({ ok: true, report });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Purge deliberate test rows (?metrics_test=1). Admin only.
  app.post('/api/metrics-purge-test', require_admin, async function (req, res) {
    try {
      const pool = await db.get_pool();
      await analytics.ensure(pool);
      res.json({ ok: true, ...(await metrics_report.purge_test(pool)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Ask-your-data — NL question -> guarded read-only SELECT over reporting_events (+ NL answer,
  // conversation history, raw-SQL mode, model picker, corrections). Panel-gated; degrades without a key.
  app.get('/api/metrics-ask-models', require_panel('metrics'), function (req, res) {
    try { res.json({ ok: true, ...ask.list_models() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-ask', require_panel('metrics'), async function (req, res) {
    try {
      const b = req.body || {};
      const pool = await db.get_pool();
      res.json(await ask.ask(pool, { question: b.question, model: b.model, history: b.history, mode: b.mode, sql: b.sql }));
    } catch (e) { res.status(e.code === 'NO_AI_KEY' ? 501 : 400).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-ask-correct', require_panel('metrics'), function (req, res) {
    try {
      const b = req.body || {};
      const note = String(b.note || '').trim();
      if (!note) return res.status(400).json({ ok: false, error: 'no correction text' });
      const n = ask.add_correction(note, b.question, b.answer, req.user);
      res.json({ ok: true, count: n });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- Participation-maps data ----
  app.get('/api/bootstrap', require_panel('participation-maps'), async function (req, res) {
    try {
      const r = await participation.get_bootstrap({ force: req.query.force === '1' });
      res.json({ ok: true, source: r.source, generated_at: new Date(r.at).toISOString(), data: r.payload });
    } catch (e) {
      res.status(e.code === 'NO_DATA' ? 503 : 500).json({ ok: false, error: e.message, code: e.code || null });
    }
  });

  // Exact unique athletes for a selection (non-additive metric counted live from the base table).
  app.get('/api/unique', require_panel('participation-maps'), async function (req, res) {
    try {
      const q = req.query;
      const sel = {
        years: (q.years || '').split(',').filter(Boolean),
        months: (q.months || 'all').split(',').filter(Boolean),
        region: q.region || null, state: q.state || null, ironman: q.ironman || null,
      };
      const r = await participation.unique_for_selection(sel);
      res.json({ ok: true, national: r.national, byState: r.byState, byRegion: r.byRegion });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // "Data as of" for the header badge: the source + the participation table's own timestamp.
  app.get('/api/dataset', require_panel('participation-maps'), async function (req, res) {
    try {
      const r = await participation.get_bootstrap();
      res.json({ ok: true, source: r.source, generated_at: new Date(r.at).toISOString(),
        last_updated: (r.payload && r.payload.lastUpdated) || null,
        last_updated_utc: (r.payload && r.payload.lastUpdatedUtc) || null });
    } catch (e) {
      res.status(e.code === 'NO_DATA' ? 503 : 500).json({ ok: false, error: e.message, code: e.code || null });
    }
  });

  // The full interactive dashboard (the proven standalone build) with LIVE data injected into the
  // template's __DASH_JSON__ token. The SPA renders this in an iframe. HTML, not JSON.
  app.get('/api/participation-view', require_panel('participation-maps'), async function (req, res) {
    let tmpl;
    try { tmpl = fs.readFileSync(DASH_TMPL, 'utf8'); }
    catch (e) {
      return res.status(500).type('html').send(
        '<p style="font:14px system-ui;padding:24px">Dashboard template missing. Generate it once:<br>' +
        '<code>node src/reporting/store/make_template.js &lt;path-to-standalone-html&gt;</code></p>');
    }
    try {
      const r = await participation.get_bootstrap();
      // split/join (not String.replace) so '$' in the JSON isn't treated as a replacement pattern.
      res.type('html').send(tmpl.split('__DASH_JSON__').join(JSON.stringify(r.payload)));
    } catch (e) {
      res.status(e.code === 'NO_DATA' ? 503 : 500).type('html').send(
        '<p style="font:14px system-ui;padding:24px">No data: ' + e.message + '</p>');
    }
  });

  // ---- Admin: user management + panel access (admin-gated). Mirrors the merge tool. ----
  app.get('/api/admin/users', require_admin, function (req, res) {
    try {
      const env = store.env_accounts().map(function (u) { return { user: u.user, role: u.role, source: 'env', removable: false }; });
      const stored = store.list_users().map(function (u) { return { user: u.user, role: u.role || 'user', source: 'stored', removable: true }; });
      res.json({ ok: true, users: env.concat(stored) });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.post('/api/admin/users', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      const user = String(b.user || '').trim();
      const pass = String(b.pass || '');
      if (!user) return res.status(400).json({ ok: false, error: 'username required' });
      if (pass.length < 4) return res.status(400).json({ ok: false, error: 'password must be at least 4 characters' });
      const role = b.role === 'admin' ? 'admin' : 'user';
      const r = store.add_user(user, pass, role);
      res.json({ ok: true, user: r.user, role: r.role });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.post('/api/admin/users/remove', require_admin, function (req, res) {
    try {
      const user = String((req.body && req.body.user) || '').trim();
      if (!user) return res.status(400).json({ ok: false, error: 'username required' });
      if (store.env_accounts().some(function (u) { return u.user === user; })) {
        return res.status(400).json({ ok: false, error: 'cannot remove a .env recovery account' });
      }
      const removed = store.remove_user(user);
      try { panel_access.clear_user(user); } catch (e) { /* drop any orphaned override */ }
      res.json({ ok: removed, error: removed ? null : 'no such user' });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.get('/api/admin/panel-access', require_admin, function (req, res) {
    try {
      const users = store.env_accounts().map(function (u) { return u.user; })
        .concat(store.list_users().map(function (u) { return u.user; }));
      res.json({ ok: true, panels: panel_access.catalog(), access: panel_access.get(), users: users });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
  app.post('/api/admin/panel-access', require_admin, function (req, res) {
    try {
      const b = req.body || {};
      if (b.default !== undefined) panel_access.set_default(b.default);
      if (b.user && b.clear) panel_access.clear_user(b.user);
      else if (b.user && b.panels !== undefined) panel_access.set_user(b.user, b.panels);
      res.json({ ok: true, access: panel_access.get() });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
  });
};
