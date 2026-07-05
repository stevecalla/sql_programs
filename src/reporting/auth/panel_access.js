'use strict';
// Panel access for the reporting app: a gateable panel catalog + a default allow-list and optional
// per-user overrides, persisted to a gitignored JSON outside the repo. Mirrors the merge tool's
// panel_access interface (catalog / get / set_default / set_user / clear_user / effective_panels /
// is_allowed) so require_auth.require_panel and the admin endpoints work identically.
//
// Panels are the reporting sections that can be gated. Admins always see everything.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');

// The catalog: key -> label. Add a panel here when a new report/page needs gating.
const CATALOG = [
  { key: 'participation-maps', label: 'Participation maps' },
  { key: 'metrics', label: 'Usage metrics' },
  { key: 'admin', label: 'Admin (users + access)' },
];
const KEYS = CATALOG.map(function (p) { return p.key; });

const FILE = process.env.REPORTING_PANEL_ACCESS_FILE || data_dir.file_sync('panel_access.json');

function ensure(o) {
  o = o || {};
  // default 'all' -> every non-admin user sees every panel until an admin narrows it.
  if (o.default === undefined) o.default = 'all';
  if (!o.users || typeof o.users !== 'object') o.users = {};
  return o;
}
function read() { try { return ensure(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { return ensure({}); } }
function write(o) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(ensure(o), null, 2) + '\n', { mode: 0o600 }); }
  catch (e) { /* read-only data dir — best-effort */ }
}

function catalog() { return CATALOG.slice(); }
function get() { return read(); }

function normalize(list) {
  if (list === 'all') return 'all';
  if (!Array.isArray(list)) return [];
  return list.filter(function (k) { return KEYS.indexOf(k) >= 0; });
}
function set_default(list) { const o = read(); o.default = normalize(list); write(o); return o; }
function set_user(user, list) { const o = read(); o.users[String(user)] = normalize(list); write(o); return o; }
function clear_user(user) { const o = read(); delete o.users[String(user)]; write(o); return o; }

// The panels a specific user effectively has. Admins get everything.
function effective_panels(user, role) {
  if ((role || 'user') === 'admin') return KEYS.slice();
  const o = read();
  const per = o.users[String(user)];
  const allow = per !== undefined ? per : o.default;
  return allow === 'all' ? KEYS.filter(function (k) { return k !== 'admin'; }) : normalize(allow);
}
function is_allowed(user, role, panel) {
  if ((role || 'user') === 'admin') return true;
  if (panel === 'admin') return false; // only admins reach the admin panel
  return effective_panels(user, role).indexOf(panel) >= 0;
}

module.exports = { catalog, get, set_default, set_user, clear_user, effective_panels, is_allowed };
