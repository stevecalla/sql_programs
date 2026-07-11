'use strict';
// participation_maps module — the participation-maps report, ported from the standalone /reporting app
// (server_reporting_8021.js, branch reporting_app_v21) into the usat_apps platform. The module owns its
// data reader + API routes; the platform provides auth, session, metrics, and the React shell.
// Convention: module = report; "Reporting" is only the nav-group label (see
// plans_and_notes/PARTICIPATION_MAPS_PORT_PLAN.md).
const api = require('./api');

module.exports = {
  id: 'participation-maps',                 // stable slug -> /api/participation-maps/* + panel namespace
  label: 'Participation maps',
  group: 'Reporting',                       // nav-group label
  panels: [
    { key: 'participation-maps', label: 'Participation maps' },
  ],
  // Share the platform analytics table (usat_apps_events). Phase 2 finalizes metrics continuity.
  metricsTable: null,
  mount: function (app) { api.mount(app); },
};
