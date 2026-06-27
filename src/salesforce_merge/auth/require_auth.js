'use strict';
// Express middleware gating routes by the signed session cookie. Mirrors the email-queue's
// require_auth. require_auth = any valid session; require_admin = session with role 'admin'.
const store = require('./auth_store');
const session = require('./session');

function payload(req) {
  const cookies = session.parse_cookies(req.headers.cookie);
  return session.verify(cookies[session.COOKIE], store.session_secret());
}

function require_auth(req, res, next) {
  const p = payload(req);
  if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
  req.user = p.user;
  req.role = p.role || 'user';
  next();
}

function require_admin(req, res, next) {
  const p = payload(req);
  if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
  if ((p.role || 'user') !== 'admin') return res.status(403).json({ ok: false, error: 'admin access required' });
  req.user = p.user;
  req.role = p.role;
  next();
}

module.exports = { require_auth, require_admin, payload };
