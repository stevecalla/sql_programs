'use strict';
// Minimal credential + session-secret store for the merge tool (Phase 0).
// Admin login comes from .env (MERGE_ADMIN_USER / MERGE_ADMIN_PASS), mirroring the proxy/
// email-queue pattern. The cookie-signing secret is MERGE_SESSION_SECRET if set, else generated
// once and persisted to a gitignored file beside this module (same scheme as proxy_auth.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_FILE = path.join(__dirname, '.merge_session_secret.json'); // gitignored

function session_secret() {
  if (process.env.MERGE_SESSION_SECRET) return process.env.MERGE_SESSION_SECRET;
  try { const o = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')); if (o && o.secret) return o.secret; } catch (e) { /* generate below */ }
  const secret = crypto.randomBytes(32).toString('base64');
  try { fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret: secret }, null, 2) + '\n', { mode: 0o600 }); } catch (e) { /* ignore */ }
  return secret;
}

// .env admin account is always valid (can't lock yourself out). Returns {user, role} or null.
function valid_user(user, pass) {
  const U = process.env.MERGE_ADMIN_USER;
  const P = process.env.MERGE_ADMIN_PASS;
  if (U && P && user === U && String(pass == null ? '' : pass) === String(P)) {
    return { user: user, role: 'admin' };
  }
  return null;
}

function login_configured() {
  return !!(process.env.MERGE_ADMIN_USER && process.env.MERGE_ADMIN_PASS);
}

module.exports = { session_secret, valid_user, login_configured };
