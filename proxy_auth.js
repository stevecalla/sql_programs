'use strict';
// proxy_auth.js — cookie-session auth for the proxy console (/admin, /api/logs,
// /api/pm2). HMAC signed cookie + .env admin account + a generated session secret.
//   .env: PROXY_ADMIN_USER / PROXY_ADMIN_PASS   (optional: PROXY_SESSION_SECRET)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'usat_proxy_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SECRET_FILE = path.join(__dirname, '.proxy_auth.json');

function session_secret() {
  if (process.env.PROXY_SESSION_SECRET) return process.env.PROXY_SESSION_SECRET;
  try { const o = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')); if (o && o.session_secret) return o.session_secret; } catch (e) {}
  const secret = crypto.randomBytes(32).toString('base64');
  try { fs.writeFileSync(SECRET_FILE, JSON.stringify({ session_secret: secret }, null, 2) + '\n', { mode: 0o600 }); } catch (e) {}
  return secret;
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', session_secret()).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const i = token.indexOf('.'); const body = token.slice(0, i); const mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', session_secret()).update(body).digest('base64url');
  if (mac.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || !p.ts || (Date.now() - p.ts) > MAX_AGE_MS) return null;
  return p;
}
function parse_cookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function (p) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function valid_login(user, pass) {
  const u = process.env.PROXY_ADMIN_USER, pw = process.env.PROXY_ADMIN_PASS;
  if (!u || !pw) return null;
  if (String(user) === String(u) && String(pass) === String(pw)) return { user: String(u), role: 'admin' };
  return null;
}
function current_user(req) { const p = verify(parse_cookies(req.headers.cookie)[COOKIE]); return p ? p.user : null; }
function make_cookie(user) { return COOKIE + '=' + sign({ user: user, role: 'admin', ts: Date.now() }) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(MAX_AGE_MS / 1000); }
function clear_cookie() { return COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'; }
function require_auth(req, res, next) { if (current_user(req)) return next(); return res.status(401).json({ ok: false, error: 'authentication required' }); }
function require_auth_page(req, res, next) { if (current_user(req)) return next(); return res.redirect('/admin/login'); }

module.exports = { COOKIE, MAX_AGE_MS, valid_login, current_user, make_cookie, clear_cookie, require_auth, require_auth_page };
