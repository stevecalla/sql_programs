'use strict';
// salesforce_email_queue module manifest — folds the standalone email-queue app
// (server_salesforce_email_queue_8019.js) into the usat_apps platform as the `salesforce_email_queue`
// module. The API + SF read layer are served by the platform (:8022); auth, session, the metrics
// framework, ops, and the React shell come from the platform. Read-only (no SF writes). UI is the
// scaffold Section until Phase 3; EQ admin/metrics land in Phase 4.
const api = require('./api');

module.exports = {
  id: 'salesforce_email_queue',
  label: 'Email Queue',
  group: 'Salesforce',
  panels: [{ key: 'email-queue', label: 'Email Queue' }],
  metricsTable: 'salesforce_email_queue_events',
  mount: function (app) { api.mount(app); },
};
