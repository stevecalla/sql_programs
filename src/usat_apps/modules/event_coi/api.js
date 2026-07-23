'use strict';
// event_coi API — panel-gated routes under /api/event-coi/*. Uploads arrive as base64 JSON (the
// platform already parses JSON up to 5mb, so no multer/file-upload dependency is needed) and are
// parsed server-side by store/holder_parse (root `xlsx`). See modules/_template/module.js for the
// module contract.
const { require_panel } = require('../../auth/require_auth');
const holder_parse = require('./store/holder_parse');

function mount(app) {
  const gate = require_panel('event-coi');

  // Wiring check (matches the _template ping) — confirms the module is mounted + the panel is granted.
  app.get('/api/event-coi/ping', gate, function (req, res) {
    res.json({ ok: true, module: 'event_coi', user: req.user });
  });

  // Parse an uploaded holder list. Body: { filename, dataB64 } -> { ok, sheet, count, holders }.
  app.post('/api/event-coi/parse', gate, function (req, res) {
    try {
      const b = req.body || {};
      const filename = String(b.filename || '');
      const dataB64 = String(b.dataB64 || '');
      if (!dataB64) return res.status(400).json({ ok: false, error: 'no file data' });
      const buf = Buffer.from(dataB64, 'base64');
      const { sheet, holders } = holder_parse.parseUpload(filename, buf);
      res.json({ ok: true, sheet, count: holders.length, holders });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e && e.message) || String(e) });
    }
  });
}

module.exports = { mount };
