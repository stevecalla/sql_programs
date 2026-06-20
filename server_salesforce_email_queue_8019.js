#!/usr/bin/env node
/**
 * server_salesforce_email_queue_8019.js — web host for the Salesforce Email
 * Queue Assistant (read-only proof of concept).
 *
 * Lives at the repo root alongside the other server_*.js services for naming
 * consistency. Port 8019 follows the existing sequence
 * (8016 event_analysis, 8017 sf_duplicates, 8018 race_results_transform).
 *
 * Patterned after server_race_results_transform_8018.js for consistency:
 *   - create_app() builds the Express app (cors, no-cache, health, API, static SPA)
 *   - start_server() listens with NO host arg -> dual-stack '::' (accepts BOTH IPv6
 *     ::1 and IPv4 127.0.0.1). This matters for the Cloudflare tunnel: when it dials
 *     'localhost:8019' on Windows that resolves to ::1, so an IPv4-only bind (0.0.0.0)
 *     would 502. 8018 works because it binds dual-stack the same way.
 *   - optional ngrok tunnel (off by default, same as 8018)
 *
 * Public URL (production): https://usat-email.kidderwise.org  (Cloudflare tunnel -> 8019)
 *
 * Read-only: nothing is written/sent to Salesforce. The /api/send route is 403.
 *
 * Usage:
 *   node server_salesforce_email_queue_8019.js        # default port 8019
 *   EQ_PORT=9000 node server_salesforce_email_queue_8019.js
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
// Load the repo-root .env (SF_PROD_*, OPENAI/ANTHROPIC keys, NGROK_AUTHTOKEN) regardless of the
// working directory — the menu launches this from the project subfolder.
const ENV_PATH = path.join(__dirname, '.env');
dotenv.config({ path: ENV_PATH });
(function () {
  const exists = require('fs').existsSync(ENV_PATH);
  const have_sf = !!(process.env.SF_PROD_USERNAME || process.env.SF_DEV_USERNAME);
  const have_ai = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const have_login = !!((process.env.SF_EMAIL_QUEUE_ADMIN_USER && process.env.SF_EMAIL_QUEUE_ADMIN_PASS) || (process.env.SF_EMAIL_QUEUE_USER && process.env.SF_EMAIL_QUEUE_PASS));
  console.log('[env] .env path: ' + ENV_PATH + ' (exists: ' + exists + ')');
  console.log('[env] Salesforce configured: ' + have_sf + '  |  AI key configured: ' + have_ai + '  |  login configured: ' + have_login);
  if (!have_login) console.log('[env] -> set SF_EMAIL_QUEUE_ADMIN_USER/PASS (and/or SF_EMAIL_QUEUE_USER/PASS) in ' + ENV_PATH + ', then restart.');
})();

const express = require('express');
const cors = require('cors');

// NGROK TUNNEL — optional public URL, exactly like server_race_results_transform_8018.js.
// Off by default (Cloudflare fronts this app). Set true / NGROK_AUTHTOKEN to use it.
const is_test_ngrok = false;
let ngrok_url = null;
let ngrok_enabled_flag = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

const DEFAULT_PORT = Number(process.env.EQ_PORT) || 8019;
const POC = path.join(__dirname, 'src', 'salesforce_email_queue_proof_of_concept');
const PUBLIC_DIR = path.join(POC, 'web', 'public');
const mount = require(path.join(POC, 'web', 'routes'));
const faq = require(path.join(POC, 'ai', 'faq'));   // for one-time sample-context seeding

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache so index.html edits show up on reload (same as 8018).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // Lightweight request log; flags the app root '/' so you can confirm the tunnel reaches this process.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    if (req.path === '/') console.log('[' + ts + '] GET / -> web app (index.html)  host=' + (req.headers.host || '?'));
    else console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'salesforce_email_queue', time: new Date().toISOString() });
  });

  // JSON API (login/logout public; the rest auth-gated; no Salesforce writes). Body parser inside.
  app.use(express.json({ limit: '50mb' }));
  mount(app);

  // Static SPA. http://localhost:8019/ serves index.html.
  app.use('/', express.static(PUBLIC_DIR));

  app.use(function (req, res) { res.status(404).json({ ok: false, error: 'not found', path: req.path }); });
  app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ ok: false, error: 'request too large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    console.error('[server] error:', (err && err.message) || err);
    return res.status((err && (err.status || err.statusCode)) || 500).json({ ok: false, error: (err && err.message) || 'server error' });
  });

  return app;
}

function start_server(opts) {
  opts = opts || {};
  const port = opts.port || DEFAULT_PORT;
  const app = create_app();
  faq.seed_sample_context().then(function (r) {
    if (r && r.seeded) console.log('[context] external context folder ready: ' + r.dir);
    else console.log('[context] could NOT write the external context folder: ' + (r && r.error) + ' (set EQ_CONTEXT_DIR to a writable path)');
  });
  return new Promise(function (resolve, reject) {
    // NB: no host arg -> dual-stack '::' (IPv6 + IPv4). See header note re: Cloudflare/Windows.
    const server = app.listen(port, function () {
      const actual = server.address().port;
      if (!opts.silent) {
        console.log('\nSalesforce Email Queue Assistant - local server');
        console.log('  -> http://localhost:' + actual + '/                 (web app - read-only)');
        console.log('  -> http://localhost:' + actual + '/api/status        (health check)');
        console.log('  -> https://usat-email.kidderwise.org' + '            (internet access via Cloudflare tunnel)');
        console.log('  Serving: ' + PUBLIC_DIR);
        console.log('  Waiting for requests - one log line per request below. Press Ctrl-C to stop.\n');
      }
      // NGROK - best-effort; a missing/invalid NGROK_AUTHTOKEN must NOT crash the local server.
      if (is_test_ngrok || ngrok_enabled_flag) {
        process.once('unhandledRejection', function (err) {
          console.log('\n  [ngrok] tunnel not started: ' + ((err && (err.errorCode || err.message)) || String(err)));
          console.log('  The local server above keeps running. Set NGROK_AUTHTOKEN to get a public ngrok URL.\n');
        });
        create_ngrok_tunnel(actual).then(function (u) { if (u) { ngrok_url = u; console.log('  [ngrok] public URL: ' + u); } });
      } else {
        console.log('  [ngrok] tunnel disabled (Cloudflare fronts this app).');
      }
      resolve({ port: actual, server: server });
    });
    server.on('error', function (e) {
      if (e && e.code === 'EADDRINUSE') console.error('PORT ' + port + ' is already in use - stop the other process or set EQ_PORT.');
      reject(e);
    });
  });
}

// Clean up on exit - same pattern as the other server_*.js services so Ctrl-C actually stops the
// process (without this the open listener keeps the event loop alive and the terminal hangs).
async function cleanup() { console.log('\nGracefully shutting down...'); process.exit(); }
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
// Windows fallback: some terminals don't deliver process-level SIGINT on Ctrl-C; a readline
// interface catches the keystroke and emits its own SIGINT, which we forward to cleanup().
if (require.main === module && process.stdin.isTTY) {
  require('readline').createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', cleanup);
}

if (require.main === module) {
  start_server().catch(function (e) { console.error('Failed to start: ' + ((e && e.message) || e)); process.exit(1); });
}

module.exports = { create_app, start_server };