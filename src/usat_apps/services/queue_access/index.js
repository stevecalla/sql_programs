'use strict';
// Shared queue allow-list — which Salesforce queues are available, in general and per user. Used by BOTH
// the email queue and the AI Chat Bot (promoted out of the email-queue module so neither surface owns it).
// Set/managed from the admin queue-access UI. Persisted OUTSIDE the repo in the shared data dir:
//   <data_dir base>/queue_access.json   (override: KNOWLEDGE_QUEUE_ACCESS_FILE, or legacy EQ_QUEUE_ACCESS_FILE)
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
const data_dir = require('../knowledge/data_dir');
const FILE = process.env.KNOWLEDGE_QUEUE_ACCESS_FILE || process.env.EQ_QUEUE_ACCESS_FILE || data_dir.file_sync('queue_access.json');

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

// Drop per-user overrides for accounts that no longer exist, so this file stays in sync with the
// platform user store (Users & access). `valid` is the current list of usernames. Returns the count
// removed and persists only if something changed. Called when the admin Access page is read.
function prune_users(valid) {
  const c = load();
  const keep = {}; (valid || []).forEach(function (u) { keep[String(u)] = true; });
  let removed = 0;
  Object.keys(c.users).forEach(function (u) { if (!keep[u]) { delete c.users[u]; removed++; } });
  if (removed) save();
  return removed;
}

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
function _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// Access check that accepts EITHER a queue id or a queue NAME. `queues` is a [{id,name}] list (e.g. the
// cached SF queue list) used to resolve a name -> id. Admins always pass; an empty or unresolvable value is
// denied (fail closed). This lets the id-based email queue and the name-based chatbot share one check.
function is_allowed_queue(user, role, value, queues) {
  if ((role || 'user') === 'admin') return true;
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  const list = queues || [];
  let q = list.find(function (x) { return String(x.id) === v; });
  if (!q) { const n = _norm(v); q = list.find(function (x) { return _norm(x.name) === n; }); }
  if (!q) return false;
  return is_allowed(user, role, q.id);
}
// Express middleware factory shared by both surfaces. `get_queues()` returns the [{id,name}] list (cached);
// `get_value(req)` returns the queue id/name to check (defaults to ?queue / body.queue). If no value is
// present it passes through (handler decides); otherwise a non-permitted queue -> 403. Fails closed on any
// error (e.g. the queue list can't be loaded). Requires req.user/req.role, so mount it AFTER the auth gate.
function require_queue(get_queues, get_value) {
  return async function (req, res, next) {
    try {
      const value = get_value ? get_value(req) : String((req.query && req.query.queue) || (req.body && req.body.queue) || '').trim();
      if (!value) return next();
      const queues = await get_queues();
      if (!is_allowed_queue(req.user, req.role, value, queues)) return res.status(403).json({ ok: false, error: 'queue not permitted' });
      return next();
    } catch (e) { return res.status(403).json({ ok: false, error: 'queue not permitted' }); }
  };
}
function _reset() { _cfg = null; }

module.exports = { get, set_default, set_user, clear_user, prune_users, allowed_for, is_allowed, is_allowed_queue, filter_queues, require_queue, _reset, FILE: FILE };
