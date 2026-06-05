#!/usr/bin/env node
/**
 * server_race_results_transform_8018.js — static host for the race-results
 * reformatter web app.
 *
 * Lives at the repo root alongside the other server_*.js services for naming
 * consistency. Port 8018 follows the existing sequence
 * (8014 auto_renew, 8015 scraper, 8016 event_analysis, 8017 sf_duplicates).
 *
 * This server does NO processing. The entire transform runs client-side in the
 * browser (src/race_results_transform/public/), so uploaded race files — which
 * contain member PII (DOB, email, address) — never leave the user's machine.
 * The server only serves static files, exactly like the /editor mount in
 * server_event_analysis_8016.js. Expose it through the same Cloudflare tunnel
 * you point at port 8016.
 *
 * Usage:
 *   node server_race_results_transform_8018.js          # default port 8018
 *   PORT=9000 node server_race_results_transform_8018.js
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
// Load the repo-root .env (where NGROK_AUTHTOKEN lives) regardless of the
// working directory — the menu launches this from the project subfolder.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

// NGROK TUNNEL — exposes a real public URL for testing/sharing, exactly like
// the other server_*.js services (e.g. 8017). Set false to run local-only.
// Needs NGROK_AUTHTOKEN in the environment (authtoken_from_env).
const is_test_ngrok = true;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

const DEFAULT_PORT = Number(process.env.PORT) || Number(process.env.RACE_RESULTS_PORT) || 8018;
const PUBLIC_DIR = path.join(__dirname, 'src', 'race_results_transform', 'public');

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache so app.js / index.html edits show up on reload.
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'race_results_transform', time: new Date().toISOString() });
  });

  // Serve the shared core modules (src/, single source of truth, also used by
  // the CLI + tests) so the browser <script> tags can load them.
  app.use('/src', express.static(path.join(__dirname, 'src', 'race_results_transform', 'src')));

  // Static SPA. http://localhost:8018/ serves index.html.
  app.use('/', express.static(PUBLIC_DIR));

  app.use(function (req, res) {
    res.status(404).json({ error: 'not found', path: req.path });
  });

  return app;
}

function start_server(opts) {
  opts = opts || {};
  const port = opts.port || DEFAULT_PORT;
  const app = create_app();
  return new Promise(function (resolve, reject) {
    const server = app.listen(port, function () {
      const actual = server.address().port;
      if (!opts.silent) {
        console.log('\nRace Results Transform — local server');
        console.log('  -> http://localhost:' + actual + '/                 (web app)');
        console.log('  -> http://localhost:' + actual + '/api/status       (health check)');
        console.log('  Serving: ' + PUBLIC_DIR);
        console.log('  Press Ctrl-C to stop.\n');
      }
      // NGROK TUNNEL — best-effort. Prints "Ingress established at: https://...".
      // A missing/invalid NGROK_AUTHTOKEN must NOT crash the local server, so we
      // catch the (otherwise unhandled) async rejection from create_ngrok_tunnel.
      if (is_test_ngrok) {
        process.once('unhandledRejection', function (err) {
          var msg = (err && (err.errorCode || err.message)) || String(err);
          console.log('\n  [ngrok] tunnel not started: ' + msg);
          console.log('  The local server above keeps running. To get a public URL, set');
          console.log('  NGROK_AUTHTOKEN (https://dashboard.ngrok.com/get-started/your-authtoken),');
          console.log('  or set is_test_ngrok=false at the top of this file to skip ngrok.\n');
        });
        create_ngrok_tunnel(actual);
      }
      resolve({ port: actual, server: server });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start_server({ port: DEFAULT_PORT }).catch(function (err) {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

module.exports = { create_app: create_app, start_server: start_server, DEFAULT_PORT: DEFAULT_PORT };
