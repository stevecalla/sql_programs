'use strict';
// Express middleware gating routes by the signed session cookie. Mirrors the email-queue's
// require_auth. require_auth = any valid session; require_admin = session with role 'admin'.
const store = require('./auth_store');
const session = require('./session');
const panel_access = require('./panel_access');

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

// Gate a route by panel access. Self-contained (verifies the session, then checks the allow-list)
// so it can be used standalone or after require_auth. Admins bypass; the 'admin' panel needs role
// 'admin'. Returns 401 when signed out, 403 when the panel is not permitted.
function require_panel(panel) {
  return function (req, res, next) {
    const p = payload(req);
    if (!p) return res.status(401).json({ ok: false, error: 'authentication required' });
    const role = p.role || 'user';
    if (!panel_access.is_allowed(p.user, role, panel)) {
      return res.status(403).json({ ok: false, error: 'access to this panel is restricted' });
    }
    req.user = p.user;
    req.role = role;
    next();
  };
}

module.exports = { require_auth, require_admin, require_panel, payload };
