'use strict';
// event_coi API — panel-gated routes under /api/event-coi/*. Uploads arrive as base64 JSON (the
// platform already parses JSON up to 5mb, so no multer/file-upload dependency is needed) and are
// parsed server-side by store/holder_parse (root `xlsx`). The submission run is orchestrated by
// store/run_control (one logged-in Chromium session; progress + screenshots stream over SSE).
const { require_panel } = require('../../auth/require_auth');
const holder_parse = require('./store/holder_parse');
const run_control = require('./store/run_control');
const { validateRequest } = require('./store/validate_request');

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

  // ---- Submission run ----
  // Start a run. Body: { event, requestor, options, holders, mode: 'review'|'auto', headed? }.
  app.post('/api/event-coi/run/start', gate, function (req, res) {
    const b = req.body || {};
    const batch = { event: b.event || {}, requestor: b.requestor || {}, options: b.options || {}, holders: Array.isArray(b.holders) ? b.holders : [] };
    const v = validateRequest(batch);
    if (!v.ok) return res.status(400).json({ ok: false, error: 'incomplete request', problems: v.problems });
    if (run_control.activeRun()) return res.status(409).json({ ok: false, error: 'a submission run is already in progress' });
    const run = run_control.start(batch, { mode: b.mode === 'auto' ? 'auto' : 'review', headless: !b.headed });
    res.json({ ok: true, runId: run.id, total: run.total });
  });

  // SSE progress stream. ?runId=...
  app.get('/api/event-coi/run/stream', gate, function (req, res) {
    const id = String(req.query.runId || '');
    if (!run_control.get(id)) return res.status(404).json({ ok: false, error: 'no such run' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();
    run_control.subscribe(id, res);
    const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* gone */ } }, 25000);
    req.on('close', function () { clearInterval(keepalive); run_control.unsubscribe(id, res); });
  });

  const decideRoute = (decision) => (req, res) => {
    const id = String((req.body && req.body.runId) || '');
    const r = run_control.decide(id, decision);
    res.status(r.ok ? 200 : 404).json(r);
  };
  app.post('/api/event-coi/run/approve', gate, decideRoute('approve'));
  app.post('/api/event-coi/run/approve-all', gate, decideRoute('approve-all'));
  app.post('/api/event-coi/run/skip', gate, decideRoute('skip'));
  app.post('/api/event-coi/run/stop', gate, decideRoute('stop'));

  app.get('/api/event-coi/run/results', gate, function (req, res) {
    const run = run_control.get(String(req.query.runId || ''));
    if (!run) return res.status(404).json({ ok: false, error: 'no such run' });
    res.json({ ok: true, status: run.status, total: run.total, results: run.results });
  });
}

module.exports = { mount };
