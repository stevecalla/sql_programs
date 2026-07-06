#!/usr/bin/env node
/**
 * server_reporting_8021.js — web host for the USAT Reporting app (participation maps + future reports).
 *
 * Lives at the repo root beside the other server_*.js services (port 8021 follows 8020 salesforce_merge).
 * Mirrors server_salesforce_merge_8020.js exactly:
 *   - create_app() builds the Express app (cors, no-cache, JSON API, serves the built React SPA)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 ::1 + IPv4 127.0.0.1),
 *     matching 8018/8019/8020 so a Cloudflare tunnel / the :8000 proxy dialing localhost works.
 *
 * Phase 0/1 — READ-ONLY. Reads the participation table in the local MySQL (usat_sales_db). No writes.
 * The umbrella prefix is '/reporting'; the first page is '/reporting/participation-maps'.
 * See src/reporting/plans_and_notes/README_REPORTING.md and PHASE_PLAN.md.
 *
 * Usage:
 *   node server_reporting_8021.js                  # default port 8021 (REPORTING_PORT overrides)
 *   (build the React app first: cd src/reporting/web && npm install && npm run build)
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
// Repo-root .env (LOCAL_MYSQL_*, REPORTING_ADMIN_USER/PASS, REPORTING_SESSION_SECRET) regardless of cwd.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const mount = require('./src/reporting/api/routes');
const store = require('./src/reporting/auth/auth_store');

const DEFAULT_PORT = Number(process.env.REPORTING_PORT) || 8021;
const WEB_DIST = path.join(__dirname, 'src', 'reporting', 'web', 'dist');
const PROD_URL = 'https://usat-app.kidderwise.org/reporting/participation-maps';

// NGROK TUNNEL — optional public URL, same pattern as 8020/8018/8019. Off by default (Cloudflare
// fronts the app in prod). Enable with REPORTING_NGROK=true and a valid NGROK_AUTHTOKEN in .env.
const is_test_ngrok = false;
const ngrok_enabled_flag = String(process.env.REPORTING_NGROK).toLowerCase() === 'true';
let ngrok_url = null;

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache so SPA edits show on reload (same as 8020).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // Lightweight request log — one line per call (same pattern as 8020). Flags the app root '/'
  // so you can confirm a tunnel/proxy reaches this process.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    if (req.path === '/') console.log('[' + ts + '] GET / -> web app (index.html)  host=' + (req.headers.host || '?'));
    else console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  // JSON API (status/login/logout public; the rest auth-gated). Read-only.
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
        '<h1>USAT Reporting</h1>' +
        '<p>The React app is not built yet. Run:</p>' +
        '<pre>cd src/reporting/web\nnpm install\nnpm run build</pre>' +
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
    console.log('\nUSAT Reporting - local server');
    console.log('  -> http://localhost:' + actual + '/                 (web app, local)');
    console.log('  -> http://localhost:' + actual + '/api/status        (health check)');
    console.log('  -> ' + PROD_URL + '   (production — :8000 proxy / Cloudflare)');
    console.log('  login configured: ' + store.login_configured());
    if (!fs.existsSync(WEB_DIST)) console.log('  NOTE: React app not built yet — run reporting_build (see message at /).');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');

    // NGROK — best-effort; a missing/invalid NGROK_AUTHTOKEN must NOT crash the local server.
    if (is_test_ngrok || ngrok_enabled_flag) {
      process.once('unhandledRejection', function (err) {
        console.log('\n  [ngrok] tunnel not started: ' + ((err && (err.errorCode || err.message)) || String(err)));
        console.log('  The local server above keeps running. Set NGROK_AUTHTOKEN to get a public ngrok URL.\n');
      });
      const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');
      create_ngrok_tunnel(actual).then(function (u) { if (u) { ngrok_url = u; console.log('  [ngrok] public URL: ' + u + '/   (this tunnel serves the app at ROOT, not /reporting)'); } });
    } else {
      console.log('  [ngrok] tunnel disabled (set REPORTING_NGROK=true + NGROK_AUTHTOKEN to enable).');
    }

    // Warm the participation payload cache in the background so the first page load isn't the slow
    // (first) MySQL build. Best-effort — failures just mean the first request builds on demand.
    try {
      var pr = require('./src/reporting/store/participation_read');
      // Report the FINAL served source, not the transient one. get_bootstrap() may hand back the fixture
      // immediately (stale-while-revalidate) while the live MySQL build finishes in the background — so we
      // only shout "fixture" if it's STILL fixture after that background build has had time to settle.
      var announce = function (r, isFinal) {
        if (r && r.source === 'mysql') {
          console.log('\x1b[42m\x1b[1;30m');
          console.log('  ============================================================');
          console.log('   ✓  LIVE DATA — participation payload cached from MySQL  ✓');
          console.log('  ============================================================\x1b[0m');
          return true;
        }
        if (!isFinal) { console.log('\x1b[33m  [data] warming… live MySQL build in progress (temporarily serving fixture)\x1b[0m'); return false; }
        // Still fixture after the live attempt settled -> genuine fallback. LOUD banner.
        console.log('\x1b[41m\x1b[1;37m');
        console.log('  ============================================================');
        console.log('   ⚠  SERVING FALLBACK FIXTURE DATA — NOT LIVE  ⚠');
        console.log('  ============================================================\x1b[0m');
        console.log('\x1b[33m  MySQL was unreachable or the build failed, so the app is serving');
        console.log('  src/reporting/store/fixtures/participation_bootstrap.json (may be STALE).');
        console.log('  Fix the DB / re-run step_3i, then restart to load live data.\x1b[0m');
        return false;
      };
      pr.get_bootstrap()
        .then(function (r) {
          if (announce(r, false)) return;                 // already live
          setTimeout(function () { pr.get_bootstrap().then(function (r2) { announce(r2, true); }).catch(function () {}); }, 12000);
        })
        .catch(function (e) { console.warn('\x1b[31m  [data] participation warm-up failed: ' + e.message + '\x1b[0m'); });
    } catch (e) { /* ignore */ }
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set REPORTING_PORT.');
    else console.error(e);
  });
  return server;
}

if (require.main === module) start_server();

module.exports = { create_app, start_server };
