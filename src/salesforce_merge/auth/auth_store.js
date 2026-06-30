'use strict';
// Local user store for the merge tool: scrypt-hashed passwords (per-user salt, timing-safe compare),
// persisted to a gitignored JSON OUTSIDE the repo. A generated session_secret signs cookies.
// Ported from src/salesforce_email_queue_proof_of_concept/auth/auth_store.js.
//
// .env recovery accounts are ALWAYS valid (so you can't lock yourself out) and carry a role:
//   MERGE_ADMIN_USER / MERGE_ADMIN_PASS  -> role 'admin'
//   MERGE_TEST_USER  / MERGE_TEST_PASS   -> role 'admin'
//
// Stored users live in <determineOSPath()>/usat_salesforce_merge/auth.json (override MERGE_USERS_FILE).
// Each user carries a role ('admin' | 'user'); panel access is managed separately (panel_access.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const data_dir = require('../data_dir');
const FILE = process.env.MERGE_USERS_FILE || data_dir.file_sync('auth.json');

function hash_password(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw == null ? '' : pw), salt, 32);
  return 'scrypt$' + salt.toString('base64') + '$' + h.toString('base64');
}
function verify_password(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const p = stored.split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const salt = Buffer.from(p[1], 'base64'); const exp = Buffer.from(p[2], 'base64');
  let act; try { act = crypto.scryptSync(String(pw == null ? '' : pw), salt, exp.length); } catch (e) { return false; }
  return act.length === exp.length && crypto.timingSafeEqual(act, exp);
}

function ensure(o) { o = o || {}; if (!o.session_secret) o.session_secret = crypto.randomBytes(32).toString('base64'); if (!Array.isArray(o.users)) o.users = []; return o; }
function read() { try { return ensure(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { return ensure({}); } }
function write(o) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(ensure(o), null, 2) + '\n', { mode: 0o600 }); }
function load_or_init() { const had = fs.existsSync(FILE); const o = read(); if (!had) write(o); return o; }

// Cookie-signing secret: MERGE_SESSION_SECRET if set, else the one persisted in auth.json.
function session_secret() { return process.env.MERGE_SESSION_SECRET || load_or_init().session_secret; }
function list_users() { return read().users.map(function (u) { return { user: u.user, role: u.role || 'user' }; }); }
// .env accounts surfaced for the /admin Access pane (recovery accounts — always valid, never removable).
function env_accounts() {
  const out = [];
  if (process.env.MERGE_ADMIN_USER) out.push({ user: process.env.MERGE_ADMIN_USER, role: 'admin', source: 'env' });
  if (process.env.MERGE_TEST_USER) out.push({ user: process.env.MERGE_TEST_USER, role: 'admin', source: 'env' });
  return out;
}
// role is optional; defaults to 'user'. add_user(user, pass[, role]) — updates password/role if the user exists.
function add_user(user, pass, role) {
  const o = read();
  const ex = o.users.filter(function (u) { return u.user === user; })[0];
  const hash = hash_password(pass);
  const r = (role === 'admin' || role === 'user') ? role : null;
  if (ex) { ex.hash = hash; if (r) ex.role = r; }
  else o.users.push({ user: String(user), hash: hash, role: r || 'user' });
  write(o); return { user: user, role: r || (ex && ex.role) || 'user' };
}
function remove_user(user) { const o = read(); const n = o.users.length; o.users = o.users.filter(function (u) { return u.user !== user; }); write(o); return o.users.length < n; }
function valid_user(user, pass) {
  if (!user) return null;
  const p = String(pass == null ? '' : pass);
  // .env recovery accounts (always valid; both carry role 'admin').
  const env_list = [
    { u: process.env.MERGE_ADMIN_USER, p: process.env.MERGE_ADMIN_PASS, role: 'admin' },
    { u: process.env.MERGE_TEST_USER, p: process.env.MERGE_TEST_PASS, role: 'admin' }
  ];
  for (let i = 0; i < env_list.length; i++) {
    const a = env_list[i];
    if (a.u && a.p && user === a.u && p === String(a.p)) return { user: user, env: true, role: a.role };
  }
  const u = read().users.filter(function (x) { return x.user === user; })[0];
  if (u && verify_password(pass, u.hash)) return { user: u.user, role: u.role || 'user' };
  return null;
}
function login_configured() {
  return !!(process.env.MERGE_ADMIN_USER && process.env.MERGE_ADMIN_PASS) ||
    !!(process.env.MERGE_TEST_USER && process.env.MERGE_TEST_PASS) ||
    read().users.length > 0;
}

module.exports = { hash_password, verify_password, session_secret, list_users, env_accounts, add_user, remove_user, valid_user, login_configured, load_or_init };
