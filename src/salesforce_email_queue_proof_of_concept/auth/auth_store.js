'use strict';
// Local user store: scrypt-hashed passwords (per-user salt, timing-safe compare), persisted to a
// gitignored JSON. A generated session_secret signs cookies. Optional .env accounts are always
// valid so you can't lock yourself out, and carry a role for future access differentiation:
//   SF_EMAIL_QUEUE_ADMIN_USER / SF_EMAIL_QUEUE_ADMIN_PASS  -> role 'admin'
//   SF_EMAIL_QUEUE_USER       / SF_EMAIL_QUEUE_PASS        -> role 'user'
// Pattern mirrors race_results_transform/admin/admin_store.js. File override: EQ_USERS_FILE (tests).
// Each user may carry an optional sf_email for FUTURE per-user Salesforce identity (unused now).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const data_dir = require('../data_dir');
// Users file lives OUTSIDE the repo (no auth info committed): <determineOSPath()>/usat_email_queue/auth.json
// Override with EQ_USERS_FILE.
const FILE = process.env.EQ_USERS_FILE || data_dir.file_sync('auth.json');

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

function session_secret() { return load_or_init().session_secret; }
function list_users() { return read().users.map(function (u) { return { user: u.user, sf_email: u.sf_email || '' }; }); }
function add_user(user, pass, sf_email) {
  const o = read();
  const ex = o.users.filter(function (u) { return u.user === user; })[0];
  const hash = hash_password(pass);
  if (ex) { ex.hash = hash; if (sf_email != null) ex.sf_email = sf_email; }
  else o.users.push({ user: String(user), hash: hash, sf_email: sf_email || '' });
  write(o); return { user: user };
}
function remove_user(user) { const o = read(); const n = o.users.length; o.users = o.users.filter(function (u) { return u.user !== user; }); write(o); return o.users.length < n; }
function valid_user(user, pass) {
  if (!user) return null;
  const p = String(pass == null ? '' : pass);
  // .env accounts (always valid; carry a role for future access differentiation).
  const env_accounts = [
    { u: process.env.SF_EMAIL_QUEUE_ADMIN_USER, p: process.env.SF_EMAIL_QUEUE_ADMIN_PASS, role: 'admin' },
    { u: process.env.SF_EMAIL_QUEUE_USER, p: process.env.SF_EMAIL_QUEUE_PASS, role: 'user' }
  ];
  for (let i = 0; i < env_accounts.length; i++) {
    const a = env_accounts[i];
    if (a.u && a.p && user === a.u && p === String(a.p)) return { user: user, env: true, role: a.role };
  }
  const u = read().users.filter(function (x) { return x.user === user; })[0];
  if (u && verify_password(pass, u.hash)) return { user: u.user, sf_email: u.sf_email || '', role: u.role || 'user' };
  return null;
}

module.exports = { hash_password, verify_password, session_secret, list_users, add_user, remove_user, valid_user, load_or_init };
