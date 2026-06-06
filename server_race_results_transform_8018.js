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

// ---- Usage analytics (best-effort; PII never leaves the browser) -----------
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('./utilities/config');
const { make_event_ingest, fmt_in_tz } = require('./utilities/analytics/event_ingest');
const { ensure_table, ensure_columns } = require('./utilities/analytics/ensure_table');
const metrics_config = require('./src/race_results_transform/metrics_config');
const { query_create_race_results_transform_events_table } =
  require('./src/queries/create_drop_db_table/query_create_race_results_transform_events_table');
const metrics_report = require('./src/race_results_transform/metrics_report');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

const METRICS_ON = String(process.env.METRICS_OFF).toLowerCase() !== 'true';
let metrics_pool = null;
// Proxy so the ingest handler always reads the current pool (created async at startup).
const pool_proxy = { query: function () {
  if (!metrics_pool) return Promise.reject(new Error('analytics pool not ready'));
  return metrics_pool.query.apply(metrics_pool, arguments);
} };
async function init_metrics() {
  if (!METRICS_ON) { console.log('  [analytics] disabled via METRICS_OFF'); return; }
  try {
    const cfg = await local_usat_sales_db_config();
    metrics_pool = mysql.createPool(cfg);
    const ddl = await query_create_race_results_transform_events_table(metrics_config.TABLE);
    await ensure_table(metrics_pool, ddl);
    // migrate already-created tables that predate newer columns (CREATE IF NOT EXISTS won't add them)
    await ensure_columns(metrics_pool, metrics_config.TABLE, [
      { name: 'page_path', ddl: 'page_path VARCHAR(255)', after: 'event_name' }
    ]);
    console.log('  [analytics] events table ready (' + metrics_config.TABLE + ')');
  } catch (e) {
    console.log('  [analytics] disabled — DB not available: ' + e.message);
    metrics_pool = null;
  }
}

// NGROK TUNNEL — exposes a real public URL for testing/sharing, exactly like
// the other server_*.js services (e.g. 8017). Set false to run local-only.
// Needs NGROK_AUTHTOKEN in the environment (authtoken_from_env).
const is_test_ngrok = false;
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

  // Usage analytics — fire-and-forget. Counts/enums only; no-ops if no DB pool.
  app.use(express.json({ limit: '16kb' }));
  app.post('/api/event', make_event_ingest({ pool: pool_proxy, table: metrics_config.TABLE, columns: metrics_config.COLUMNS, reporting_tz: metrics_config.REPORTING_TZ }));
  // Serve the shared generic analytics browser client (UsageMetrics) as a static asset.
  app.use('/analytics', express.static(path.join(__dirname, 'utilities', 'analytics')));

  // Slack usage digest — hit by the cron_get_slack_race_results_transform job.
  // Same cron -> route -> slack_message_api convention as the other slack jobs.
  // ---- Read-only metrics dashboard (Basic Auth; fail-closed if unconfigured) --
  function basic_auth(req, res, next) {
    const user = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_USER, pass = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_PASS;
    if (!user || !pass) { res.status(503).send('Dashboard not configured (set RACE_RESULTS_CONVERTER_METRICS_DASH_USER / RACE_RESULTS_CONVERTER_METRICS_DASH_PASS).'); return; }
    const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
    if (m) {
      const parts = Buffer.from(m[1], 'base64').toString().split(':');
      if (parts[0] === user && parts.slice(1).join(':') === pass) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="race_results_metrics"').status(401).send('Authentication required.');
  }
  const DASHBOARD_HTML = path.join(__dirname, 'src', 'race_results_transform', 'metrics_dashboard.html');
  app.get('/metrics', basic_auth, function (req, res) {
    // record one dashboard_view per page open (best-effort; excluded from "visits")
    if (metrics_pool && !req.headers['x-metrics-test']) {
      const now = new Date();
      metrics_pool.query(
        'INSERT INTO `' + metrics_config.TABLE + '` (app, event_name, page_path, created_at_utc, created_at_mtn) VALUES (?, ?, ?, ?, ?)',
        [metrics_config.APP, 'dashboard_view', (req.originalUrl || req.path || '/metrics').slice(0, 255), fmt_in_tz(now, 'UTC'), fmt_in_tz(now, metrics_config.REPORTING_TZ)]
      ).catch(function (e) { console.error('[analytics] dashboard_view log error:', e.message); });
    }
    res.type('html').sendFile(DASHBOARD_HTML);
  });
  app.get('/api/metrics-report', basic_auth, async function (req, res) {
    try {
      if (!metrics_pool) return res.status(503).json({ ok: false, error: 'analytics DB not available' });
      const days = Number(req.query.days) || 7;
      const report = await metrics_report.build_report(metrics_pool, { days: days });
      res.json(report.data);
    } catch (e) {
      console.error('[analytics] report error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/scheduled-slack-race-results-metrics', async function (req, res) {
    try {
      if (!metrics_pool) return res.status(503).json({ ok: false, error: 'analytics DB not available' });
      const days = Number(req.query.days) || 7;
      const blocks = await metrics_report.report_blocks(metrics_pool, { days: days });
      const text = await metrics_report.report_text(metrics_pool, { days: days });
      await slack_message_api(text, 'race_results_slack_channel', blocks);
      res.json({ ok: true, sent: true, days: days });
    } catch (e) {
      console.error('[analytics] slack digest error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
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
  if (require.main === module) { init_metrics(); }   // skip DB in unit tests that import create_app
  return new Promise(function (resolve, reject) {
    const server = app.listen(port, function () {
      const actual = server.address().port;
      if (!opts.silent) {
        console.log('\nRace Results Transform \u2014 local server');
        console.log('  -> http://localhost:' + actual + '/                 (web app)');
        console.log('  -> http://localhost:' + actual + '/api/status       (health check)');
        console.log('  -> https://usat-converter.kidderwise.org' + '       (internet access)');
        console.log('  Serving: ' + PUBLIC_DIR);
        console.log('  Press Ctrl-C to stop.\n');
      }
      // NGROK TUNNEL \u2014 best-effort. Prints "Ingress established at: https://...".
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

// Clean up on exit \u2014 same pattern as the other server_*.js services so Ctrl-C
// actually stops the process (without this the open listener + live mysql2 pool
// keep the event loop alive and the terminal appears to hang).
async function cleanup() {
  console.log('\nGracefully shutting down...');
  process.exit();
}

// Handle termination signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Windows fallback: some terminals (notably the VS Code integrated terminal) don't
// reliably deliver a process-level 'SIGINT' on Ctrl-C, so the handler above may never
// fire. A readline interface catches the Ctrl-C *keystroke* at the input layer and
// emits its own 'SIGINT', which we forward to cleanup(). Only when run directly with
// an interactive TTY (not under the test runner or when piped).
if (require.main === module && process.stdin.isTTY) {
  require('readline')
    .createInterface({ input: process.stdin, output: process.stdout })
    .on('SIGINT', cleanup);
}

if (require.main === module) {
  start_server({ port: DEFAULT_PORT }).catch(function (err) {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}
