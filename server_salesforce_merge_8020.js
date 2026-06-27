#!/usr/bin/env node
/**
 * server_salesforce_merge_8020.js — web host for the Salesforce Merge Management tool.
 *
 * Lives at the repo root beside the other server_*.js services (port 8020 follows the sequence
 * 8017 sf_duplicates, 8018 race_results, 8019 sf_email_queue). Mirrors the email-queue server:
 *   - create_app() builds the Express app (cors, no-cache, JSON API, serves the built React SPA)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 ::1 + IPv4 127.0.0.1),
 *     matching 8018/8019 so a Cloudflare tunnel dialing localhost works.
 *
 * PHASE 0 — READ-ONLY foundation. No Salesforce calls, no writes. The dashboard reads the
 * existing salesforce_duplicate_* tables in usat_sales_db. See
 * src/salesforce_merge/plans_and_notes/README_MERGE_TOOL.md.
 *
 * Usage:
 *   node server_salesforce_merge_8020.js            # default port 8020 (MERGE_PORT overrides)
 *   (build the React app first: cd src/salesforce_merge/web && npm install && npm run build)
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
// Repo-root .env (LOCAL_MYSQL_*, MERGE_ADMIN_USER/PASS, MERGE_SESSION_SECRET) regardless of cwd.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const mount = require('./src/salesforce_merge/api/routes');
const store = require('./src/salesforce_merge/auth/auth_store');

const DEFAULT_PORT = Number(process.env.MERGE_PORT) || 8020;
const WEB_DIST = path.join(__dirname, 'src', 'salesforce_merge', 'web', 'dist');

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache so SPA edits show on reload (same as 8018/8019).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // Lightweight request log — one line per call (same pattern as 8018/8019). Flags the app
  // root '/' so you can confirm a tunnel/proxy reaches this process.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    if (req.path === '/') console.log('[' + ts + '] GET / -> web app (index.html)  host=' + (req.headers.host || '?'));
    else console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  // JSON API (login/logout public; the rest auth-gated). No Salesforce writes in Phase 0.
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
        '<h1>Salesforce Merge tool</h1>' +
        '<p>The React app is not built yet. Run:</p>' +
        '<pre>cd src/salesforce_merge/web\nnpm install\nnpm run build</pre>' +
        '<p>The JSON API is live now — try <a href="/api/status">/api/status</a>.</p>'
      );
    });
  }

  return app;
}

// NGROK TUNNEL — optional public URL, same pattern as 8018/8019. Off by default (Cloudflare
// fronts the app in prod). Enable with MERGE_NGROK=true and a valid NGROK_AUTHTOKEN in .env.
const is_test_ngrok = false;
const ngrok_enabled_flag = String(process.env.MERGE_NGROK).toLowerCase() === 'true';
let ngrok_url = null;

function start_server(port) {
  const p = port || DEFAULT_PORT;
  const app = create_app();
  // No host arg -> dual-stack bind (IPv6 + IPv4), matching the other UI servers.
  const server = app.listen(p, function () {
    const actual = server.address().port;
    console.log('\nSalesforce Merge tool - local server');
    console.log('  -> http://localhost:' + actual + '/                 (web app)');
    console.log('  -> http://localhost:' + actual + '/api/status        (health check)');
    console.log('  login configured: ' + store.login_configured());
    if (!fs.existsSync(WEB_DIST)) console.log('  NOTE: React app not built yet — run salesforce_merge_build (see message at /).');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');

    // NGROK — best-effort; a missing/invalid NGROK_AUTHTOKEN must NOT crash the local server.
    if (is_test_ngrok || ngrok_enabled_flag) {
      process.once('unhandledRejection', function (err) {
        console.log('\n  [ngrok] tunnel not started: ' + ((err && (err.errorCode || err.message)) || String(err)));
        console.log('  The local server above keeps running. Set NGROK_AUTHTOKEN to get a public ngrok URL.\n');
      });
      const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');
      create_ngrok_tunnel(actual).then(function (u) { if (u) { ngrok_url = u; console.log('  [ngrok] public URL: ' + u); } });
    } else {
      console.log('  [ngrok] tunnel disabled (set MERGE_NGROK=true + NGROK_AUTHTOKEN to enable).');
    }
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set MERGE_PORT.');
    else console.error(e);
  });
  return server;
}

if (require.main === module) start_server();

module.exports = { create_app, start_server };
