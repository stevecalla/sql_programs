'use strict';
// JSON API for the usat_apps platform. Platform-level routes (auth, current user, usage metrics,
// admin/access) live here; feature routes are mounted by each module via the registry.
//   GET  /api/status              public health check
//   POST /api/login               { username, password } -> sets signed-cookie session
//   POST /api/logout              clears the session
//   GET  /api/me                  current user + role + panels (401 if not signed in)
//   GET  /api/modules             signed-in; the module catalog the front-end builds its nav from
//   POST /api/event               auth-gated; fire-and-forget usage analytics (204)
//   GET  /api/metrics-report      panel 'metrics'; recent usage counts
//   POST /api/metrics-ask*        panel 'metrics'; ask-your-data (degrades without an AI key)
//   GET/POST /api/admin/*         admin; users + panel access
//   (module routes: /api/<id>/*  mounted by modules/registry.mount_all)
const session = require('../auth/session');
const store = require('../auth/auth_store');
const panel_access = require('../access/panel_access');
const { require_auth, require_admin, require_panel } = require('../auth/require_auth');
const analytics = require('../metrics/events');
const metrics_report = require('../metrics/metrics_report');
const ask = require('../metrics/ask');
const registry = require('../modules/registry');
const db = require('../store/db');

module.exports = function mount(app) {
  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'usat_apps', login_configured: store.login_configured(), time: new Date().toISOString() });
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

  // The module catalog for the signed-in user: every module + the panels they can see. The front-end
  // builds its nav/switcher from this, so adding a module surfaces it automatically.
  app.get('/api/modules', require_auth, function (req, res) {
    const allowed = panel_access.effective_panels(req.user, req.role);
    const mods = registry.list().map(function (m) {
      return {
        id: m.id, label: m.label,
        panels: (m.panels || []).map(function (p) { return { key: p.key, label: p.label }; }),
        // visible if admin or the user has at least one of the module's panels
        visible: req.role === 'admin' || (m.panels || []).some(function (p) { return allowed.indexOf(p.key) >= 0; }),
      };
    });
    res.json({ ok: true, modules: mods, role: req.role });
  });

  // ---- Usage analytics ----
  app.post('/api/event', require_auth, function (req, res) {
    analytics.ingest_http(req, req.user, req.role).finally(function () { try { res.status(204).end(); } catch (e) { /* gone */ } });
  });
  app.get('/api/metrics-report', require_panel('metrics'), async function (req, res) {
    try {
      const pool = await db.get_pool();
      await analytics.ensure(pool);
      const days = Number(req.query.days) || 7;
      const panel = req.query.panel ? String(req.query.panel) : null;
      const include_test = String(req.query.test || '') === '1';
      const report = await metrics_report.build_report(pool, { days, panel, include_test });
      res.json({ ok: true, report });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-purge-test', require_admin, async function (req, res) {
    try {
      const pool = await db.get_pool();
      await analytics.ensure(pool);
      res.json({ ok: true, ...(await metrics_report.purge_test(pool)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
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

  // ---- Admin: user management + panel access (admin-gated) ----
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

  // ---- Feature modules mount their own /api/<id>/* routes ----
  registry.mount_all(app);
};
