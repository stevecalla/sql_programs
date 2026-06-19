'use strict';
// Local user store: scrypt-hashed passwords (per-user salt, timing-safe compare), persisted to a
// gitignored JSON. A generated session_secret signs cookies. An optional .env recovery account
// (EQ_RECOVERY_USER / EQ_RECOVERY_PASS) is always valid so you can't lock yourself out.
// Pattern mirrors race_results_transform/admin/admin_store.js. File override: EQ_USERS_FILE (tests).
// Each user may carry an optional sf_email for FUTURE per-user Salesforce identity (unused now).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = process.env.EQ_USERS_FILE || path.join(__dirname, '..', 'data', 'auth.json');

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
  const ru = process.env.EQ_RECOVERY_USER, rp = process.env.EQ_RECOVERY_PASS;
  if (ru && rp && user === ru && String(pass) === String(rp)) return { user: user, recovery: true };
  const u = read().users.filter(function (x) { return x.user === user; })[0];
  if (u && verify_password(pass, u.hash)) return { user: u.user, sf_email: u.sf_email || '' };
  return null;
}

module.exports = { hash_password, verify_password, session_secret, list_users, add_user, remove_user, valid_user, load_or_init };
