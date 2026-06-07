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
const crypto = require('crypto');

// ---- Usage analytics (best-effort; PII never leaves the browser) -----------
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('./utilities/config');
const { make_event_ingest, fmt_in_tz } = require('./utilities/analytics/event_ingest');
const { ensure_table, ensure_columns } = require('./utilities/analytics/ensure_table');
const metrics_config = require('./src/race_results_transform/metrics/metrics_config');
const { query_create_race_results_transform_events_table } =
  require('./src/queries/create_drop_db_table/query_create_race_results_transform_events_table');
const metrics_report = require('./src/race_results_transform/metrics/metrics_report');
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
    await ensure_table(metrics_pool, require('./src/race_results_transform/metrics/ask/ask_log').DDL);
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
  app.use(express.urlencoded({ extended: false }));
  app.post('/api/event', make_event_ingest({ pool: pool_proxy, table: metrics_config.TABLE, columns: metrics_config.COLUMNS, reporting_tz: metrics_config.REPORTING_TZ }));
  // Serve the shared generic analytics browser client (UsageMetrics) as a static asset.
  app.use('/analytics', express.static(path.join(__dirname, 'utilities', 'analytics')));

  // Slack usage digest — hit by the cron_get_slack_race_results_transform job.
  // Same cron -> route -> slack_message_api convention as the other slack jobs.
  // ---- Read-only metrics dashboard auth (form login + signed session cookie) --
  // A login form (GET/POST /metrics/login) validates the configured user/pass and
  // sets a short-lived SIGNED session cookie (HMAC of the password; 12h TTL). The
  // cookie is the ONLY gate, so /metrics/logout TRULY logs the user out (the next
  // visit redirects back to the login form). No HTTP Basic (which browsers cache and
  // can't be cleared). Fail-closed if the dashboard user/pass aren't set.
  const SESSION_COOKIE = 'mx_session';
  const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // 12h absolute expiry
  function dash_creds() {
    return { user: process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_USER, pass: process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_PASS };
  }
  function sign_session(exp) {
    return exp + '.' + crypto.createHmac('sha256', 'mx|' + (dash_creds().pass || '')).update(String(exp)).digest('base64url');
  }
  function valid_session(token) {
    if (!token) return false;
    const dot = token.indexOf('.'); if (dot < 0) return false;
    const exp = Number(token.slice(0, dot));
    if (!exp || Date.now() > exp) return false;
    const want = sign_session(exp);
    return token.length === want.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want));
  }
  function read_cookie(req, name) {
    const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function login_html(err) {
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>Sign in — Metrics</title>'
      + '<style>body{font:16px system-ui,Arial,sans-serif;background:#0e1b3a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}'
      + 'form{background:#16233f;padding:24px;border-radius:12px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.4)}'
      + 'h1{font-size:18px;margin:0 0 14px}input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border-radius:8px;border:1px solid #2a3a5e;background:#0e1b3a;color:#fff}'
      + 'button{width:100%;padding:10px;border:0;border-radius:8px;background:#e4002b;color:#fff;font-weight:700;cursor:pointer;margin-top:6px}.err{color:#ff8a8a;font-size:13px;margin:0 0 6px}</style>'
      + '<form method="post" action="/metrics/login">'
      + '<h1>\uD83D\uDCCA Metrics \u2014 Sign in</h1>'
      + (err ? '<p class="err">' + err + '</p>' : '')
      + '<input name="username" placeholder="Username" autofocus autocomplete="username">'
      + '<input name="password" type="password" placeholder="Password" autocomplete="current-password">'
      + '<button type="submit">Sign in</button></form>';
  }
  function require_dash_auth(req, res, next) {
    const c = dash_creds();
    if (!c.user || !c.pass) { res.status(503).send('Dashboard not configured (set RACE_RESULTS_CONVERTER_METRICS_DASH_USER / RACE_RESULTS_CONVERTER_METRICS_DASH_PASS).'); return; }
    if (valid_session(read_cookie(req, SESSION_COOKIE))) return next();   // valid session cookie = the only gate
    if (req.path.indexOf('/api') === 0) return res.status(401).json({ ok: false, error: 'not authenticated' });
    return res.redirect('/metrics/login');
  }
  app.get('/metrics/login', function (req, res) {
    if (valid_session(read_cookie(req, SESSION_COOKIE))) return res.redirect('/metrics');
    res.type('html').send(login_html(''));
  });
  app.post('/metrics/login', function (req, res) {
    const c = dash_creds();
    if (!c.user || !c.pass) { res.status(503).send('Dashboard not configured.'); return; }
    const u = (req.body && req.body.username) || '', pw = (req.body && req.body.password) || '';
    if (u === c.user && pw === c.pass) {
      res.cookie(SESSION_COOKIE, sign_session(Date.now() + SESSION_TTL_MS), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS });
      return res.redirect('/metrics');
    }
    res.status(401).type('html').send(login_html('Invalid username or password.'));
  });
  app.get('/metrics/logout', function (req, res) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/metrics/login');   // truly logged out: next /metrics hit shows the login form
  });
  const DASHBOARD_HTML = path.join(__dirname, 'src', 'race_results_transform', 'metrics', 'metrics_dashboard.html');
  app.get('/metrics', require_dash_auth, function (req, res) {
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
  app.get('/api/metrics-report', require_dash_auth, async function (req, res) {
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

  // AI "ask your data" — read-only natural-language query over the events table (auth-gated).
  app.get('/api/metrics-ask-models', require_dash_auth, function (req, res) {
    try { res.json(require('./src/race_results_transform/metrics/ask/models').list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/metrics-ask', require_dash_auth, async function (req, res) {
    const ask_mod = require('./src/race_results_transform/metrics/ask/ask');
    const ask_log = require('./src/race_results_transform/metrics/ask/ask_log');
    // Raw-SQL mode: input is treated as SQL and run directly (guarded read-only) -- no LLM.
    if (req.body && req.body.mode === 'sql') {
      const raw = String((req.body && req.body.sql) || '').slice(0, 4000).trim();
      if (!raw) return res.status(400).json({ ok: false, error: 'no sql' });
      try {
        const r = await ask_mod.ask_sql(raw);
        ask_log.append(metrics_pool, { surface: 'dashboard-sql', question: raw, provider: 'sql', model: null, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer });
        return res.json(r);
      } catch (e) {
        ask_log.append(metrics_pool, { surface: 'dashboard-sql', question: raw, provider: 'sql', model: null, sql: raw, ok: false, row_count: 0, answer: e.message });
        return res.status(400).json({ ok: false, error: e.message });
      }
    }
    try {
      const question = String((req.body && req.body.question) || '').slice(0, 500).trim();
      if (!question) return res.status(400).json({ ok: false, error: 'no question' });
      const r = await ask_mod.ask(question, { provider: req.body.provider, model: req.body.model });
      ask_log.append(metrics_pool, { surface: 'dashboard', question: question, provider: r.provider, model: r.model, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer });
      res.json(r);
    } catch (e) {
      console.error('[ask] error:', e.message);
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
