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
// Curated BASE catalog: platform-level panels (metrics, admin, …) + the canonical group/label/order for
// panels apps own. Module-contributed panels (registry.panels()) are MERGED on top of this at read time —
// any panel a module declares that isn't already listed here is appended under the module's nav group. So
// adding a module automatically adds its panel(s) to the grid; this base only fixes ordering/grouping for
// the panels we want curated. (See build_catalog below.)
const CATALOG = [
  { key: 'participation-maps', label: 'Participation maps', group: 'Reporting' },
  { key: 'event-analysis',     label: 'Event analysis',     group: 'Reporting' },
  { key: 'merge',              label: 'Merge',              group: 'Salesforce' },
  { key: 'merge-ops',          label: 'Merge Ops (admin)',  group: 'Salesforce' },
  { key: 'email-queue',        label: 'Email Queue',        group: 'Salesforce' },
  { key: 'event-coi',          label: 'Insurance COI',      group: 'Events' },
  // Chatbot: one key PER rail sub-page (Bot training / Public widget / Stress test) so each is listed and
  // grantable on its own — same shape as Salesforce/Metrics/Admin. The shared operator surface (queues,
  // context, corrections) is reachable from any of the three (see require_any_panel in the chatbot API).
  { key: 'chatbot',            label: 'Bot training',       group: 'Chatbot' },
  { key: 'chatbot-widget',     label: 'Public widget',      group: 'Chatbot' },
  { key: 'chatbot-stress',     label: 'Stress test',        group: 'Chatbot' },
  // Metrics pages are a real group (mirrors the rail's Metrics section) — not group:null, which the Admin
  // grid would bucket as "GENERAL".
  { key: 'metrics',            label: 'Usage metrics',      group: 'Metrics' },
  { key: 'merge-metrics',      label: 'SF Merge metrics',    group: 'Metrics' },
  { key: 'email-queue-metrics',label: 'SF Email Queue metrics', group: 'Metrics' },
  { key: 'chatbot-metrics',    label: 'Chatbot metrics',    group: 'Metrics' },
  { key: 'ops',                label: 'Ops',                group: 'Ops' },
  { key: 'admin',              label: 'Users & access',     group: 'Admin' },
  { key: 'knowledge-admin',    label: 'Knowledge & AI',     group: 'Admin' },
  { key: 'email-queue-admin',  label: 'Email Queue admin',  group: 'Admin' },
];

// Canonical group order for the Admin access grid — mirrors the nav rail (web/src/nav.js NAV). build_catalog
// sorts by this so the grid always lists groups in rail order; a module that contributes a panel in an
// unlisted group is appended after these. Keep in sync with the rail's group order.
const GROUP_ORDER = ['Reporting', 'Salesforce', 'Events', 'Chatbot', 'Metrics', 'Ops', 'Admin'];

// The effective catalog = curated BASE + every module-contributed panel not already in the base, appended
// under that module's nav group. The registry is lazy-required (not at load time) to avoid a require cycle
// (modules -> auth/require_auth -> access/panel_access -> modules/registry -> modules). Memoized: the module
// set is fixed for the process lifetime. Falls back to the curated base if the registry can't be loaded.
let _catalog = null;
function build_catalog() {
  if (_catalog) return _catalog;
  const seen = {};
  const out = [];
  CATALOG.forEach(function (p) { seen[p.key] = true; out.push({ key: p.key, label: p.label, group: p.group }); });
  try {
    const registry = require('../modules/registry');
    registry.list().forEach(function (m) {
      (m && m.panels ? m.panels : []).forEach(function (p) {
        if (p && p.key && !seen[p.key]) { seen[p.key] = true; out.push({ key: p.key, label: p.label || p.key, group: (m.group || null) }); }
      });
    });
  } catch (e) { /* registry unavailable (isolated tests) — curated base only */ }
  // Order the grid groups to match the nav rail. Stable within a group (curated CATALOG order, then any
  // module-appended panels). Unlisted groups (and group:null) sort to the end.
  const rank = function (g) { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  const sorted = out
    .map(function (p, i) { return { p: p, i: i, r: rank(p.group) }; })
    .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
    .map(function (x) { return x.p; });
  _catalog = sorted;
  return sorted;
}
// Sensitive panels excluded from the default 'all' grant — they need an explicit per-user grant
// (admins always see everything regardless). 'admin' is additionally hard-gated in is_allowed().
const DEFAULT_ALL_EXCLUDE = ['admin', 'ops', 'merge-ops', 'email-queue-admin'];

function catalog() { return build_catalog().map(function (p) { return { key: p.key, label: p.label, group: p.group }; }); }
function keys() { return build_catalog().map(function (p) { return p.key; }); }

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
