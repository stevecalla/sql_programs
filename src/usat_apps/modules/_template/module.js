'use strict';
// _template/module.js — copy this folder to modules/<your-id>/ to scaffold a new module, then add it
// to modules/registry.js. That is the ONLY change the platform needs to gain a new app.
//
// Contract (see plans_and_notes/README_USAT_APPS.md):
//   id            stable slug — becomes the URL segment (/<id>) and panel namespace
//   label         nav label shown in the side rail / switcher
//   panels        [{ key, label }] panel keys this module gates (added to the access catalog)
//   metricsTable  its own analytics events table name, or null to share the platform default
//   mount(app)    register the module's /api/<id>/* Express routes (panel-gate them with require_panel)
//
// The matching FRONT-END manifest lives in web/src/modules/<id>/ and is listed in
// web/src/modules/registry.js (id, label, panel, lazy-loaded <Section/> component, route path).
const { require_panel } = require('../../auth/require_auth');

module.exports = {
  id: 'example',
  label: 'Example',
  panels: [{ key: 'example', label: 'Example panel' }],
  metricsTable: null,
  mount: function (app) {
    app.get('/api/example/ping', require_panel('example'), function (req, res) {
      res.json({ ok: true, module: 'example' });
    });
  },
};
