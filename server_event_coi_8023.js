'use strict';
// server_event_coi_8023.js — dedicated backend for the Event / Race Certificate (Insurance COI) tool.
//
// WHY ITS OWN SERVER: the COI run drives headless Chromium (Playwright), which is heavy and can hang,
// leak, or crash. Running it inside usat_apps (8022) would put that risk on the web front door and let
// a `usat_apps` redeploy kill in-flight runs. Isolating it here means a bad browser only takes down
// THIS process (pm2 restarts it), front-end deploys never interrupt a submission, and the run loop can
// go concurrent (EVENT_COI_MAX_CONCURRENT, default 5) without touching the UI tier.
//
// ROUTING: fronted by server_proxy_8000.js — `/api/event-coi/*` on usat-app.kidderwise.org proxies here
// (the proxy re-adds the stripped prefix via pathRewrite, so full paths reach this server). In local
// dev, vite (5175) proxies `/api/event-coi` here too. See utilities/proxy/proxy_routes.js.
//
// AUTH: the module's routes self-gate with require_panel('event-coi'). Auth is a signed session cookie;
// this process loads the SAME repo-root .env (session secret) and the same on-disk auth store as
// usat_apps, so the cookie set at login on usat_apps verifies here unchanged. No separate login.
const path = require('path');
const dotenv = require('dotenv');
// Repo-root .env (session secret + recovery creds) regardless of cwd — MUST match what usat_apps loads,
// or the shared session cookie won't verify.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const event_coi = require('./src/usat_apps/modules/event_coi/module');
const run_control = require('./src/usat_apps/modules/event_coi/store/run_control');

const DEFAULT_PORT = Number(process.env.EVENT_COI_PORT) || Number(process.env.USAT_EVENT_COI_PORT) || 8023;
const PROD_URL = 'https://usat-app.kidderwise.org/events/insurance-coi';

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache (matches usat_apps).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // One log line per call.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  // PUBLIC health check — pinged by the proxy's /api/health aggregator (target + this path). Never
  // gated, so it answers without a session. Reports the concurrency snapshot for quick visibility.
  app.get('/api/event-coi/health', function (req, res) {
    res.json({ ok: true, server: 'event_coi', port: DEFAULT_PORT, stats: run_control.stats(), time: new Date().toISOString() });
  });
  app.get('/api/status', function (req, res) { res.json({ ok: true, server: 'event_coi' }); });

  // The COI feature routes (panel-gated inside). Same mount the platform registry would call — but we
  // call it here, and registry.mount_all skips it in usat_apps (module.externalApi = true).
  event_coi.mount(app);

  return app;
}

function start_server(port) {
  const p = port || DEFAULT_PORT;
  const app = create_app();
  const server = app.listen(p, function () {
    const actual = server.address().port;
    console.log('\nUSAT Event COI - dedicated submission server');
    console.log('  -> http://localhost:' + actual + '/api/event-coi/health   (health check)');
    console.log('  -> ' + PROD_URL + '   (production — via :8000 proxy / Cloudflare)');
    console.log('  max concurrent runs: ' + run_control.MAX_CONCURRENT + ' (EVENT_COI_MAX_CONCURRENT to override)');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set EVENT_COI_PORT.');
    else console.error('server error:', (e && e.message) || e);
    process.exit(1);
  });
  return server;
}

if (require.main === module) start_server();
module.exports = { create_app, start_server };
