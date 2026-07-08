'use strict';
// Ops module — the infrastructure console ported from the :8000 proxy admin (Backends, Server cards,
// Logs, System health, Operations, Settings, Reference). PROGRESSIVE PORT: read-only panes first;
// destructive actions later. Admin-only. The proxy stays the live parity reference until cutover.
const api = require('./api');

module.exports = {
  id: 'ops',
  label: 'Ops',
  group: 'Ops',
  panels: [{ key: 'ops', label: 'Ops' }],
  metricsTable: null,
  mount: function (app) { api.mount(app); },
};
