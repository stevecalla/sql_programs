'use strict';
// modules/salesforce_email_queue/module.js
//
// SCAFFOLD ONLY. This module is intentionally NOT yet listed in modules/registry.js, so it changes
// nothing about the running platform (same idea as modules/_template). Registering it is the LAST
// step of the fold-in, once the API + shared services exist. See:
//   plans_and_notes/salesforce_email_queue/EMAIL_QUEUE_FOLDIN_PLAN.md
//   plans_and_notes/salesforce_email_queue/PORT_INVENTORY.md
//
// Contract (see plans_and_notes/README_USAT_APPS.md):
//   id / label / panels / metricsTable / mount(app)
//
// Fold-in target:
//   - AI + knowledge + corrections are extracted to src/usat_apps/services/ (shared with the chatbot).
//   - This module ports web/routes.js -> ./api.js and sf/ -> ./sf/ (read-only; no SF writes).
const { require_panel } = require('../../auth/require_auth');

module.exports = {
  id: 'salesforce_email_queue',
  label: 'Email Queue',
  panels: [{ key: 'email-queue', label: 'Email Queue' }],
  metricsTable: 'salesforce_email_queue_events',
  mount: function (app) {
    // Placeholder route only. Real routes port from web/routes.js into ./api.js (Phase 2).
    app.get('/api/salesforce-email-queue/ping', require_panel('email-queue'), function (req, res) {
      res.json({ ok: true, module: 'salesforce_email_queue', scaffold: true });
    });
  },
};
