'use strict';
/**
 * modules/registry.js — the server-side module registry for the usat_apps platform.
 *
 * A "module" is a self-contained feature domain (reporting, merge, event-analysis, …). Each one
 * exports a small manifest (see the module contract in plans_and_notes/README_USAT_APPS.md):
 *
 *   {
 *     id:          'reporting',                       // stable slug (URL + panel namespace)
 *     label:       'Reporting',                       // nav label
 *     panels:      [{ key, label }],                  // panel keys it contributes to access control
 *     metricsTable: 'usat_apps_events' | null,        // its own events table (null = share platform's)
 *     mount(app):  registers its /api/<id>/* routes   // server side
 *   }
 *
 * To add a module: create modules/<id>/module.js against the contract and add it to MODULES below.
 * Nothing else in the platform changes — panel access, nav, and API mounting all read from here.
 */
const participation_maps = require('./participation_maps/module');
const ops = require('./ops/module');

const MODULES = [
  participation_maps,
  ops,
  // merge,            // (Phase 5) port src/salesforce_merge as a module here
  // event_analysis,   // (Phase 5)
];

function list() { return MODULES.slice(); }

// Flatten every module's contributed panels -> [{ key, label, module }]. Consumed by access/panel_access.
function panels() {
  const out = [];
  MODULES.forEach(function (m) {
    (m.panels || []).forEach(function (p) { out.push({ key: p.key, label: p.label, module: m.id }); });
  });
  return out;
}

// Mount every module's API routes onto the Express app.
function mount_all(app) {
  MODULES.forEach(function (m) { if (typeof m.mount === 'function') m.mount(app); });
}

// Prebuild each module's data caches at server startup (best-effort, non-blocking) so the first request
// serves live data instead of the fixture fallback. Called from start_server AFTER listen — NEVER from
// create_app, so tests that build the app don't trigger a MySQL connection.
function warm_all() {
  MODULES.forEach(function (m) {
    if (typeof m.warm === 'function') {
      try { Promise.resolve(m.warm()).catch(function () {}); } catch (e) { /* ignore */ }
    }
  });
}

module.exports = { list, panels, mount_all, warm_all };
