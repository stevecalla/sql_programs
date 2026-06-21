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
 *   - usage analytics: /api/event ingest + /metrics dashboard + /admin hub, all mirroring
 *     8018's analytics stack (utilities/analytics/* + a per-app metrics_config + metrics_report).
 *   - optional ngrok tunnel (off by default, same as 8018)
 *
 * Public URL (production): https://usat-email.kidderwise.org  (Cloudflare tunnel -> 8019)
 *
 * Read-only: nothing is written/sent to Salesforce. The /api/send route is 403. Analytics writes go
 * ONLY to the local MySQL analytics DB (never Salesforce), and store no member PII (counts/enums +
 * the operator's staff username + queue name; never member names, bodies, addresses, or Case ids).
 *
 * Usage:
 *   node server_salesforce_email_queue_8019.js        # default port 8019
 *   EQ_PORT=9000 node server_salesforce_email_queue_8019.js
 *   METRICS_OFF=true node server_salesforce_email_queue_8019.js   # disable analytics
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
// Load the repo-root .env (SF_PROD_*, OPENAI/ANTHROPIC keys, NGROK_AUTHTOKEN, LOCAL_MYSQL_* for analytics)
// regardless of the working directory — the menu launches this from the project subfolder.
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

// ---- Usage analytics (best-effort; PII never stored) — mirrors 8018's stack ------------------
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('./utilities/config');
const { make_event_ingest, insert_event } = require('./utilities/analytics/event_ingest');
const { ensure_table, ensure_columns } = require('./utilities/analytics/ensure_table');
const metrics_config = require('./src/salesforce_email_queue_proof_of_concept/metrics/metrics_config');
const metrics_report = require('./src/salesforce_email_queue_proof_of_concept/metrics/metrics_report');
const { query_create_salesforce_email_queue_events_table } = require('./src/queries/create_drop_db_table/query_create_salesforce_email_queue_events_table');
const { require_admin, require_admin_page } = require('./src/salesforce_email_queue_proof_of_concept/auth/require_auth');
const eq_session = require('./src/salesforce_email_queue_proof_of_concept/auth/session');
const eq_store = require('./src/salesforce_email_queue_proof_of_concept/auth/auth_store');
function esc_login(x){ return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function eq_current_user(req){ try { const c = eq_session.parse_cookies(req.headers.cookie); const pl = eq_session.verify(c[eq_session.COOKIE], eq_store.session_secret()); return pl ? { user: pl.user, role: pl.role || 'user' } : null; } catch (e) { return null; } }
// (dashboard_view / admin_view / sign_out are now logged CLIENT-side with full meta, so the old
//  server-side um_vid()/qtest() helpers were removed.)
// ONE adaptive sign-in page (mirrors race_results_transform login_html): optional "signed in as X" banner,
// optional error, link chips to sibling areas (all carrying ?metrics_test=1), and the sign-in form.
function eq_login_html(err, action, title, ctx, test){
  const ttl = title || 'Admin'; const logout = action.replace('/login', '/logout'); const tq = test ? '?metrics_test=1' : '';
  // Role-based routing: no cross-area chips. Only a Sign-out link when a wrong (non-admin) account is
  // already signed in, so they can switch accounts.
  let banner = '', chips = '';
  if (ctx && ctx.user) {
    banner = '<div class="who">Signed in as <b>' + esc_login(ctx.user) + '</b> — this account has no <b>' + ttl + '</b> access.</div>';
    chips = '<div class="chips" style="margin-top:14px"><a class="chip" href="' + logout + tq + '">↩ Sign out</a></div>';
  }
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Sign in — ' + ttl + '</title>'
    + '<style>body{font:16px system-ui,Arial,sans-serif;background:#0e1b3a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}'
    + 'form{background:#16233f;padding:24px;border-radius:12px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.4)}'
    + 'h1{font-size:18px;margin:0 0 14px}input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border-radius:8px;border:1px solid #2a3a5e;background:#0e1b3a;color:#fff}'
    + 'button{width:100%;padding:10px;border:0;border-radius:8px;background:#e4002b;color:#fff;font-weight:700;cursor:pointer;margin-top:6px}.err{color:#ff8a8a;font-size:13px;margin:0 0 8px}'
    + '.who{background:rgba(239,159,39,.14);border:1px solid rgba(239,159,39,.4);border-radius:8px;padding:8px 10px;margin:0 0 8px;font-size:13px;color:#f0c98a}.who b{color:#ffe1b0}'
    + '.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}.chip{font-size:12.5px;color:#cfe0ff;border:1px solid #2a3a5e;border-radius:8px;padding:5px 10px;text-decoration:none}.chip:hover{background:#0e1b3a}'
    + '.sub{font-size:12px;color:#8ea3c8;margin:0 0 4px;border-top:1px solid #2a3a5e;padding-top:12px}label{display:flex;align-items:center;gap:6px;font-size:13px;margin:2px 0 4px;cursor:pointer}label input{width:auto;margin:0}</style>'
    + '<form method="post" action="' + action + tq + '">'
    + '<h1>🔒 Email Queue Assistant — ' + ttl + ' sign in</h1>'
    + banner
    + (err ? '<p class="err">' + esc_login(err) + '</p>' : '')
    + chips
    + '<div class="sub">Sign in with an admin account:</div>'
    + '<input name="username" placeholder="Username" autofocus autocomplete="username">'
    + '<input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password">'
    + (test ? '<input type="hidden" name="metrics_test" value="1">' : '')
    + '<label><input type="checkbox" onclick="document.getElementById(\'pw\').type=this.checked?\'text\':\'password\'"> Show password</label>'
    + '<button type="submit">Sign in</button></form>';
}

const METRICS_ON = String(process.env.METRICS_OFF).toLowerCase() !== 'true';
let metrics_pool = null;
const ALLOW = new Set(metrics_config.COLUMNS);
// Proxy so the ingest handler / server-side logger always read the current pool (created async at startup).
const pool_proxy = { query: function () {
  if (!metrics_pool) return Promise.reject(new Error('analytics pool not ready'));
  return metrics_pool.query.apply(metrics_pool, arguments);
} };
// Server-side event logger — for events whose facts are only known on the server (AI latency /
// verdict / success). Best-effort: never throws, no-ops when the pool isn't ready.
// Which Salesforce org the app is currently pointed at — stamped on every analytics row as `env`
// (server-authoritative; the same config.json setting get_conn uses). 'prod' | 'sandbox'.
function current_env() {
  try { const dd = require('./src/salesforce_email_queue_proof_of_concept/data_dir'); const v = (dd.read_config() || {}).sf_env; return v === 'sandbox' ? 'sandbox' : 'prod'; }
  catch (e) { return 'prod'; }
}
async function log_event(props) {
  if (!METRICS_ON) return;
  try {
    await insert_event(pool_proxy, metrics_config.TABLE, ALLOW, metrics_config.REPORTING_TZ,
      Object.assign({ app: metrics_config.APP, source: 'web', env: current_env() }, props || {}));
  } catch (e) { /* analytics must never break the app */ }
}
async function init_metrics() {
  if (!METRICS_ON) { console.log('  [analytics] disabled via METRICS_OFF'); return; }
  try {
    const cfg = await local_usat_sales_db_config();
    metrics_pool = mysql.createPool(cfg);
    const ddl = await query_create_salesforce_email_queue_events_table(metrics_config.TABLE);
    await ensure_table(metrics_pool, ddl);
    // Migrate already-created tables to the per-case + SF-write columns (CREATE IF NOT EXISTS won't add them).
    await ensure_columns(metrics_pool, metrics_config.TABLE, [
      { name: 'case_id', ddl: 'case_id CHAR(18)', after: 'queue_id' },
      { name: 'case_number', ddl: 'case_number VARCHAR(20)', after: 'case_id' },
      { name: 'sf_action', ddl: 'sf_action VARCHAR(16)', after: 'ai_error' },
      { name: 'sf_ok', ddl: 'sf_ok TINYINT(1)', after: 'sf_action' },
      { name: 'sf_error', ddl: 'sf_error VARCHAR(120)', after: 'sf_ok' },
      { name: 'status_to', ddl: 'status_to VARCHAR(40)', after: 'sf_error' },
      { name: 'ai_prompt_tokens', ddl: 'ai_prompt_tokens INT', after: 'ai_reply_chars' },
      { name: 'ai_completion_tokens', ddl: 'ai_completion_tokens INT', after: 'ai_prompt_tokens' },
      { name: 'ai_cost_usd', ddl: 'ai_cost_usd DECIMAL(10,6)', after: 'ai_completion_tokens' },
      { name: 'env', ddl: "env VARCHAR(10)", after: 'is_test' }
    ]);
    // Ask-your-data audit log + operator corrections (mirrors 8018). Writable analytics pool.
    var _ask_log = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/ask_log');
    var _ask_corr = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/corrections');
    await ensure_table(metrics_pool, _ask_log.DDL);
    await ensure_table(metrics_pool, _ask_corr.DDL);
    await ensure_columns(metrics_pool, _ask_log.TABLE, _ask_log.MIGRATE_COLUMNS);
    console.log('  [analytics] events table ready (' + metrics_config.TABLE + ')');
  } catch (e) {
    console.log('  [analytics] disabled — DB not available: ' + e.message);
    metrics_pool = null;
  }
}

// NGROK TUNNEL — optional public URL, exactly like server_race_results_transform_8018.js.
// Off by default (Cloudflare fronts this app). Set true / NGROK_AUTHTOKEN to use it.
const is_test_ngrok = false;
let ngrok_url = null;
let ngrok_enabled_flag = false;

const DEFAULT_PORT = Number(process.env.EQ_PORT) || 8019;
const POC = path.join(__dirname, 'src', 'salesforce_email_queue_proof_of_concept');
const PUBLIC_DIR = path.join(POC, 'web', 'public');
const METRICS_HTML = path.join(POC, 'metrics', 'metrics_dashboard.html');
const ADMIN_HTML = path.join(POC, 'metrics', 'admin.html');
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
  // Inject the server-side analytics logger so the API can record AI-call events (latency/verdict/ok).
  mount(app, { analytics: { log: log_event, enabled: function () { return METRICS_ON && !!metrics_pool; } } });

  // Usage analytics — fire-and-forget browser ingest. Counts/enums only; no-ops if no DB pool. Ungated
  // (contains no sensitive data), exactly like 8018's /api/event.
  const _event_ingest = make_event_ingest({ pool: pool_proxy, table: metrics_config.TABLE, columns: metrics_config.COLUMNS, reporting_tz: metrics_config.REPORTING_TZ });
  app.post('/api/event', function (req, res) {   // stamp env server-side (authoritative) on browser events
    try { if (req.body && typeof req.body === 'object') req.body.env = current_env(); } catch (e) { /* ignore */ }
    return _event_ingest(req, res);
  });
  // Serve the shared generic analytics browser client (UsageMetrics) as a static asset.
  app.use('/analytics', express.static(path.join(__dirname, 'utilities', 'analytics')));
  // Reuse the transform's stylesheet so /metrics + /admin match it exactly (single source of truth).
  app.use('/css', express.static(path.join(__dirname, 'src', 'race_results_transform', 'public', 'css')));

  // ---- Transform-style sign-in for /metrics + /admin (server-rendered, with chips + ?metrics_test=1) ----
  app.use(['/metrics/login', '/admin/login'], express.urlencoded({ extended: false }));
  function eq_login_post(req, res, area) {
    const b = req.body || {}; const test = String(b.metrics_test || '') === '1'; const ttl = area === '/admin' ? 'Admin' : 'Metrics';
    const v = eq_store.valid_user(b.username, b.password);
    if (!v || (v.role || 'user') !== 'admin') {
      return res.status(401).type('html').send(eq_login_html('Invalid credentials, or that account is not an admin.', area + '/login', ttl, eq_current_user(req), test));
    }
    const token = eq_session.sign({ user: v.user, role: v.role || 'user', ts: Date.now() }, eq_store.session_secret());
    res.setHeader('Set-Cookie', eq_session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(eq_session.MAX_AGE_MS / 1000));
    res.redirect(area + (test ? '?metrics_test=1' : ''));
  }
  app.get('/metrics/login', function (req, res) { const u = eq_current_user(req); const test = String(req.query.metrics_test || '') === '1'; if (u && u.role === 'admin') return res.redirect('/metrics' + (test ? '?metrics_test=1' : '')); res.type('html').send(eq_login_html('', '/metrics/login', 'Metrics', u, test)); });
  app.post('/metrics/login', function (req, res) { eq_login_post(req, res, '/metrics'); });
  app.get('/admin/login', function (req, res) { const u = eq_current_user(req); const test = String(req.query.metrics_test || '') === '1'; if (u && u.role === 'admin') return res.redirect('/admin' + (test ? '?metrics_test=1' : '')); res.type('html').send(eq_login_html('', '/admin/login', 'Admin', u, test)); });
  app.post('/admin/login', function (req, res) { eq_login_post(req, res, '/admin'); });

  // ---- /metrics dashboard + /admin hub (admin login = existing session with role 'admin') ----
  // is_test reflects the URL only (?metrics_test=1) — the nav/footer links to these pages carry it,
  // so admin testing is flagged, but a plain visit is real. Never forced.
  // dashboard_view / admin_view are logged CLIENT-side (the page loads /analytics/metrics_client.js and
  // fires the event) so they carry the SAME rich metadata as app events — session_id, client tz, local
  // time, viewport, theme — which the server can't see. is_test still comes from the page URL.
  app.get('/metrics', require_admin_page, function (req, res) { res.type('html').sendFile(METRICS_HTML); });
  app.get('/admin', require_admin_page, function (req, res) { res.type('html').sendFile(ADMIN_HTML); });
  // Sign-out for the admin pages: clears the shared session cookie, then back to login. The sign_out
  // event is logged CLIENT-side (full meta) by the page before it navigates here — so no server log.
  app.get(['/metrics/logout', '/admin/logout'], function (req, res) {
    res.setHeader('Set-Cookie', 'eq_session=; HttpOnly; Path=/; Max-Age=0');
    res.redirect('/');
  });

  app.get('/api/metrics-report', require_admin, async function (req, res) {
    try {
      if (!metrics_pool) return res.status(503).json({ ok: false, error: 'analytics DB not available' });
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
      res.json({ ok: true, report: await metrics_report.build_report(metrics_pool, { days: days }) });
    } catch (e) { console.error('[analytics] report error:', e.message); res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-purge-test', require_admin, async function (req, res) {
    try {
      if (!metrics_pool) return res.status(503).json({ ok: false, error: 'analytics DB not available' });
      res.json(Object.assign({ ok: true }, await metrics_report.purge_test(metrics_pool)));
    } catch (e) { console.error('[analytics] purge-test error:', e.message); res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/admin-status', require_admin, function (req, res) {
    res.json({
      ok: true,
      user: req.user,
      salesforce_configured: !!(process.env.SF_PROD_USERNAME || process.env.SF_DEV_USERNAME),
      openai_key: !!process.env.OPENAI_API_KEY,
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      analytics_db: !!metrics_pool,
      admin_login_configured: !!(process.env.SF_EMAIL_QUEUE_ADMIN_USER && process.env.SF_EMAIL_QUEUE_ADMIN_PASS),
      user_login_configured: !!(process.env.SF_EMAIL_QUEUE_USER && process.env.SF_EMAIL_QUEUE_PASS),
      ngrok_enabled: !!ngrok_enabled_flag
    });
  });

  // ---- Ask your data — read-only natural-language query over the events table (admin-gated) ----
  app.get('/api/metrics-ask-models', require_admin, function (req, res) {
    try { res.json(require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/models').list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // G1/G2 grounding, cached ~5 min (both degrade to null if unavailable).
  let _ask_live = { at: 0, text: null }, _ask_corr_c = { at: 0, text: null };
  const ASK_GROUND_TTL = 5 * 60 * 1000;
  async function get_ask_live() {
    if (!metrics_pool) return null;
    if (Date.now() - _ask_live.at < ASK_GROUND_TTL) return _ask_live.text;
    let text = null;
    try { text = await require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/live').live_snapshot(metrics_pool, { days: 30 }); } catch (e) { text = null; }
    _ask_live = { at: Date.now(), text: text }; return text;
  }
  async function get_ask_corrections() {
    if (!metrics_pool) return null;
    if (Date.now() - _ask_corr_c.at < ASK_GROUND_TTL) return _ask_corr_c.text;
    let text = null;
    try { text = await require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/corrections').grounding_text(metrics_pool, 12); } catch (e) { text = null; }
    _ask_corr_c = { at: Date.now(), text: text }; return text;
  }
  app.post('/api/metrics-ask-correct', require_admin, async function (req, res) {
    try {
      const note = String((req.body && req.body.note) || '').slice(0, 2000).trim();
      if (!note) return res.status(400).json({ ok: false, error: 'no correction text' });
      const corr = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/corrections');
      const id = await corr.append(metrics_pool, { note: note, question: req.body.question, original_answer: req.body.answer, author: String(req.user || 'operator').slice(0, 120) });
      _ask_corr_c.at = 0;   // force refresh so it applies on the next ask
      res.json({ ok: true, id: id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/metrics-ask-thread', require_admin, async function (req, res) {
    try {
      const thread_id = String((req.query && req.query.thread_id) || '').slice(0, 40);
      if (!thread_id) return res.json({ ok: true, turns: [] });
      const ask_log = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/ask_log');
      const rows = await ask_log.read_thread(metrics_pool, thread_id, 20);
      res.json({ ok: true, turns: rows.map(function (r) { return { ts: r.created_at_mtn, question: r.question, answer: r.answer, sql: r.sql_text, ok: r.ok, provider: r.provider, model: r.model }; }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/metrics-ask', require_admin, async function (req, res) {
    const ask_mod = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/ask');
    const ask_log = require('./src/salesforce_email_queue_proof_of_concept/metrics/ask/ask_log');
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
      const live = await get_ask_live();
      const corrections = await get_ask_corrections();
      let history = null;
      if (thread_id) { try { history = ask_log.to_history(await ask_log.read_thread(metrics_pool, thread_id, 4)); } catch (e) { history = null; } }
      if (!history || !history.length) history = Array.isArray(req.body.history) ? req.body.history.slice(-4) : null;
      const r = await ask_mod.ask(question, { provider: req.body.provider, model: req.body.model, live: live, corrections: corrections, history: history });
      ask_log.append(metrics_pool, { surface: 'dashboard', question: question, provider: r.provider, model: r.model, thread_id: thread_id, asker_id: asker_id, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer });
      res.json(r);
    } catch (e) { console.error('[ask] error:', e.message); res.status(500).json({ ok: false, error: e.message }); }
  });

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
  init_metrics();
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
        console.log('  -> http://localhost:' + actual + '/metrics           (usage dashboard — admin login)');
        console.log('  -> http://localhost:' + actual + '/admin             (admin hub — admin login)');
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
        const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');
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
if (require.main === module && process.stdin.isTTY) {
  require('readline').createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', cleanup);
}

if (require.main === module) {
  start_server().catch(function (e) { console.error('Failed to start: ' + ((e && e.message) || e)); process.exit(1); });
}

module.exports = { create_app, start_server };
