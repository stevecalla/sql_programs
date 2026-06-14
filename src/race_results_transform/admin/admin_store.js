'use strict';
// Admin overrides store: editable config + users/passwords for the two logins, layered OVER the .env creds.
// Persisted to a gitignored JSON file. Passwords are scrypt-hashed (never stored plaintext). The .env creds
// remain an always-on recovery account, so the UI can never lock you out. Node-only; injectable file path so
// it's unit-testable with a temp file (no network, no DB).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_KEYS = ['slack_default_channel', 'slack_hidden_channels', 'slack_bot_handle', 'slack_file_types', 'sf_program_object', 'ngrok_enabled'];

function scope_key(scope) { return scope === 'app' ? 'app_users' : 'admin_users'; }

// ----- password hashing (scrypt + per-user random salt) -----
function hash_password(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw == null ? '' : pw), salt, 32);
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function verify_password(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  let actual;
  try { actual = crypto.scryptSync(String(pw == null ? '' : pw), salt, expected.length); } catch (e) { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ----- the overrides object -----
function ensure_shape(o) {
  o = o || {};
  if (!o.session_secret) o.session_secret = crypto.randomBytes(32).toString('base64');
  if (!o.config || typeof o.config !== 'object') o.config = {};
  if (!Array.isArray(o.admin_users)) o.admin_users = [];
  if (!Array.isArray(o.app_users)) o.app_users = [];
  return o;
}
function empty_overrides() { return ensure_shape({}); }

function read_overrides(file) {
  try { return ensure_shape(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { return empty_overrides(); }
}
function write_overrides(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ensure_shape(obj), null, 2) + '\n', { mode: 0o600 });
}
// Read, ensure a session_secret exists, persist if it had to be created, and return the object.
function load_or_init(file) {
  const had = fs.existsSync(file);
  const obj = read_overrides(file);
  if (!had) write_overrides(file, obj);   // first run → persist the generated session_secret
  return obj;
}

// ----- users -----
function list_users(obj, scope) {
  return (((obj || {})[scope_key(scope)]) || []).map(function (u) { return u.user; });
}
function find_user(obj, scope, user) {
  return (((obj || {})[scope_key(scope)]) || []).filter(function (u) { return u.user === user; })[0] || null;
}
// Per-user capabilities (which areas a user may reach). 'admin' = the /admin hub, 'metrics' = the /metrics
// dashboard, 'intake' = the converter Salesforce/Slack/Folder intake.
const ALL_CAPS = ['admin', 'metrics', 'intake'];
function default_caps(scope) { return scope === 'app' ? ['intake'] : ['admin', 'metrics', 'intake']; }
function clean_caps(caps, scope) {
  const c = (Array.isArray(caps) ? caps : []).filter(function (x) { return ALL_CAPS.indexOf(x) >= 0; });
  return c.length ? c : default_caps(scope);
}
function record_caps(rec, scope) { return (rec && Array.isArray(rec.caps) && rec.caps.length) ? rec.caps : default_caps(scope); }
function add_user(obj, scope, user, pass, caps) {
  obj = ensure_shape(obj);
  const key = scope_key(scope);
  const existing = obj[key].filter(function (u) { return u.user === user; })[0];
  const hash = hash_password(pass);
  const c = clean_caps(caps, scope);
  if (existing) { existing.hash = hash; existing.caps = c; } else obj[key].push({ user: String(user), hash: hash, caps: c });
  return obj;
}
// Caps for a stored user (searches both lists). Returns [] if there is no such stored user.
function user_caps(obj, user) {
  obj = ensure_shape(obj);
  const a = obj.admin_users.filter(function (u) { return u.user === user; })[0]; if (a) return record_caps(a, 'admin');
  const p = obj.app_users.filter(function (u) { return u.user === user; })[0]; if (p) return record_caps(p, 'app');
  return [];
}
// Validate a username/password against any stored user (either list); returns { user, caps } or null.
function valid_user(obj, user, pass) {
  obj = ensure_shape(obj);
  if (!user) return null;
  const a = obj.admin_users.filter(function (u) { return u.user === user; })[0]; if (a && verify_password(pass, a.hash)) return { user: a.user, caps: record_caps(a, 'admin') };
  const p = obj.app_users.filter(function (u) { return u.user === user; })[0]; if (p && verify_password(pass, p.hash)) return { user: p.user, caps: record_caps(p, 'app') };
  return null;
}
function list_users_with_caps(obj, scope) {
  return (((obj || {})[scope_key(scope)]) || []).map(function (u) { return { user: u.user, caps: record_caps(u, scope) }; });
}
function remove_user(obj, scope, user, env_user) {
  obj = ensure_shape(obj);
  if (env_user && user === env_user) return { ok: false, error: 'Cannot remove the .env recovery account.' };
  const key = scope_key(scope);
  const before = obj[key].length;
  obj[key] = obj[key].filter(function (u) { return u.user !== user; });
  return { ok: obj[key].length < before, error: obj[key].length < before ? null : 'No such user.' };
}
// Validate a login against the .env recovery account OR any stored user for that scope.
function valid_login(obj, scope, user, pass, env_user, env_pass) {
  if (!user) return false;
  if (env_user && env_pass && user === env_user && String(pass) === String(env_pass)) return true;
  const list = ((obj || {})[scope_key(scope)]) || [];
  for (let i = 0; i < list.length; i++) { if (list[i].user === user && verify_password(pass, list[i].hash)) return true; }
  return false;
}

// ----- non-secret config -----
function get_config(obj) {
  const c = ((obj || {}).config) || {};
  const out = {};
  CONFIG_KEYS.forEach(function (k) { out[k] = c[k] || ''; });
  return out;
}
function set_config(obj, values) {
  obj = ensure_shape(obj);
  values = values || {};
  CONFIG_KEYS.forEach(function (k) { if (values[k] != null) obj.config[k] = String(values[k]); });
  return obj;
}

module.exports = {
  CONFIG_KEYS, scope_key, ALL_CAPS, default_caps,
  hash_password, verify_password,
  empty_overrides, ensure_shape, read_overrides, write_overrides, load_or_init,
  list_users, list_users_with_caps, find_user, add_user, remove_user, valid_login,
  user_caps, valid_user,
  get_config, set_config
};
