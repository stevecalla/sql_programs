'use strict';
// JSON API for the merge tool (Phase 0 — read-only).
//   GET  /api/status     public health check
//   POST /api/login      { username, password } -> sets signed-cookie session
//   POST /api/logout     clears the session
//   GET  /api/me         current user (401 if not signed in)
//   GET  /api/dashboard  auth-gated; read-only counts from the existing duplicate tables
const session = require('../auth/session');
const store = require('../auth/auth_store');
const { require_auth } = require('../auth/require_auth');
const dashboard = require('../store/duplicates_read');

module.exports = function mount(app) {
  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'salesforce_merge', login_configured: store.login_configured(), time: new Date().toISOString() });
  });

  app.post('/api/login', function (req, res) {
    const body = req.body || {};
    const v = store.valid_user(body.username, body.password);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const token = session.sign({ user: v.user, role: v.role, ts: Date.now() }, store.session_secret());
    res.setHeader('Set-Cookie', session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000));
    res.json({ ok: true, user: v.user, role: v.role });
  });

  app.post('/api/logout', function (req, res) {
    res.setHeader('Set-Cookie', session.COOKIE + '=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', function (req, res) {
    const cookies = session.parse_cookies(req.headers.cookie);
    const p = session.verify(cookies[session.COOKIE], store.session_secret());
    if (!p) return res.status(401).json({ ok: false });
    res.json({ ok: true, user: p.user, role: p.role || 'user' });
  });

  app.get('/api/dashboard', require_auth, async function (req, res) {
    try {
      res.json({ ok: true, data: await dashboard.dashboard_counts() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
