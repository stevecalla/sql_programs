'use strict';
// Express middleware gating routes by the signed session cookie.
//   require_auth        — any valid session (the app/intake surface).
//   require_admin       — valid session AND role 'admin' (JSON 401/403; for /api/* XHR).
//   require_admin_page  — same, but redirects browsers to the app login (for full-page routes
//                         like /metrics and /admin) instead of returning JSON.
// Admin gating reuses the POC's existing session + role (no second cookie) — consistent with how
// 8019 already authenticates. See plans_and_notes/path_to_production.md.
const store = require('./auth_store');
const session = require('./session');

function _payload(req) {
  const cookies = session.parse_cookies(req.headers.cookie);
  return session.verify(cookies[session.COOKIE], store.session_secret());
}

function require_auth(req, res, next) {
  const p = _payload(req);
  if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
  req.user = p.user;
  req.role = p.role || 'user';
  next();
}

function require_admin(req, res, next) {
  const p = _payload(req);
  if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
  if ((p.role || 'user') !== 'admin') return res.status(403).json({ ok: false, error: 'admin access required' });
  req.user = p.user;
  req.role = p.role;
  next();
}

function require_admin_page(req, res, next) {
  const p = _payload(req);
  if (p && (p.role || 'user') === 'admin') { req.user = p.user; req.role = p.role; return next(); }
  // Bounce to the area's own sign-in page (transform-style /metrics/login or /admin/login), preserving
  // ?metrics_test=1 so an admin testing the system stays in test mode through login.
  const orig = req.originalUrl || '/';
  const area = orig.indexOf('/admin') === 0 ? '/admin' : '/metrics';
  const keep_test = /[?&]metrics_test=1\b/.test(orig) ? '?metrics_test=1' : '';
  return res.redirect(area + '/login' + keep_test);
}

module.exports = { require_auth, require_admin, require_admin_page };
