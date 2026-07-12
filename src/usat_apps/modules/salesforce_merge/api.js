'use strict';
// salesforce_merge module — server API. Routes namespaced under /api/salesforce-merge/* and gated by the
// module's `merge` panel key. Walking skeleton: a single ping route proves the mount + panel gate before
// the ~50 domain handlers port over (Phase 1). Write endpoints will ENQUEUE jobs for the worker in Phase 3.
const { require_panel } = require('../../auth/require_auth');

function mount(app) {
  const gate = require_panel('merge');

  // Skeleton health check — confirms the module is mounted and the panel gate works.
  app.get('/api/salesforce-merge/ping', gate, function (req, res) {
    res.json({ ok: true, module: 'merge', ts: new Date().toISOString() });
  });
}

module.exports = { mount };
