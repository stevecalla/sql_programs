'use strict';
// Reporting module — server API. Namespaced under /api/reporting/* and gated by the module's own
// panel key. Proof-of-contract endpoint for now; the real /api/bootstrap + /api/unique handlers
// (ported from src/reporting/api/routes.js) will live here so all reporting data routes are owned by
// the module, not the platform.
const { require_panel } = require('../../auth/require_auth');

function mount(app) {
  // Health/ping for the module — proves module-owned, panel-gated routing works end to end.
  app.get('/api/reporting/ping', require_panel('participation-maps'), function (req, res) {
    res.json({ ok: true, module: 'reporting', user: req.user, msg: 'reporting module is mounted and panel-gated' });
  });
}

module.exports = { mount };
