'use strict';
// event_coi module — Event / Race Certificate Request builder. Uploads a certificate-holder list and
// (Phase 3-4) drives the CSR24 portal to submit one certificate per holder. Manifest per the module
// contract (modules/_template/module.js): adding this to modules/registry.js is the only wiring the
// platform needs — panel access, nav gating, and API mounting all read from the registry.
const api = require('./api');

module.exports = {
  id: 'event_coi',                 // stable slug -> panel namespace; API base is /api/event-coi/*
  label: 'Insurance COI',
  group: 'Events',                 // nav-group label
  panels: [{ key: 'event-coi', label: 'Event COI' }],
  metricsTable: null,              // shares the platform events table (panel_view tracking is automatic)
  // The COI API + Playwright run in a DEDICATED server (server_event_coi_8023.js), isolated from the
  // web front door so a wedged browser can't take usat_apps down and front-end deploys don't kill runs.
  // externalApi:true tells registry.mount_all NOT to mount these routes inside usat_apps; the dedicated
  // server calls api.mount() itself. The panel above still registers here so access control + nav work.
  externalApi: true,
  mount: function (app) { api.mount(app); },
};
