#!/usr/bin/env node
/**
 * server_usat_apps_8022.js — web host for the USAT Apps platform (the single-app shell that will host
 * reporting, merge, and the other tools as modules).
 *
 * Lives at the repo root beside the other server_*.js services (port 8022 follows 8021 reporting).
 * Mirrors server_reporting_8021.js / server_salesforce_merge_8020.js:
 *   - create_app() builds the Express app (cors, no-cache, JSON API, serves the built React SPA)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 + IPv4), matching the others.
 *
 * Served at the root '/' of the app host (usat-app.kidderwise.org) behind the :8000 proxy / Cloudflare.
 * The API host (usat-api) does NOT serve the app — the proxy host-gates '/'. Local login uses the existing
 * .env recovery accounts (USATAPPS_* or, as a fallback, REPORTING_*). Microsoft/Entra SSO is deferred
 * — see src/usat_apps/plans_and_notes/README_USAT_APPS.md.
 *
 * Usage:
 *   node server_usat_apps_8022.js                 # default port 8022 (USATAPPS_PORT overrides)
 *   (build the React app first: cd src/usat_apps/web && npm install && npm run build)
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
// Repo-root .env (LOCAL_MYSQL_*, USATAPPS_*/REPORTING_* recovery creds, session secret) regardless of cwd.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const mount = require('./src/usat_apps/api/routes');
const store = require('./src/usat_apps/auth/auth_store');

const DEFAULT_PORT = Number(process.env.USATAPPS_PORT) || Number(process.env.USAT_APPS_PORT) || 8022;
const WEB_DIST = path.join(__dirname, 'src', 'usat_apps', 'web', 'dist');
const PROD_URL = 'https://usat-app.kidderwise.org/';

// NGROK TUNNEL — optional public URL, same pattern as 8020/8021. Off by default (Cloudflare fronts the
// app in prod). Enable with USATAPPS_NGROK=true and a valid NGROK_AUTHTOKEN in .env.
const is_test_ngrok = false;
const ngrok_enabled_flag = String(process.env.USATAPPS_NGROK).toLowerCase() === 'true';
let ngrok_url = null;

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache so SPA edits show on reload (same as 8020/8021).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // One log line per call — flags the app root '/' so you can confirm a tunnel/proxy reaches this process.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    if (req.path === '/') console.log('[' + ts + '] GET / -> web app (index.html)  host=' + (req.headers.host || '?'));
    else console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  // JSON API (status/login/logout public; the rest auth-gated).
  app.use(express.json({ limit: '5mb' }));
  mount(app);

  // Serve the built React app (static) with a SPA fallback for client-side routes.
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, function (req, res) {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    app.get('/', function (req, res) {
      res.type('html').send(
        '<h1>USAT Apps</h1>' +
        '<p>The React app is not built yet. Run:</p>' +
        '<pre>cd src/usat_apps/web\nnpm install\nnpm run build</pre>' +
        '<p>The JSON API is live now — try <a href="/api/status">/api/status</a>.</p>'
      );
    });
  }

  return app;
}

function start_server(port) {
  const p = port || DEFAULT_PORT;
  const app = create_app();
  // No host arg -> dual-stack bind (IPv6 + IPv4), matching the other UI servers.
  const server = app.listen(p, function () {
    const actual = server.address().port;
    console.log('\nUSAT Apps - local platform server');
    console.log('  -> http://localhost:' + actual + '/                 (web app, local)');
    console.log('  -> http://localhost:' + actual + '/api/status        (health check)');
    console.log('  -> ' + PROD_URL + '   (production — :8000 proxy / Cloudflare)');
    console.log('  login configured: ' + store.login_configured());
    if (!fs.existsSync(WEB_DIST)) console.log('  NOTE: React app not built yet — run the build (see message at /).');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');

    // NGROK — best-effort; a missing/invalid NGROK_AUTHTOKEN must NOT crash the local server.
    if (is_test_ngrok || ngrok_enabled_flag) {
      process.once('unhandledRejection', function (err) {
        console.log('\n  [ngrok] tunnel not started: ' + ((err && (err.errorCode || err.message)) || String(err)));
        console.log('  The local server above keeps running. Set NGROK_AUTHTOKEN to get a public ngrok URL.\n');
      });
      const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');
      create_ngrok_tunnel(actual).then(function (u) { if (u) { ngrok_url = u; console.log('  [ngrok] public URL: ' + u + '/   (this tunnel serves the app at ROOT)'); } });
    } else {
      console.log('  [ngrok] tunnel disabled (set USATAPPS_NGROK=true + NGROK_AUTHTOKEN to enable).');
    }
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set USATAPPS_PORT.');
    else console.error(e);
  });
  return server;
}

if (require.main === module) start_server();

module.exports = { create_app, start_server };
