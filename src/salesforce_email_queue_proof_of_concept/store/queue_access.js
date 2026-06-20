'use strict';
// Queue allow-list: which Salesforce queues are available, in general and per specific user.
// Set/managed from /admin. Persisted OUTSIDE the repo (no config committed):
//   <determineOSPath()>/usat_email_queue/queue_access.json   (override: EQ_QUEUE_ACCESS_FILE for tests)
//
// Shape:
//   { default: "all" | [queueId...],            // global default for users with no explicit override
//     users:   { "<username>": "all" | [queueId...] } }
//
// Semantics:
//   - admins always see ALL queues (the allow-list governs non-admins / the per-user view).
//   - a user with an explicit entry uses it; otherwise the global default applies.
//   - "all" (string) means no restriction. An array is the explicit set of allowed Group (queue) ids.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');
const FILE = process.env.EQ_QUEUE_ACCESS_FILE || data_dir.file_sync('queue_access.json');

let _cfg = null;
function load() {
  if (_cfg) return _cfg;
  try {
    const o = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _cfg = normalize(o);
  } catch (e) { _cfg = { default: 'all', users: {} }; }
  return _cfg;
}
function normalize(o) {
  o = o || {};
  const def = (o.default === 'all' || o.default == null) ? 'all' : (Array.isArray(o.default) ? o.default.map(String) : 'all');
  const users = {};
  const src = (o.users && typeof o.users === 'object') ? o.users : {};
  Object.keys(src).forEach(function (u) {
    const v = src[u];
    users[u] = (v === 'all') ? 'all' : (Array.isArray(v) ? v.map(String) : (Array.isArray(v && v.queues) ? v.queues.map(String) : 'all'));
  });
  return { default: def, users: users };
}
function save() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(load(), null, 2) + '\n', { mode: 0o600 }); }
  catch (e) { /* ignore */ }
}

function get() { return load(); }
function set_default(mode) { const c = load(); c.default = (mode === 'all') ? 'all' : (Array.isArray(mode) ? mode.map(String) : 'all'); save(); return c; }
function set_user(user, queues) {
  const c = load(); if (!user) return c;
  c.users[String(user)] = (queues === 'all') ? 'all' : (Array.isArray(queues) ? queues.map(String) : 'all');
  save(); return c;
}
function clear_user(user) { const c = load(); delete c.users[String(user)]; save(); return c; }

// The effective allow-list for a user: 'all' or an array of allowed queue ids.
// role 'admin' is always unrestricted.
function allowed_for(user, role) {
  if (role === 'admin') return 'all';
  const c = load();
  const u = c.users[String(user)];
  if (u !== undefined) return u;
  return c.default;
}
function is_allowed(user, role, queue_id) {
  const a = allowed_for(user, role);
  if (a === 'all') return true;
  return a.indexOf(String(queue_id)) >= 0;
}
// Filter a list of {id,...} queues to those the user may see.
function filter_queues(list, user, role) {
  const a = allowed_for(user, role);
  if (a === 'all') return list || [];
  const set = {}; a.forEach(function (id) { set[String(id)] = true; });
  return (list || []).filter(function (qq) { return set[String(qq.id)]; });
}
function _reset() { _cfg = null; }

module.exports = { get, set_default, set_user, clear_user, allowed_for, is_allowed, filter_queues, _reset, FILE: FILE };
