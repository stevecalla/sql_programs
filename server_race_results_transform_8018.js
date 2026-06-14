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
const ENV_PATH = path.join(__dirname, '.env');
dotenv.config({ path: ENV_PATH });
// Startup diagnostic (no secrets printed): tells you, in the pm2/prod logs, exactly where .env was
// looked for and whether the dashboard/Salesforce login is actually configured in THIS process.
(function () {
  const exists = require('fs').existsSync(ENV_PATH);
  const have_dash = !!(process.env.RACE_RESULTS_CONVERTER_METRICS_USER && process.env.RACE_RESULTS_CONVERTER_METRICS_PASS);
  const have_sf = !!(process.env.SF_PROD_USERNAME || process.env.SF_DEV_USERNAME);
  console.log('[env] .env path: ' + ENV_PATH + ' (exists: ' + exists + ')');
  console.log('[env] dashboard login configured: ' + have_dash + '  ·  Salesforce configured: ' + have_sf);
  if (!have_dash) console.log('[env] → set RACE_RESULTS_CONVERTER_METRICS_USER and RACE_RESULTS_CONVERTER_METRICS_PASS in ' + ENV_PATH + ', then restart.');
})();

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
      { name: 'page_path', ddl: 'page_path VARCHAR(255)', after: 'event_name' },
      // is_demo: 1 when the event came from the built-in "Try me" sample (fake data), else 0/NULL
      { name: 'is_demo', ddl: 'is_demo TINYINT(1)', after: 'error_type' },
      // is_test: 1 when a deliberate test run (browser opened with ?metrics_test=1) — purgeable via metrics:purge-test
      { name: 'is_test', ddl: 'is_test TINYINT(1)', after: 'is_demo' },
      // source: where the file came from — 'upload' | 'try_me' | 'salesforce'
      { name: 'source', ddl: 'source VARCHAR(16)', after: 'is_test' }
    ]);
    await ensure_table(metrics_pool, require('./src/race_results_transform/metrics/ask/ask_log').DDL);
    await ensure_table(metrics_pool, require('./src/race_results_transform/metrics/ask/corrections').DDL);
    await ensure_columns(metrics_pool, require('./src/race_results_transform/metrics/ask/ask_log').TABLE, require('./src/race_results_transform/metrics/ask/ask_log').MIGRATE_COLUMNS);
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
// Module-scope ngrok state so BOTH the inner route setup and the top-level listen() block can see it.
let ngrok_url = null;            // the live public URL once the tunnel is established (else null)
let ngrok_enabled_flag = false;  // mirror of the ngrok_enabled config; set in apply_config_overrides()
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

  // The auth-gated dashboard "ask" routes carry a few turns of conversation context, so they need a
  // larger JSON body than the deliberately-tight public /api/event ingest. Mounted BEFORE the global
  // 16kb parser so these paths parse first; body-parser then sees req._body and the 16kb parser skips
  // them. Everything else stays capped at 16kb.
  app.use(['/api/metrics-ask', '/api/metrics-ask-correct'], express.json({ limit: '512kb' }));
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
  // ---- editable overrides store (config + extra users/passwords, layered over .env). Gitignored JSON. ----
  const admin_store = require('./src/race_results_transform/admin/admin_store');
  const OVERRIDES_FILE = process.env.ADMIN_OVERRIDES_FILE || path.join(__dirname, 'admin_overrides.json');
  let overrides = admin_store.load_or_init(OVERRIDES_FILE);
  // Apply non-secret config overrides onto process.env (override wins) so the engines pick them up live.
  function apply_config_overrides() {
    const c = admin_store.get_config(overrides);
    if (c.slack_default_channel) process.env.SLACK_CHANNEL_ID = c.slack_default_channel;
    // HIDE-list: channels the END USER should NOT see in the Slack picker (empty = show all; new channels
    // are visible by default until explicitly hidden here).
    process.env.SLACK_HIDDEN_CHANNELS = c.slack_hidden_channels || '';
    process.env.SLACK_BOT_HANDLE = c.slack_bot_handle || '';   // display handle for the /invite + /kick hints
    if (c.slack_file_types) process.env.SLACK_FILE_TYPES = c.slack_file_types;
    if (c.sf_program_object) process.env.SF_PROGRAM_OBJECT = c.sf_program_object;
    ngrok_enabled_flag = (c.ngrok_enabled === 'true');   // read at startup; the tunnel starts in listen()
  }
  apply_config_overrides();
  // ---- /admin ops console: run curated menu.js commands + a live log ring + pm2 stats (all admin-gated) ----
  const console_runner = require('./src/race_results_transform/admin/console_runner');
  const console_registry = require('./src/race_results_transform/admin/console_registry');
  const log_ring = require('./src/race_results_transform/admin/log_ring');
  log_ring.install(console);   // mirror the server's console output into an in-memory ring for the Logs panel
  const PM2_PROCESS_NAME = 'usat_race_results_transform';
  function open_sse(res) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
  }
  // Sessions are signed with a STABLE per-server secret (not the password), so changing a password never
  // logs anyone out. A separate role marker ('mx' app / 'admin') keeps the two cookies distinct.
  function session_secret() { return overrides.session_secret || (process.env.RACE_RESULTS_CONVERTER_METRICS_PASS || 'fallback'); }
  function dash_creds() {
    return { user: process.env.RACE_RESULTS_CONVERTER_METRICS_USER, pass: process.env.RACE_RESULTS_CONVERTER_METRICS_PASS };
  }
  function sign_session(exp) {
    return exp + '.' + crypto.createHmac('sha256', session_secret()).update('mx|' + exp).digest('base64url');
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
  function login_html(err, action, title) {
    const act = action || '/admin/login';
    const ttl = title || 'Admin';
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>Sign in — ' + ttl + '</title>'
      + '<style>body{font:16px system-ui,Arial,sans-serif;background:#0e1b3a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}'
      + 'form{background:#16233f;padding:24px;border-radius:12px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.4)}'
      + 'h1{font-size:18px;margin:0 0 14px}input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border-radius:8px;border:1px solid #2a3a5e;background:#0e1b3a;color:#fff}'
      + 'button{width:100%;padding:10px;border:0;border-radius:8px;background:#e4002b;color:#fff;font-weight:700;cursor:pointer;margin-top:6px}.err{color:#ff8a8a;font-size:13px;margin:0 0 6px}</style>'
      + '<form method="post" action="' + act + '">'
      + '<h1>\uD83D\uDD12 ' + ttl + ' \u2014 Sign in</h1>'
      + (err ? '<p class="err">' + err + '</p>' : '')
      + '<input name="username" placeholder="Username" autofocus autocomplete="username">'
      + '<input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password">'
      + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:2px 0 4px;cursor:pointer">'
      + '<input type="checkbox" style="width:auto;margin:0" onclick="document.getElementById(\'pw\').type=this.checked?\'text\':\'password\'"> Show password</label>'
      + '<button type="submit">Sign in</button></form>';
  }
  // ---- Admin auth: a SEPARATE login gating /metrics + /admin, distinct from the app/intake login.
  // Admin creds default to RACE_RESULTS_ADMIN_USER/_PASS; if those aren't set, fall back to the metrics
  // creds so an existing deploy keeps working until the new vars are added. Own cookie (admin_session).
  const ADMIN_COOKIE = 'admin_session';
  function admin_creds() {
    return {
      user: process.env.RACE_RESULTS_ADMIN_USER || process.env.RACE_RESULTS_CONVERTER_METRICS_USER,
      pass: process.env.RACE_RESULTS_ADMIN_PASS || process.env.RACE_RESULTS_CONVERTER_METRICS_PASS
    };
  }
  // true only when a DEDICATED admin credential is configured (not just the metrics fallback).
  function admin_creds_dedicated() { return !!(process.env.RACE_RESULTS_ADMIN_USER && process.env.RACE_RESULTS_ADMIN_PASS); }
  // The admin cookie carries the signed-in USERNAME so each gate can look up that user's capabilities
  // (which areas they may reach). Per-user access is set in /admin → Access.
  function sign_admin(exp, user) {
    user = user || '';
    return exp + '|' + Buffer.from(user).toString('base64url') + '.' + crypto.createHmac('sha256', session_secret()).update('admin|' + user + '|' + exp).digest('base64url');
  }
  function admin_session_user(token) {   // -> username if the cookie is valid + unexpired, else null
    if (!token) return null;
    const dot = token.indexOf('.'); if (dot < 0) return null;
    const head = token.slice(0, dot); const bar = head.indexOf('|'); if (bar < 0) return null;
    const exp = Number(head.slice(0, bar));
    if (!exp || Date.now() > exp) return null;
    let user; try { user = Buffer.from(head.slice(bar + 1), 'base64url').toString(); } catch (e) { return null; }
    const want = sign_admin(exp, user);
    if (token.length !== want.length) return null;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want)) ? user : null;
  }
  function valid_admin_session(token) { return admin_session_user(token) !== null; }
  function set_admin_cookie(res, user) {
    res.cookie(ADMIN_COOKIE, sign_admin(Date.now() + SESSION_TTL_MS, user || ''), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS });
  }
  // Capabilities for a user. The .env recovery accounts are always full / intake (so you can't lock yourself out).
  function caps_for(user) {
    if (!user) return [];
    if (user === admin_creds().user) return admin_store.ALL_CAPS.slice();   // .env admin = full access (recovery)
    if (user === dash_creds().user) return ['metrics', 'intake'];            // .env converter-metrics account = dashboard + intake (not /admin)
    return admin_store.user_caps(overrides, user);
  }
  function req_caps(req) { return caps_for(admin_session_user(read_cookie(req, ADMIN_COOKIE))); }
  // Validate a login against the .env recovery accounts OR any stored user. Returns the username, or null.
  function authenticate(u, pw) {
    const ac = admin_creds(), dc = dash_creds();
    if (ac.user && ac.pass && u === ac.user && String(pw) === String(ac.pass)) return ac.user;
    if (dc.user && dc.pass && u === dc.user && String(pw) === String(dc.pass)) return dc.user;
    const rec = admin_store.valid_user(overrides, u, pw);
    return rec ? rec.user : null;
  }
  function auth_not_configured() { return (!admin_creds().user || !admin_creds().pass) && (!dash_creds().user || !dash_creds().pass); }
  function gate_cap(cap, login_path) {
    return function (req, res, next) {
      const is_api = req.path.indexOf('/api') === 0;
      if (auth_not_configured()) {
        const msg = 'Auth is not configured — set the admin or metrics creds in .env.';
        return is_api ? res.status(503).json({ ok: false, error: msg }) : res.status(503).send(msg);
      }
      if (req_caps(req).indexOf(cap) >= 0) return next();
      if (is_api) return res.status(401).json({ ok: false, error: 'not authorized' });
      return res.redirect(login_path);
    };
  }
  const require_admin_auth = gate_cap('admin', '/admin/login');       // /admin hub + its APIs
  const require_metrics_auth = gate_cap('metrics', '/metrics/login'); // /metrics dashboard + its APIs
  function require_dash_auth(req, res, next) {                        // converter Salesforce/Slack/Folder intake
    const is_api = req.path.indexOf('/api') === 0;
    if (auth_not_configured()) {
      const msg = 'Auth is not configured — set the converter/metrics creds in .env.';
      return is_api ? res.status(503).json({ ok: false, error: msg }) : res.status(503).send(msg);
    }
    if (valid_session(read_cookie(req, SESSION_COOKIE))) return next();   // legacy app session cookie
    if (req_caps(req).indexOf('intake') >= 0) return next();             // admin-cookie user with the intake cap
    if (is_api) return res.status(401).json({ ok: false, error: 'not authenticated' });
    return res.redirect('/metrics/login');
  }
  // /metrics + /admin share the ADMIN login (admin_session). A shared POST handler signs in and
  // redirects to the area the form belongs to.
  function admin_signin_post(req, res, redirect_to) {
    if (auth_not_configured()) { res.status(503).send('Auth not configured.'); return; }
    const u = (req.body && req.body.username) || '', pw = (req.body && req.body.password) || '';
    const user = authenticate(u, pw);
    const needed = redirect_to === '/admin' ? 'admin' : 'metrics';
    const action = redirect_to === '/admin' ? '/admin/login' : '/metrics/login';
    const title = redirect_to === '/admin' ? 'Admin' : 'Metrics';
    if (user && caps_for(user).indexOf(needed) >= 0) { set_admin_cookie(res, user); return res.redirect(redirect_to); }
    const msg = user ? ('This account has no access to ' + title + '.') : 'Invalid username or password.';
    res.status(401).type('html').send(login_html(msg, action, title));
  }
  // When already signed in as a user WITHOUT this area's cap, show the form with a clear message (instead of a
  // blank form or a redirect loop) so they can sign in as an account that does have access.
  function wrong_account_msg(req, area) {
    const u = admin_session_user(read_cookie(req, ADMIN_COOKIE));
    return u ? ('Signed in as "' + u + '", which has no ' + area + ' access. Sign in with an account that does.') : '';
  }
  app.get('/metrics/login', function (req, res) {
    if (req_caps(req).indexOf('metrics') >= 0) return res.redirect('/metrics');   // only bounce if they HAVE the cap
    res.type('html').send(login_html(wrong_account_msg(req, 'Metrics'), '/metrics/login', 'Metrics'));
  });
  app.post('/metrics/login', function (req, res) { admin_signin_post(req, res, '/metrics'); });
  app.get('/admin/login', function (req, res) {
    if (req_caps(req).indexOf('admin') >= 0) return res.redirect('/admin');
    res.type('html').send(login_html(wrong_account_msg(req, 'Admin'), '/admin/login', 'Admin'));
  });
  app.post('/admin/login', function (req, res) { admin_signin_post(req, res, '/admin'); });
  app.get('/admin/logout', function (req, res) { res.clearCookie(ADMIN_COOKIE, { path: '/' }); res.redirect('/admin/login'); });
  // Inline/AJAX login: same session cookie as /metrics/login, but returns JSON and does NOT redirect
  // — lets the app (e.g. the Salesforce panel) sign in in place without leaving the page.
  app.post('/api/login', function (req, res) {
    const u = (req.body && req.body.username) || '', pw = (req.body && req.body.password) || '';
    // The Get-Results panel accepts ANY account in the file. The admin cookie carries the username; the
    // user's capabilities then gate every area (admin only reaches /admin, intake-only reaches the converter).
    const user = authenticate(u, pw);
    if (user) {
      set_admin_cookie(res, user);
      const caps = caps_for(user);
      return res.json({ ok: true, admin: caps.indexOf('admin') >= 0, caps: caps });
    }
    if (auth_not_configured()) return res.status(503).json({ ok: false, error: 'auth not configured' });
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  });
  // Inline/AJAX logout: clears the same session cookie, returns JSON (no redirect). Ends the shared
  // mx_session (so the /metrics dashboard session ends too).
  app.post('/api/logout', function (req, res) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(ADMIN_COOKIE, { path: '/' });   // an admin signed in here too — clear both so Sign out truly ends it
    res.json({ ok: true });
  });
  // Lightweight auth probe (NOT gated). The mx_session cookie is httpOnly, so the browser can't read it;
  // the SF panel calls this on load to show the correct Sign in / Sign out label after a refresh.
  app.get('/api/auth-status', function (req, res) {
    res.json({ ok: true, authed: valid_session(read_cookie(req, SESSION_COOKIE)) || valid_admin_session(read_cookie(req, ADMIN_COOKIE)) });
  });
  app.get('/metrics/logout', function (req, res) {
    res.clearCookie(ADMIN_COOKIE, { path: '/' });
    res.redirect('/metrics/login');   // truly logged out: next /metrics hit shows the login form
  });
  // ---- /admin hub (admin login). Read-only config monitor now; manage/allow-list scaffolded for later. ----
  const ADMIN_HTML = path.join(__dirname, 'src', 'race_results_transform', 'metrics', 'admin.html');
  app.get('/admin', require_admin_auth, function (req, res) { res.type('html').sendFile(ADMIN_HTML); });
  // Config STATUS — booleans (is X configured?), never secret values, never a channel; plus live action counts
  // (how many rows the Purge/Backfill buttons would touch) so the UI can show magnitude + disable when empty.
  app.get('/api/admin-status', require_admin_auth, async function (req, res) {
    const env = process.env;
    let test_rows = null, legacy_source = null;
    if (metrics_pool) {
      try {
        const [tr] = await metrics_pool.query('SELECT SUM(CASE WHEN is_test = 1 THEN 1 ELSE 0 END) n FROM `' + metrics_config.TABLE + '`');
        test_rows = (tr[0] && tr[0].n != null) ? Number(tr[0].n) : 0;
        legacy_source = await metrics_report.count_source(metrics_pool, 'salesforce');
      } catch (e) { /* leave counts null on error */ }
    }
    res.json({
      ok: true,
      admin_dedicated: admin_creds_dedicated(),                       // separate admin creds set (vs metrics fallback)
      app_login: !!(env.RACE_RESULTS_CONVERTER_METRICS_USER && env.RACE_RESULTS_CONVERTER_METRICS_PASS),
      analytics_db: !!metrics_pool,
      salesforce: !!(env.SF_PROD_USERNAME || env.SF_DEV_USERNAME),
      slack: !!env.SLACK_BOT_TOKEN,
      slack_default_channel_set: !!env.SLACK_CHANNEL_ID,              // boolean only — never the channel itself
      ngrok: !!env.NGROK_AUTHTOKEN,                                  // an authtoken is configured
      ngrok_enabled: (is_test_ngrok || ngrok_enabled_flag),          // tunnel is turned on (starts on (re)start)
      ngrok_url: ngrok_url,                                          // the live public URL once established (else null)
      under_pm2: !!process.env.pm_id,                               // running under pm2 (restart/stop available)
      test_rows: test_rows,                                          // rows the Purge button would delete (null = DB off)
      legacy_source: legacy_source                                   // rows the Backfill button would relabel
    });
  });
  // Restart / stop the server from /admin — only meaningful UNDER pm2 (pm2 respawns it). We reply FIRST, then
  // fire pm2 a moment later so the JSON response actually reaches the browser before this process is replaced.
  function pm2_control(action, res) {
    if (!process.env.pm_id) return res.json({ ok: false, error: 'Not running under pm2 — start/stop from the box (pm2 start/restart).' });
    res.json({ ok: true, message: action === 'restart' ? 'Restarting… reconnect in a few seconds.' : 'Stopping… the server will go offline.' });
    setTimeout(function () {
      try { require('child_process').spawn('pm2', [action, PM2_PROCESS_NAME], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref(); }
      catch (e) { console.error('[admin] pm2 ' + action + ' failed: ' + e.message); }
    }, 250);
  }
  app.post('/api/admin-restart', require_admin_auth, function (req, res) { pm2_control('restart', res); });
  app.post('/api/admin-stop', require_admin_auth, function (req, res) { pm2_control('stop', res); });

  // Admin ACTIONS (gated): read-only connection tests + the existing maintenance ops, so /admin actually
  // manages, not just monitors. (Purge-test reuses the admin-gated /api/metrics-purge-test.)
  app.post('/api/admin-test-slack', require_admin_auth, async function (req, res) {
    try {
      const slack = require('./src/race_results_transform/slack');
      const cfg = slack.slack_config({});
      const chk = slack.check_slack_config(cfg);
      if (!chk.ok) return res.json({ ok: false, error: 'Not configured: ' + chk.missing.join(', ') });
      const conn = slack.make_connection(cfg);
      const id = await slack.auth_test(conn);
      const chans = await slack.list_member_channels(conn);
      res.json({ ok: true, message: 'Bot @' + id.user + ' on ' + id.team + ' — in ' + chans.length + ' channel(s).' });
    } catch (e) { res.json({ ok: false, error: (e && e.message) || 'Slack error' }); }
  });
  app.post('/api/admin-test-sf', require_admin_auth, async function (req, res) {
    try {
      const sf = require('./src/race_results_transform/sf');
      const cfg = sf.sf_config({ is_test: !!(req.body && req.body.is_test) });
      const chk = sf.check_sf_config(cfg);
      if (!chk.ok) return res.json({ ok: false, error: 'Not configured: ' + chk.missing.join(', ') });
      await sf.make_connection(cfg);   // a successful login is the connection test
      res.json({ ok: true, message: 'Connected to Salesforce (' + cfg.environment_name + ').' });
    } catch (e) { res.json({ ok: false, error: (e && e.message) || 'Salesforce error' }); }
  });
  app.post('/api/admin-backfill-source', require_admin_auth, async function (req, res) {
    try {
      if (!metrics_pool) return res.json({ ok: false, error: 'analytics DB not available' });
      const was = await metrics_report.count_source(metrics_pool, 'salesforce');
      const r = await metrics_report.backfill_source(metrics_pool, 'salesforce', 'sf_upload_queue');
      res.json({ ok: true, message: 'Relabelled ' + r.updated + ' legacy salesforce row(s) → sf_upload_queue' + (was === 0 ? ' (none to change).' : '.') });
    } catch (e) { res.json({ ok: false, error: (e && e.message) || 'backfill error' }); }
  });
  // ---- editable config + user management (gated). Never returns hashes/secrets; .env users are recovery. ----
  function save_overrides() { try { admin_store.write_overrides(OVERRIDES_FILE, overrides); return true; } catch (e) { return false; } }
  app.get('/api/admin-config', require_admin_auth, function (req, res) {
    const env = process.env;
    const defaults = { slack_default_channel: '', slack_hidden_channels: '', slack_bot_handle: '', slack_file_types: 'xlsx,xls,csv,pptx,ppt', sf_program_object: 'Program', ngrok_enabled: 'false' };
    const cfg = admin_store.get_config(overrides);
    const effective = {                                            // what the engines are actually using right now
      slack_default_channel: env.SLACK_CHANNEL_ID || '',
      slack_hidden_channels: env.SLACK_HIDDEN_CHANNELS || '',       // channels hidden from end users (empty = none)
      slack_bot_handle: env.SLACK_BOT_HANDLE || '',
      slack_file_types: env.SLACK_FILE_TYPES || defaults.slack_file_types,
      sf_program_object: env.SF_PROGRAM_OBJECT || defaults.sf_program_object,
      ngrok_enabled: cfg.ngrok_enabled === 'true' ? 'true' : 'false'
    };
    res.json({
      ok: true,
      config: admin_store.get_config(overrides),                   // the saved override (blank = use default)
      keys: admin_store.CONFIG_KEYS,
      defaults: defaults,                                          // built-in fallback per key
      effective: effective,                                       // active value now (override or default)
      slack_file_type_options: ['xlsx', 'xls', 'csv', 'pptx', 'ppt'],
      admin_users: admin_store.list_users(overrides, 'admin'),     // usernames only — never hashes
      app_users: admin_store.list_users(overrides, 'app'),
      admin_users_caps: admin_store.list_users_with_caps(overrides, 'admin'),   // [{user,caps}] for the Access table
      app_users_caps: admin_store.list_users_with_caps(overrides, 'app'),
      all_caps: admin_store.ALL_CAPS,                              // ['admin','metrics','intake']
      env_admin_user: admin_creds().user || '',                    // the .env recovery account names (no passwords)
      env_app_user: dash_creds().user || '',
      config_updated_at: overrides.config_updated_at || ''         // ISO; the client renders it in Mountain Time
    });
  });
  app.post('/api/admin-config', require_admin_auth, function (req, res) {
    admin_store.set_config(overrides, (req.body && req.body.config) || {});
    overrides.config_updated_at = new Date().toISOString();        // stamp the change (shown as "Last changed" in MTN)
    if (!save_overrides()) return res.json({ ok: false, error: 'could not write the overrides file' });
    apply_config_overrides();   // take effect live (env-read config)
    res.json({ ok: true, message: 'Config saved.', config: admin_store.get_config(overrides), config_updated_at: overrides.config_updated_at });
  });
  app.post('/api/admin-user-add', require_admin_auth, function (req, res) {
    const b = req.body || {};
    const user = String(b.user || '').trim(), pass = String(b.pass || '');
    const caps = (Array.isArray(b.caps) ? b.caps : []).filter(function (x) { return admin_store.ALL_CAPS.indexOf(x) >= 0; });
    if (!user || !pass) return res.json({ ok: false, error: 'username and password are required' });
    if (!caps.length) return res.json({ ok: false, error: 'pick at least one area of access' });
    // store admin-area users (admin/metrics caps) in admin_users, intake-only users in app_users
    const scope = (caps.indexOf('admin') >= 0 || caps.indexOf('metrics') >= 0) ? 'admin' : 'app';
    admin_store.add_user(overrides, scope, user, pass, caps);
    if (!save_overrides()) return res.json({ ok: false, error: 'could not write the overrides file' });
    res.json({ ok: true, message: 'Saved user "' + user + '" — access: ' + caps.join(', ') + '.' });
  });
  app.post('/api/admin-user-remove', require_admin_auth, function (req, res) {
    const b = req.body || {};
    const scope = b.scope === 'app' ? 'app' : 'admin';
    const user = String(b.user || '').trim();
    const env_user = scope === 'app' ? (dash_creds().user || '') : (admin_creds().user || '');
    const r = admin_store.remove_user(overrides, scope, user, env_user);
    if (!r.ok) return res.json({ ok: false, error: r.error || 'could not remove user' });
    if (!save_overrides()) return res.json({ ok: false, error: 'could not write the overrides file' });
    res.json({ ok: true, message: 'Removed ' + scope + ' user "' + user + '".' });
  });
  // The bot's channels for the /admin config dropdown (admin-gated; the /api/slack/* list uses the app login).
  app.get('/api/admin-slack-channels', require_admin_auth, async function (req, res) {
    try {
      const slack = require('./src/race_results_transform/slack');
      const cfg = slack.slack_config({});
      if (!slack.check_slack_config(cfg).ok) return res.json({ ok: false, error: 'Slack not configured' });
      const conn = slack.make_connection(cfg);
      const chans = await slack.list_member_channels(conn);
      res.json({ ok: true, channels: chans.map(function (c) { return { id: c.id, name: c.name, is_private: !!c.is_private }; }) });
    } catch (e) { res.json({ ok: false, error: (e && e.message) || 'Slack error' }); }
  });

  // ---- /admin ops console routes (admin-gated). The client sends only { id, params, confirm }; the
  // server assembles argv from the registry and spawns with no shell (see admin/console_runner.js). ----
  app.get('/api/admin-console/commands', require_admin_auth, function (req, res) {
    res.json({ ok: true, sections: console_runner.commands(), runs: console_runner.list_runs(), audit: console_runner.recent_audit() });
  });
  app.post('/api/admin-console/run', require_admin_auth, function (req, res) {
    const b = req.body || {};
    const item = console_registry.by_id(b.id);
    if (!item) return res.json({ ok: false, error: 'unknown command' });
    const r = console_runner.start_run(item, b.params || {}, b.confirm);
    res.json(r);
  });
  app.get('/api/admin-console/stream/:run_id', require_admin_auth, function (req, res) {
    open_sse(res);
    console_runner.subscribe(req.params.run_id, res);
  });
  app.post('/api/admin-console/kill/:run_id', require_admin_auth, function (req, res) {
    res.json(console_runner.kill_run(req.params.run_id));
  });

  // ---- /admin Logs panel: in-memory console ring (+ SSE tail) and pm2 process stats ----
  app.get('/api/admin-logs', require_admin_auth, function (req, res) {
    res.json({ ok: true, lines: log_ring.tail(req.query.n) });
  });
  app.get('/api/admin-logs/stream', require_admin_auth, function (req, res) {
    open_sse(res);
    log_ring.subscribe(res);
  });
  app.get('/api/admin-pm2', require_admin_auth, async function (req, res) {
    try { res.json(Object.assign({ ok: true }, await log_ring.read_pm2(PM2_PROCESS_NAME))); }
    catch (e) { res.json({ ok: false, under_pm2: false, error: (e && e.message) || 'pm2 error' }); }
  });

  const DASHBOARD_HTML = path.join(__dirname, 'src', 'race_results_transform', 'metrics', 'metrics_dashboard.html');
  app.get('/metrics', require_metrics_auth,function (req, res) {
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
  app.get('/api/metrics-report', require_metrics_auth,async function (req, res) {
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

  // Purge only the deliberate test rows (is_test = 1). Real + Try-Me/demo data untouched. Auth-gated.
  app.post('/api/metrics-purge-test', require_metrics_auth,async function (req, res) {
    try {
      if (!metrics_pool) return res.status(503).json({ ok: false, error: 'analytics DB not available' });
      const r = await metrics_report.purge_test(metrics_pool);
      res.json({ ok: true, deleted: (r && r.deleted) || 0 });
    } catch (e) {
      console.error('[analytics] purge-test error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // AI "ask your data" — read-only natural-language query over the events table (auth-gated).
  app.get('/api/metrics-ask-models', require_metrics_auth,function (req, res) {
    try { res.json(require('./src/race_results_transform/metrics/ask/models').list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // G1/G2 grounding, cached ~5 min so we don't re-query on every ask (both degrade to null).
  let _ask_live = { at: 0, text: null }, _ask_corr = { at: 0, text: null };
  const ASK_GROUND_TTL = 5 * 60 * 1000;
  async function get_ask_live() {
    if (!metrics_pool) return null;
    if (Date.now() - _ask_live.at < ASK_GROUND_TTL) return _ask_live.text;
    let text = null;
    try { text = await require('./src/race_results_transform/metrics/ask/live').live_snapshot(metrics_pool, { days: 30 }); } catch (e) { text = null; }
    _ask_live = { at: Date.now(), text: text };
    return text;
  }
  async function get_ask_corrections() {
    if (!metrics_pool) return null;
    if (Date.now() - _ask_corr.at < ASK_GROUND_TTL) return _ask_corr.text;
    let text = null;
    try { text = await require('./src/race_results_transform/metrics/ask/corrections').grounding_text(metrics_pool, 12); } catch (e) { text = null; }
    _ask_corr = { at: Date.now(), text: text };
    return text;
  }
  // G2: save an operator correction; it joins the grounding for subsequent asks.
  app.post('/api/metrics-ask-correct', require_metrics_auth,async function (req, res) {
    try {
      const note = String((req.body && req.body.note) || '').slice(0, 2000).trim();
      if (!note) return res.status(400).json({ ok: false, error: 'no correction text' });
      const corr = require('./src/race_results_transform/metrics/ask/corrections');
      const id = await corr.append(metrics_pool, { note: note, question: req.body.question, original_answer: req.body.answer, author: String((req.body && req.body.author) || 'operator').slice(0, 120) });
      _ask_corr.at = 0;   // force a refresh so the correction applies on the next ask
      res.json({ ok: true, id: id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Conversation transcript: return a thread's turns (oldest first) for display.
  app.get('/api/metrics-ask-thread', require_metrics_auth,async function (req, res) {
    try {
      const thread_id = String((req.query && req.query.thread_id) || '').slice(0, 40);
      if (!thread_id) return res.json({ ok: true, turns: [] });
      const ask_log = require('./src/race_results_transform/metrics/ask/ask_log');
      const rows = await ask_log.read_thread(metrics_pool, thread_id, 20);
      res.json({ ok: true, turns: rows.map(function (r) { return { ts: r.created_at_mtn, question: r.question, answer: r.answer, sql: r.sql_text, ok: r.ok, provider: r.provider, model: r.model }; }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-ask', require_metrics_auth,async function (req, res) {
    const ask_mod = require('./src/race_results_transform/metrics/ask/ask');
    const ask_log = require('./src/race_results_transform/metrics/ask/ask_log');
    // Raw-SQL mode: input is treated as SQL and run directly (guarded read-only) -- no LLM.
    if (req.body && req.body.mode === 'sql') {
      const raw = String((req.body && req.body.sql) || '').slice(0, 4000).trim();
      if (!raw) return res.status(400).json({ ok: false, error: 'no sql' });
      try {
        const r = await ask_mod.ask_sql(raw);
        ask_log.append(metrics_pool, { surface: 'dashboard-sql', question: raw, provider: 'sql', model: null, thread_id: (req.body && req.body.thread_id) || null, asker_id: (req.body && req.body.asker_id) || null, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer });
        return res.json(r);
      } catch (e) {
        ask_log.append(metrics_pool, { surface: 'dashboard-sql', question: raw, provider: 'sql', model: null, sql: raw, ok: false, row_count: 0, answer: e.message });
        return res.status(400).json({ ok: false, error: e.message });
      }
    }
    try {
      const question = String((req.body && req.body.question) || '').slice(0, 500).trim();
      if (!question) return res.status(400).json({ ok: false, error: 'no question' });
      const thread_id = req.body && req.body.thread_id ? String(req.body.thread_id).slice(0, 40) : null;
      const asker_id = req.body && req.body.asker_id ? String(req.body.asker_id).slice(0, 40) : null;
      const live = await get_ask_live();                                   // G1: current aggregates
      const corrections = await get_ask_corrections();                     // G2: operator clarifications
      let history = null;                                                  // B1: prefer the server-side thread (survives reload)
      if (thread_id) { try { history = ask_log.to_history(await ask_log.read_thread(metrics_pool, thread_id, 4)); } catch (e) { history = null; } }
      if (!history || !history.length) history = Array.isArray(req.body.history) ? req.body.history.slice(-4) : null;
      const r = await ask_mod.ask(question, { provider: req.body.provider, model: req.body.model, live: live, corrections: corrections, history: history });
      ask_log.append(metrics_pool, { surface: 'dashboard', question: question, provider: r.provider, model: r.model, thread_id: thread_id, asker_id: asker_id, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer });
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

  // Salesforce race-results intake (optional feature). Gated by the SAME mx_session auth as the
  // metrics dashboard. Lazy-required so the server still boots if SF env/creds are absent; the
  // endpoints return 503 "not configured" until SF_* env vars are set. Files stream in-memory —
  // nothing is persisted on the server (the browser saves to the user's chosen folder).
  try {
    require('./src/race_results_transform/sf/sf_routes').mount_sf_routes(app, require_dash_auth);
  } catch (e) {
    console.error('[sf] route mount skipped:', e.message);
  }

  // Slack race-results intake (optional feature). Same mx_session auth. Lazy-required so the server
  // still boots if SLACK_* env is absent; /api/slack/* returns 503 "not configured" until
  // SLACK_BOT_TOKEN is set. Bot token stays server-side; file bytes stream in-memory (no disk).
  try {
    require('./src/race_results_transform/slack/slack_routes').mount_slack_routes(app, require_dash_auth);
  } catch (e) {
    console.error('[slack] route mount skipped:', e.message);
  }

  // Optional legacy .xls support: serve SheetJS's browser build straight from the installed `xlsx`
  // npm package (so `npm install xlsx` is all that's needed — no vendored copy). The app lazy-loads
  // this only when an .xls is opened. Falls back to a committed public/vendor copy if node_modules
  // isn't shipped (pure-static deploy).
  app.get('/vendor/xlsx.full.min.js', function (req, res, next) {
    const from_pkg = path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
    if (require('fs').existsSync(from_pkg)) return res.type('application/javascript').sendFile(from_pkg);
    next();   // fall through to express.static (public/vendor/xlsx.full.min.js) if vendored
  });

  // Serve the shared core modules (src/, single source of truth, also used by
  // the CLI + tests) so the browser <script> tags can load them.
  app.use('/src', express.static(path.join(__dirname, 'src', 'race_results_transform', 'src')));

  // Static SPA. http://localhost:8018/ serves index.html (and the committed "Try me" fixture at
  // /sample/sample_race_results_FAKE.xlsx — a normal static asset under public/, so it works the
  // same in an Express deploy and a pure-static / Cloudflare Pages deploy of public/).
  app.use('/', express.static(PUBLIC_DIR));

  app.use(function (req, res) {
    res.status(404).json({ error: 'not found', path: req.path });
  });

  // JSON error handler — never let body-parser (or any thrown error) fall through to Express's
  // default HTML error page, which an AJAX caller would fail to JSON.parse ("Unexpected token '<'").
  // An oversized body becomes a clean 413; malformed JSON a 400.
  app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
      return res.status(413).json({ ok: false, error: 'request too large' });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    }
    console.error('[server] error:', (err && err.message) || err);
    return res.status((err && (err.status || err.statusCode)) || 500).json({ ok: false, error: (err && err.message) || 'server error' });
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
        console.log('  -> http://localhost:' + actual + '/                 (web app \u2014 converter + intake)');
        console.log('  -> http://localhost:' + actual + '/metrics          (usage dashboard \u2014 admin login)');
        console.log('  -> http://localhost:' + actual + '/admin            (admin hub \u2014 admin login)');
        console.log('  -> http://localhost:' + actual + '/api/status       (health check)');
        console.log('  -> https://usat-converter.kidderwise.org' + '       (internet access)');
        console.log('  Serving: ' + PUBLIC_DIR);
        console.log('  Press Ctrl-C to stop.\n');
      }
      // NGROK TUNNEL \u2014 best-effort. Prints "Ingress established at: https://...".
      // A missing/invalid NGROK_AUTHTOKEN must NOT crash the local server, so we
      // catch the (otherwise unhandled) async rejection from create_ngrok_tunnel.
      if (is_test_ngrok || ngrok_enabled_flag) {
        process.once('unhandledRejection', function (err) {
          var msg = (err && (err.errorCode || err.message)) || String(err);
          console.log('\n  [ngrok] tunnel not started: ' + msg);
          console.log('  The local server above keeps running. To get a public URL, set');
          console.log('  NGROK_AUTHTOKEN (https://dashboard.ngrok.com/get-started/your-authtoken),');
          console.log('  or turn ngrok off in /admin → Settings.\n');
        });
        create_ngrok_tunnel(actual).then(function (u) { if (u) { ngrok_url = u; console.log('  [ngrok] public URL: ' + u); } });
      } else {
        console.log('  [ngrok] tunnel disabled (enable it in /admin → Settings, then restart).');
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
