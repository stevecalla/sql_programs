#!/usr/bin/env node
/**
 * server_proxy_8000.js — single reverse proxy in front of the USAT server_*.js
 * services. One public host (usat-api.kidderwise.org) + path prefixes replace
 * the per-app Cloudflare subdomains. Backends keep their own ports, unchanged.
 *
 * Patterned after server_event_analysis_8016.js / _8019.js:
 *   - create_app() builds the Express app (logging, health, console, proxy, 404)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 ::1 + IPv4)
 *   - optional ngrok tunnel (off by default), same is_test_ngrok flag as 8016/8019
 *   - cleanup() on SIGINT/SIGTERM (+ readline TTY fallback) so Ctrl-C stops cleanly
 *
 * Management console (mirrors the email_queue admin): cookie-session auth via
 * proxy_auth.js, a gated /admin dashboard (public/proxy_admin.html), and a gated
 * /api/logs pm2 log tail. Public: /api/test, /api/status, /api/health, app paths.
 *
 * Usage:  node server_proxy_8000.js     (PROXY_PORT overrides 8000)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const proxy_auth = require('./proxy_auth');

// express-rate-limit is OPTIONAL: if absent the proxy still runs (rate-limit at Cloudflare instead).
let rate_limit = null;
try { rate_limit = require('express-rate-limit'); }
catch (_) { console.warn('[proxy] express-rate-limit not installed — rate limiting disabled. Run: npm i express-rate-limit'); }

const DEFAULT_PORT = Number(process.env.PROXY_PORT) || 8000;
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || path.join(os.homedir(), '.pm2', 'logs');

// NGROK TUNNEL FOR TESTING — off by default (Cloudflare fronts this in prod).
const is_test_ngrok = false;

// Route table: a JS module so routes can be commented in/out one at a time.
const ROUTES = require('./proxy_routes');

let active_server = null; // set in start_server(); closed by cleanup()

// Dark sign-in page, mirroring the email_queue eq_login_html style.
function login_html(err) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Sign in — USAT Proxy</title>'
    + '<style>body{font:16px system-ui,Arial,sans-serif;background:#0e1b3a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}'
    + 'form{background:#16233f;padding:24px;border-radius:12px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.4)}'
    + 'h1{font-size:18px;margin:0 0 14px}input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border-radius:8px;border:1px solid #2a3a5e;background:#0e1b3a;color:#fff}'
    + 'button{width:100%;padding:10px;border:0;border-radius:8px;background:#e4002b;color:#fff;font-weight:700;cursor:pointer;margin-top:6px}.err{color:#ff8a8a;font-size:13px;margin:0 0 8px}'
    + 'label{display:flex;align-items:center;gap:6px;font-size:13px;margin:2px 0 4px;cursor:pointer}label input{width:auto;margin:0}</style>'
    + '<form method="post" action="/admin/login">'
    + '<h1>&#128274; USAT Proxy — Admin sign in</h1>'
    + (err ? '<p class="err">' + err + '</p>' : '')
    + '<input name="username" placeholder="Username" autofocus autocomplete="username">'
    + '<input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password">'
    + '<label><input type="checkbox" onclick="document.getElementById(\'pw\').type=this.checked?\'text\':\'password\'"> Show password</label>'
    + '<button type="submit">Sign in</button></form>';
}

function create_app() {
  const app = express();
  app.set('trust proxy', 1);

  const log_ts = function () { return new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }); };

  // Request logging: ">>" received, "<<" finished (OK / CLIENT ERROR / SERVER ERROR + ms).
  // Liveness polls are skipped to keep the log readable. pm2 captures to ~/.pm2/logs.
  app.use(function (req, res, next) {
    if (req.path === '/api/status' || req.path === '/healthz' || req.path === '/api/test') return next();
    const t0 = Date.now();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
    console.log('[' + log_ts() + '] >> ' + req.method + ' ' + req.originalUrl + '  (from ' + ip + ')');
    res.on('finish', function () {
      const s = res.statusCode;
      const tag = s >= 500 ? 'SERVER ERROR' : (s >= 400 ? 'CLIENT ERROR' : 'OK');
      console.log('[' + log_ts() + '] << ' + req.method + ' ' + req.originalUrl + ' -> ' + s + ' ' + tag + ' (' + (Date.now() - t0) + 'ms)');
    });
    next();
  });

  // -- Health check (enriched /api/status; /healthz alias) --
  app.get(['/api/status', '/healthz'], (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true, app: 'proxy',
      now_utc: new Date().toISOString(),
      now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: { rss: +(mem.rss / 1048576).toFixed(1), heap_used: +(mem.heapUsed / 1048576).toFixed(1) },
      pid: process.pid, node: process.version, routes: Object.keys(ROUTES),
    });
  });

  // -- Built-in smoke test (no backend needed) --
  app.get('/api/test', (req, res) => res.json({ ok: true, msg: 'proxy is alive', time: new Date().toISOString() }));

  // -- Aggregate health — pings every enabled backend's health route --
  app.get('/api/health', async (req, res) => {
    const checked = {};
    await Promise.all(Object.entries(ROUTES).map(async ([prefix, cfg]) => {
      const target = typeof cfg === 'string' ? cfg : cfg.target;
      const health = (typeof cfg === 'object' && cfg.health) || '/api/status';
      const t0 = Date.now();
      try {
        const r = await fetch(target + health, { signal: AbortSignal.timeout(3000) });
        checked[prefix] = { ok: r.ok, status: r.status, ms: Date.now() - t0 };
      } catch (e) {
        checked[prefix] = { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : ((e.cause && e.cause.code) || e.message) };
      }
    }));
    const all_ok = Object.values(checked).every(r => r.ok);
    res.status(all_ok ? 200 : 503).json({ ok: all_ok, checked, time: new Date().toISOString() });
  });

  // -- Management console (cookie-session auth; mirrors email_queue /admin) --
  app.get('/admin/login', (req, res) => {
    if (proxy_auth.current_user(req)) return res.redirect('/admin');
    res.type('html').send(login_html(''));
  });
  app.post('/admin/login', express.urlencoded({ extended: false }), (req, res) => {
    const b = req.body || {};
    const v = proxy_auth.valid_login(b.username, b.password);
    if (!v) return res.status(401).type('html').send(login_html('Invalid credentials (or PROXY_ADMIN_USER / PROXY_ADMIN_PASS not set in .env).'));
    res.setHeader('Set-Cookie', proxy_auth.make_cookie(v.user));
    res.redirect('/admin');
  });

  app.get('/admin/logout', (req, res) => { res.setHeader('Set-Cookie', proxy_auth.clear_cookie()); res.redirect('/admin/login'); });
  
  app.get('/admin', proxy_auth.require_auth_page, (req, res) => res.type('html').sendFile(path.join(__dirname, 'public', 'proxy_admin.html')));

  // Gated pm2 log tail (no SSH). ?name=<pm2 name> tails its log files; no name lists them.
  app.get('/api/logs', proxy_auth.require_auth, (req, res) => {
    let files;
    try { files = fs.readdirSync(PM2_LOG_DIR).filter((f) => f.endsWith('.log')); }
    catch (e) { return res.status(500).json({ ok: false, error: 'cannot read pm2 log dir', dir: PM2_LOG_DIR, detail: e.message }); }
    const name = req.query.name;
    if (!name) return res.json({ ok: true, dir: PM2_LOG_DIR, files });
    const lines = Math.min(Number(req.query.lines) || 200, 2000);
    const matches = files.filter((f) => f === name || f.indexOf(name + '-') === 0 || f.indexOf(name) === 0);
    const logs = {};
    matches.forEach((f) => {
      try { logs[f] = fs.readFileSync(path.join(PM2_LOG_DIR, f), 'utf8').split(/\r?\n/).slice(-lines).join('\n'); }
      catch (e) { logs[f] = '(error reading: ' + e.message + ')'; }
    });
    res.json({ ok: true, dir: PM2_LOG_DIR, name, lines, logs });
  });

  // -- Reject bad methods --
  const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  app.use((req, res, next) => {
    if (!ALLOWED_METHODS.includes(req.method)) return res.status(405).json({ ok: false, error: 'method not allowed' });
    next();
  });

  // -- Rate limit (skipped if express-rate-limit isn't installed) --
  if (rate_limit) app.use(rate_limit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  // -- One forwarding rule per route entry. app.use(prefix,...) already strips the
  //    mount prefix, so NO pathRewrite (else the prefix is stripped twice). --
  for (const [prefix, cfg] of Object.entries(ROUTES)) {
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    app.use(prefix, createProxyMiddleware({
      target, changeOrigin: true, ws: true, proxyTimeout: 30000, timeout: 30000,
      on: {
        proxyReq: (proxyReq, req) => { console.log('[' + log_ts() + '] -> routed ' + prefix + '  ' + req.method + ' ' + req.url + '  to ' + target); },
        proxyRes: (proxyRes, req) => { console.log('[' + log_ts() + '] <- ' + prefix + ' backend responded ' + proxyRes.statusCode); },
        error: (err, req, res) => {
          console.error('[' + log_ts() + '] !! ' + prefix + ' backend error: ' + ((err && err.message) || err));
          if (res.writeHead && !res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'backend unavailable', path: req.url }));
        },
      },
    }));
  }

  // -- 404 fallback --
  app.use((req, res) => res.status(404).json({ ok: false, error: 'not found', path: req.path }));
  return app;
}

async function start_server({ port = DEFAULT_PORT, silent = false } = {}) {
  const app = create_app();
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      active_server = server;
      const actual = server.address().port;
      if (!silent) {
        console.log('\nUSAT Proxy — local server');
        console.log('  -> http://localhost:' + actual + '/api/status   (health)');
        console.log('  -> http://localhost:' + actual + '/admin        (console — login)');
        Object.keys(ROUTES).forEach((p) => {
          const cfg = ROUTES[p]; const target = typeof cfg === 'string' ? cfg : cfg.target;
          console.log('  -> http://localhost:' + actual + p + '/*  ->  ' + target);
        });
        console.log('  -> https://usat-api.kidderwise.org   (Cloudflare tunnel -> ' + actual + ')');
        console.log('  Press Ctrl-C to stop.\n');
      }
      if (is_test_ngrok) {
        try { require('./utilities/create_ngrok_tunnel').create_ngrok_tunnel(port); }
        catch (e) { console.warn('[proxy] ngrok not available — continuing without a tunnel:', e.message); }
      }
      resolve({ port: actual, server });
    });
    server.on('error', reject);
  });
}

// Clean up on exit — same pattern as the other server_*.js so Ctrl-C stops cleanly.
function cleanup() { console.log('\nGracefully shutting down...'); process.exit(); }
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
// Windows fallback: some terminals don't deliver process-level SIGINT on Ctrl-C; a
// readline interface on stdin DOES emit 'SIGINT', so wire it too when run in a TTY.
if (require.main === module && process.stdin.isTTY) {
  require('readline').createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', cleanup);
}

if (require.main === module) {
  start_server({ port: DEFAULT_PORT }).catch((err) => { console.error('Proxy failed to start:', err); process.exit(1); });
}

module.exports = { create_app, start_server, DEFAULT_PORT };
