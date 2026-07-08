'use strict';
// Reporting module manifest (first module on the platform). PROOF-OF-CONTRACT stub for now: it
// registers its panel, nav, and a module-owned API route so the end-to-end module wiring is provable.
//
// NEXT STEP (needs your MySQL to test): port the real participation-maps stack from src/reporting
// (store/participation_read.js, api routes for /api/bootstrap + /api/unique, web pages) into this
// module. That heavy port is deliberately deferred — see plans_and_notes/README_USAT_APPS.md.
const api = require('./api');

module.exports = {
  id: 'reporting',
  label: 'Reporting',
  // Panel keys this module contributes to the access catalog. Keep 'participation-maps' so a future
  // real port lines up 1:1 with the existing reporting app's panel + access records.
  panels: [
    { key: 'participation-maps', label: 'Participation maps' },
  ],
  // Its own analytics events table once ported; null = use the platform default (usat_apps_events).
  metricsTable: null,
  mount: function (app) { api.mount(app); },
};
