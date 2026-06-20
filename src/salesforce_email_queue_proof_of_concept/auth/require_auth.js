'use strict';
// Express middleware gating API routes: requires a valid signed session cookie.
const store = require('./auth_store');
const session = require('./session');
function require_auth(req, res, next) {
  const cookies = session.parse_cookies(req.headers.cookie);
  const p = session.verify(cookies[session.COOKIE], store.session_secret());
  if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
  req.user = p.user;
  req.role = p.role || 'user';
  next();
}
module.exports = { require_auth };
