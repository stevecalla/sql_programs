'use strict';
// Signed-cookie sessions (HMAC-SHA256 over a small JSON payload). No external session library.
// Copied verbatim from src/salesforce_merge/auth/session.js; own cookie name so the two apps
// keep independent logins (matches the codebase's per-app auth convention).
const crypto = require('crypto');
const COOKIE = 'reporting_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token, secret) {
  if (!token || token.indexOf('.') < 0) return null;
  const i = token.indexOf('.'); const body = token.slice(0, i); const mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
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
module.exports = { COOKIE, MAX_AGE_MS, sign, verify, parse_cookies };
