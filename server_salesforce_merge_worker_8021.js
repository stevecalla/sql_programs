#!/usr/bin/env node
/**
 * server_salesforce_merge_worker_8021.js — Salesforce merge worker (Phase 3).
 *
 * Lives at the repo root beside the other server_*.js services (port 8021 was reporting, retired).
 * Mirrors server_salesforce_merge_8020.js so it reads/behaves like the rest of the fleet:
 *   - create_app() builds a small Express app (cors, no-cache, one-line request log, /api/status health)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 + IPv4) AND starts the queue-drain
 *     loop that claims queued `salesforce_merge_run` rows and runs merge/restore/recreate OUT of the
 *     usat_apps web process. Destructive Salesforce writes run HERE, never in the web tier.
 *
 * Multi-worker safe (atomic DB claim) — scale with pm2 `instances`. Env comes from the repo-root .env
 * (SF_* creds, LOCAL_MYSQL_*). Real writes require MERGE_ENABLE_EXECUTION=true; otherwise it simulates.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
// Repo-root .env (LOCAL_MYSQL_*, SF_* creds, MERGE_ENABLE_EXECUTION) regardless of cwd.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const loop = require('./src/salesforce_merge_worker/loop');

const DEFAULT_PORT = Number(process.env.MERGE_WORKER_PORT) || 8021;

function create_app() {
  const app = express();
  app.use(cors());

  // No-cache (same as 8020).
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // One log line per call (same pattern as 8020).
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Health — same /api/status shape the other services expose, so Ops/pm2 see it uniformly. Also
  // reports the live worker state (running, current run, counts).
  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'salesforce_merge_worker', pid: process.pid,
      execution_enabled: String(process.env.MERGE_ENABLE_EXECUTION) === 'true', worker: loop.info(), time: new Date().toISOString() });
  });

  app.get('/', function (req, res) {
    res.type('html').send('<h1>Salesforce Merge worker</h1>' +
      '<p>Background process — drains queued <code>salesforce_merge_run</code> rows and runs merge/restore ' +
      'out of the web tier. Health: <a href="/api/status">/api/status</a>.</p>');
  });

  return app;
}

// NGROK — disabled for a background worker (no public URL). Kept explicit for parity with the fleet.
const ngrok_enabled_flag = false;

function start_server(port) {
  const p = port || DEFAULT_PORT;
  const app = create_app();
  // No host arg -> dual-stack bind (IPv6 + IPv4), matching the other servers.
  const server = app.listen(p, function () {
    const actual = server.address().port;
    console.log('\nSalesforce Merge worker - local process');
    console.log('  -> http://localhost:' + actual + '/api/status        (health check)');
    console.log('  draining queued salesforce_merge_run rows (kind merge/restore/recreate).');
    console.log('  execution ' + (String(process.env.MERGE_ENABLE_EXECUTION) === 'true'
      ? 'ENABLED (real Salesforce writes)'
      : 'disabled (simulate only) — set MERGE_ENABLE_EXECUTION=true to arm.'));
    console.log('  [ngrok] tunnel disabled (background worker — no public URL).');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');
    loop.start();
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set MERGE_WORKER_PORT.');
    else console.error(e);
  });

  // Clean shutdown: stop the drain loop, close the server, exit (with a hard-timeout safety net).
  function shutdown(sig) {
    console.log('\n[merge_worker] ' + sig + ' — stopping loop and closing server...');
    loop.stop();
    try { server.close(function () { console.log('[merge_worker] stopped.'); process.exit(0); }); }
    catch (e) { process.exit(0); }
    setTimeout(function () { process.exit(0); }, 8000).unref();
  }
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });
  process.on('SIGINT', function () { shutdown('SIGINT'); });

  return server;
}

if (require.main === module) start_server();

module.exports = { create_app, start_server };
