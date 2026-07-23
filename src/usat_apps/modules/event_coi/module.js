'use strict';
// event_coi module — Event / Race Certificate Request builder. Uploads a certificate-holder list and
// (Phase 3-4) drives the CSR24 portal to submit one certificate per holder. Manifest per the module
// contract (modules/_template/module.js): adding this to modules/registry.js is the only wiring the
// platform needs — panel access, nav gating, and API mounting all read from the registry.
const api = require('./api');

module.exports = {
  id: 'event_coi',                 // stable slug -> panel namespace; API base is /api/event-coi/*
  label: 'Event COI',
  group: 'Insurance',              // nav-group label
  panels: [{ key: 'event-coi', label: 'Event COI' }],
  metricsTable: null,              // shares the platform events table (panel_view tracking is automatic)
  mount: function (app) { api.mount(app); },
};
