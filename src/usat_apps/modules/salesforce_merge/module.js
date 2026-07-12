'use strict';
// salesforce_merge module — folds the standalone salesforce_merge app (server_salesforce_merge_8020.js)
// into the usat_apps platform as the `merge` module. Walking skeleton: manifest + a ping route only;
// the ~50 domain endpoints, store/*, and 11 pages port in Phase 1-2 (see
// plans_and_notes/salesforce_merge/SALESFORCE_MERGE_PORT_PLAN.md). The platform provides auth, session,
// metrics, and the React shell; merge's own login/admin are dropped (gated on the `merge` panel).
const api = require('./api');

module.exports = {
  id: 'merge',                          // stable slug -> /api/salesforce-merge/* + panel namespace
  label: 'Merge',
  group: 'Salesforce',                  // nav-group label
  panels: [
    { key: 'merge', label: 'Merge' },
  ],
  metricsTable: null,                   // share the platform analytics table (usat_apps_events)
  mount: function (app) { api.mount(app); },
};
