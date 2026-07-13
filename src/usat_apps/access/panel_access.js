'use strict';
// Panel access for the usat_apps platform: a gateable panel catalog + a default allow-list and optional
// per-user overrides, persisted to a gitignored JSON outside the repo. Same interface as reporting's
// panel_access (catalog / get / set_default / set_user / clear_user / effective_panels / is_allowed).
//
// KEY DIFFERENCE from the standalone apps: the catalog is built DYNAMICALLY from the module registry
// (each module contributes its own panel keys) plus the platform-level panels (metrics, admin). So
// adding a module automatically adds its panels here — no edits to this file. This is the module
// contract's authorization surface. Admins always see everything.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');
// The panel catalog — grouped for the rail + Admin UI. `group` buckets panels into collapsible rail
// sections (Reporting, Salesforce, Admin, Ops); group:null = a standalone top-level link (Metrics).
// Access is enforced per KEY (finest grain) — a group is only a display container / bulk-grant. As
// apps are ported as real modules they can register their panels here; for now it's explicit.
const CATALOG = [
  { key: 'participation-maps', label: 'Participation maps', group: 'Reporting' },
  { key: 'event-analysis',     label: 'Event analysis',     group: 'Reporting' },
  { key: 'merge',              label: 'Merge',              group: 'Salesforce' },
  { key: 'metrics',            label: 'Usage metrics',      group: null },
  { key: 'merge-metrics',      label: 'SF Merge metrics',    group: null },
  { key: 'admin',              label: 'Users & access',     group: 'Admin' },
  { key: 'ops',                label: 'Ops',                group: 'Ops' },
];
// Sensitive panels excluded from the default 'all' grant — they need an explicit per-user grant
// (admins always see everything regardless). 'admin' is additionally hard-gated in is_allowed().
const DEFAULT_ALL_EXCLUDE = ['admin', 'ops'];

function catalog() { return CATALOG.map(function (p) { return { key: p.key, label: p.label, group: p.group }; }); }
function keys() { return CATALOG.map(function (p) { return p.key; }); }

const FILE = process.env.USATAPPS_PANEL_ACCESS_FILE || data_dir.file_sync('panel_access.json');

function ensure(o) {
  o = o || {};
  if (o.default === undefined) o.default = 'all'; // every non-admin sees every panel until narrowed
  if (!o.users || typeof o.users !== 'object') o.users = {};
  return o;
}
function read() { try { return ensure(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { return ensure({}); } }
function write(o) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(ensure(o), null, 2) + '\n', { mode: 0o600 }); }
  catch (e) { /* read-only data dir — best-effort */ }
}

function get() { return read(); }

function normalize(list) {
  if (list === 'all') return 'all';
  if (!Array.isArray(list)) return [];
  const k = keys();
  return list.filter(function (x) { return k.indexOf(x) >= 0; });
}
function set_default(list) { const o = read(); o.default = normalize(list); write(o); return o; }
function set_user(user, list) { const o = read(); o.users[String(user)] = normalize(list); write(o); return o; }
function clear_user(user) { const o = read(); delete o.users[String(user)]; write(o); return o; }

// The panels a specific user effectively has. Admins get everything.
function effective_panels(user, role) {
  if ((role || 'user') === 'admin') return keys();
  const o = read();
  const per = o.users[String(user)];
  const allow = per !== undefined ? per : o.default;
  return allow === 'all' ? keys().filter(function (k) { return DEFAULT_ALL_EXCLUDE.indexOf(k) < 0; }) : normalize(allow);
}
function is_allowed(user, role, panel) {
  if ((role || 'user') === 'admin') return true;
  if (panel === 'admin') return false; // only admins reach the admin panel
  return effective_panels(user, role).indexOf(panel) >= 0;
}

module.exports = { catalog, keys, get, set_default, set_user, clear_user, effective_panels, is_allowed };
