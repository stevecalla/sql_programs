'use strict';
// Panel allow-list: which UI panels (nav sections) a user may see + reach. Managed from /admin.
// Mirrors src/salesforce_email_queue_proof_of_concept/store/queue_access.js (general default +
// per-user overrides + admin bypass). Persisted OUTSIDE the repo (no config committed):
//   <determineOSPath()>/usat_salesforce_merge/panel_access.json   (override: MERGE_PANEL_ACCESS_FILE)
//
// Shape:
//   { default: "all" | [panelKey...],          // applies to non-admins with no explicit override
//     users:   { "<username>": "all" | [panelKey...] } }
//
// Semantics:
//   - admins always see EVERY panel (incl. 'admin'); the allow-list governs non-admins only.
//   - the 'admin' panel (user management) is HARD role-gated — never grantable to a non-admin.
//   - a non-admin with an explicit entry uses it; otherwise the global default applies.
//   - "all" means "every grantable panel" (everything except 'admin').
//   - the out-of-the-box default is every grantable panel EXCEPT 'metrics' (per product decision);
//     an admin can override per-user to grant 'metrics' or to restrict any panel.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');
const FILE = process.env.MERGE_PANEL_ACCESS_FILE || data_dir.file_sync('panel_access.json');

// Catalog of gateable panels (key = route path without the leading slash; '' = Dashboard home).
// 'admin' is intentionally NOT here — it is role-gated, not panel-gated.
const PANELS = [
  { key: '', label: 'Dashboard', group: 'Review' },
  { key: 'duplicates', label: 'Duplicates', group: 'Review' },
  { key: 'merge-id', label: 'Merge-ID', group: 'Review' },
  { key: 'accounts', label: 'All accounts', group: 'Review' },
  { key: 'get-duplicates', label: 'Get Duplicates', group: 'Operate' },
  { key: 'select-merges', label: 'Select Merges', group: 'Operate' },
  { key: 'merge-process', label: 'Process Merges', group: 'Operate' },
  { key: 'restore', label: 'Restore', group: 'Operate' },
  { key: 'tuning', label: 'Tuning', group: 'Analyze' },
  { key: 'metrics', label: 'Metrics', group: 'Admin' },
  { key: 'reference', label: 'Reference', group: 'Help' },
];
const PANEL_KEYS = PANELS.map(function (p) { return p.key; });
// Product default for a new non-admin: everything grantable EXCEPT metrics.
const DEFAULT_PANELS = PANEL_KEYS.filter(function (k) { return k !== 'metrics'; });

let _cfg = null;
function load() {
  if (_cfg) return _cfg;
  try { _cfg = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { _cfg = { default: DEFAULT_PANELS.slice(), users: {} }; }
  return _cfg;
}
function norm_set(v) {
  if (v === 'all') return 'all';
  if (Array.isArray(v)) return v.map(String).filter(function (k) { return PANEL_KEYS.indexOf(k) >= 0; });
  return null;
}
function normalize(o) {
  o = o || {};
  const def = norm_set(o.default);
  const users = {};
  const src = (o.users && typeof o.users === 'object') ? o.users : {};
  Object.keys(src).forEach(function (u) { const s = norm_set(src[u]); if (s !== null) users[u] = s; });
  return { default: (def === null ? DEFAULT_PANELS.slice() : def), users: users };
}
function save() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(load(), null, 2) + '\n', { mode: 0o600 }); }
  catch (e) { /* ignore */ }
}

function catalog() { return PANELS.slice(); }
function get() { return load(); }
function set_default(panels) { const c = load(); const s = norm_set(panels); c.default = (s === null ? DEFAULT_PANELS.slice() : s); save(); return c; }
function set_user(user, panels) {
  const c = load(); if (!user) return c;
  const s = norm_set(panels); c.users[String(user)] = (s === null ? 'all' : s);
  save(); return c;
}
function clear_user(user) { const c = load(); delete c.users[String(user)]; save(); return c; }

// The effective allow-list for a non-admin: 'all' or an array of allowed panel keys. Admin -> 'all'.
function allowed_for(user, role) {
  if (role === 'admin') return 'all';
  const c = load();
  const u = c.users[String(user)];
  if (u !== undefined) return u;
  return c.default;
}
// Can this user reach a specific panel? 'admin' panel requires the admin role.
function is_allowed(user, role, panel) {
  panel = String(panel == null ? '' : panel);
  if (panel === 'admin') return role === 'admin';
  if (role === 'admin') return true;
  if (PANEL_KEYS.indexOf(panel) < 0) return false;
  const a = allowed_for(user, role);
  if (a === 'all') return true;
  return a.indexOf(panel) >= 0;
}
// Concrete list of panel keys a user may see — used by /api/me so the nav can filter. Admins also
// get 'admin'.
function effective_panels(user, role) {
  if (role === 'admin') return PANEL_KEYS.concat(['admin']);
  const a = allowed_for(user, role);
  return (a === 'all') ? PANEL_KEYS.slice() : a.slice();
}
function _reset() { _cfg = null; }

module.exports = {
  PANELS, PANEL_KEYS, DEFAULT_PANELS,
  catalog, get, set_default, set_user, clear_user,
  allowed_for, is_allowed, effective_panels, _reset, FILE: FILE,
};
