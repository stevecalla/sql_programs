#!/usr/bin/env node
/**
 * server_proxy_8000.js — single reverse proxy in front of the USAT server_*.js
 * services. One public host (usat-api.kidderwise.org) + path prefixes.
 * create_app()/start_server() factory; dual-stack listen; optional ngrok;
 * cleanup() on SIGINT/SIGTERM (+ readline TTY fallback). Pretty-printed JSON.
 *
 * NOTE: the management console formerly served here at /admin was RETIRED. It now
 * lives in the usat_apps platform (Ops module, port 8022), reached through the '/'
 * route in utilities/proxy/proxy_routes.js. This file is now a PURE reverse proxy:
 * routing + health only (no auth, no console, no system/pm2 endpoints).
 */
'use strict';

const path = require('path');
const os = require('os');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

let rate_limit = null;
try { rate_limit = require('express-rate-limit'); }
catch (_) { console.warn('[proxy] express-rate-limit not installed — rate limiting disabled. Run: npm i express-rate-limit'); }

const DEFAULT_PORT = Number(process.env.PROXY_PORT) || 8000;
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || path.join(os.homedir(), '.pm2', 'logs');
const is_test_ngrok = false;
const ROUTES = require('./utilities/proxy/proxy_routes');
let active_server = null;

// Per-route host gating. Each proxy_routes entry is tagged host:'api' (usat-api) or host:'app'
// (usat-app). A request on the wrong hostname 404s; localhost is always allowed (dev). Untagged
// routes stay reachable on both hosts. Override the hostnames with API_HOST / APP_HOST in .env.
const API_HOST = (process.env.API_HOST || 'usat-api.kidderwise.org').toLowerCase();
const APP_HOST = (process.env.APP_HOST || 'usat-app.kidderwise.org').toLowerCase();
// 404 responder — a styled HTML page for browsers (Accept: text/html), JSON for API clients.
function not_found(req, res) {
  res.status(404);
  // req.path is stripped of the mount prefix inside app.use(prefix,…); originalUrl keeps the full path.
  const shown = req.originalUrl || req.path;
  if ((req.headers.accept || '').includes('text/html')) {
    const p = String(shown).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    return res.type('html').send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>404 &mdash; not found</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">'
      + '<style>html,body{height:100%}body{margin:0;background:#0e1b3a;color:#fff;font:16px system-ui,\'Segoe UI\',Arial,sans-serif;display:grid;place-items:center;text-align:center}'
      + '.hub{width:52px;height:52px;margin:0 auto 22px}h1{font-size:26px;font-weight:500;margin:0 0 10px}'
      + 'p{color:#9fb0d0;margin:0 0 6px}.sub{color:#6f80a3;font-size:13px;margin-bottom:26px}'
      + 'code{background:#1b2c4e;color:#cdd8ee;padding:2px 8px;border-radius:5px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}'
      + 'a{display:inline-block;background:#e4002b;color:#fff;text-decoration:none;font-weight:500;padding:10px 22px;border-radius:8px}</style>'
      + '<div><svg class="hub" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="7" fill="#e4002b"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="7" cy="7" r="2.5" fill="#fff"/><circle cx="25" cy="7" r="2.5" fill="#fff"/><circle cx="7" cy="25" r="2.5" fill="#fff"/><circle cx="25" cy="25" r="2.5" fill="#fff"/></svg>'
      + '<h1>404 &mdash; not found</h1><p><code>' + p + '</code> isn\'t here.</p>'
      + '<p class="sub">The app lives at ' + APP_HOST + '.</p>'
      + '<a href="https://' + APP_HOST + '/">Go to the app</a></div>'
    );
  }
  return res.json({ ok: false, error: 'not found', path: shown });
}

// Wrap a proxy middleware so it only runs on its tagged host. On the right host we run `mw` (proxy to
// the backend); on the wrong host we call next() to fall THROUGH to the next route — importantly the
// '/' catch-all — instead of 404ing or forwarding. This must WRAP the proxy (not sit beside it as
// `app.use(prefix, gate, mw)`), because in that form next() would just advance to `mw` at the same
// mount and still forward. Wrapping means a host mismatch skips the proxy entirely, so an api-tagged
// prefix like /events can coexist with an app page at /events/insurance-coi on the app host while the
// api backend stays unreachable there. If nothing else matches, the final not_found() still 404s.
function host_gate(which, mw) {
  const wanted = which === 'app' ? APP_HOST : API_HOST;
  return function (req, res, next) {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
    if (host === wanted || host === 'localhost' || host === '127.0.0.1') return mw(req, res, next);
    return next();
  };
}

const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#e4002b"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="7" cy="7" r="2.5" fill="#fff"/><circle cx="25" cy="7" r="2.5" fill="#fff"/><circle cx="7" cy="25" r="2.5" fill="#fff"/><circle cx="25" cy="25" r="2.5" fill="#fff"/></svg>';

function create_app() {
  const app = express();
  app.set('trust proxy', 1);
  app.set('json spaces', 2);
  app.set('etag', false); // live data — never 304/cache // pretty-print JSON (readable in a browser)

  const log_ts = function () { return new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }); };

  app.use(function (req, res, next) {
    if (req.path === '/api/status' || req.path === '/healthz' || req.path === '/api/test' || req.path === '/favicon.svg' || req.path === '/favicon.ico') return next();
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

  // Favicon (public) — USAT red hub.
  app.get('/favicon.svg', (req, res) => res.type('image/svg+xml').send(FAVICON));
  app.get('/favicon.ico', (req, res) => res.redirect('/favicon.svg'));

  // Health — the proxy's own status (uptime/mem/routes). Public; used by uptime checks + Ops Backends.
  app.get(['/api/status', '/healthz'], (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true, app: 'proxy',
      now_utc: new Date().toISOString(),
      now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: { rss: +(mem.rss / 1048576).toFixed(1), heap_used: +(mem.heapUsed / 1048576).toFixed(1) },
      pid: process.pid, node: process.version, pm2_name: process.env.name || 'usat_proxy', rate_limit: !!rate_limit, pm2_log_dir: PM2_LOG_DIR, routes: Object.keys(ROUTES),
    });
  });
  app.get('/api/test', (req, res) => res.json({ ok: true, msg: 'proxy is alive', time: new Date().toISOString() }));

  // Backend health aggregator — pings each routed backend's health endpoint. Public, read-only.
  // (The usat_apps Ops "Backends" pane has its own admin-gated /api/ops/health; this stays for
  // external uptime monitors and the proxy's own alerting baseline.)
  app.get('/api/health', async (req, res) => {
    const checked = {};
    await Promise.all(Object.entries(ROUTES).map(async ([prefix, cfg]) => {
      const target = typeof cfg === 'string' ? cfg : cfg.target;
      const health = (typeof cfg === 'object' && cfg.health) || '/api/status';
      const t0 = Date.now();
      try {
        const r = await fetch(target + health, { signal: AbortSignal.timeout(3000) });
        checked[prefix] = { ok: r.ok, status: r.status, ms: Date.now() - t0, target: target };
      } catch (e) {
        checked[prefix] = { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : ((e.cause && e.cause.code) || e.message), target: target };
      }
    }));
    const all_ok = Object.values(checked).every(r => r.ok);
    if (!all_ok) {
      const down = Object.keys(checked).filter(k => !checked[k].ok).map(k => k + ' (' + (checked[k].error || checked[k].status) + ')').join(', ');
      console.error('[' + log_ts() + '] !! /api/health 503 — down: ' + down);
    }
    res.status(all_ok ? 200 : 503).json({ ok: all_ok, checked, time: new Date().toISOString() });
  });

  // Reject bad methods
  const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  app.use((req, res, next) => {
    if (!ALLOWED_METHODS.includes(req.method)) return res.status(405).json({ ok: false, error: 'method not allowed' });
    next();
  });

  if (rate_limit) app.use(rate_limit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  // Forwarding rules — app.use(prefix,...) strips the prefix, so NO pathRewrite. More-specific
  // prefixes (/merge, /reporting, …) are registered before the '/' catch-all in proxy_routes.js,
  // so they match first; '/' forwards everything else to usat_apps (:8022).
  for (const [prefix, cfg] of Object.entries(ROUTES)) {
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    const mw = createProxyMiddleware({
      target, changeOrigin: true, ws: true, proxyTimeout: 30000, timeout: 30000,
      on: {
        proxyReq: (pr, req) => { console.log('[' + log_ts() + '] -> routed ' + prefix + '  ' + req.method + ' ' + req.url + '  to ' + target); },
        proxyRes: (pr, req) => { console.log('[' + log_ts() + '] <- ' + prefix + ' backend responded ' + pr.statusCode); },
        error: (err, req, res) => {
          console.error('[' + log_ts() + '] !! ' + prefix + ' backend error: ' + ((err && err.message) || err));
          if (res.writeHead && !res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'backend unavailable', path: req.url }));
        },
      },
    });
    // Gate each route to its tagged host (host:'api' | 'app'); untagged routes stay on both hosts.
    // host_gate WRAPS mw so a wrong-host request falls through to later routes instead of 404ing.
    const gate = cfg.host === 'app' ? host_gate('app', mw) : (cfg.host === 'api' ? host_gate('api', mw) : null);
    if (gate) app.use(prefix, gate);
    else app.use(prefix, mw);
  }

  app.use(not_found);
  return app;
}

async function start_server({ port = DEFAULT_PORT, silent = false } = {}) {
  const app = create_app();
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      active_server = server;
      const actual = server.address().port;
      if (!silent) {
        console.log('\nUSAT Proxy on http://localhost:' + actual + '   (/api/status — console now at usat_apps /ops)');
        console.log('  Press Ctrl-C to stop.\n');
      }
      if (is_test_ngrok) {
        try { require('./utilities/create_ngrok_tunnel').create_ngrok_tunnel(port); }
        catch (e) { console.warn('[proxy] ngrok not available:', e.message); }
      }
      try { require('./utilities/proxy/proxy_alerts').start(ROUTES); } catch (e) { console.warn('[proxy] alerts not started:', e.message); }
      resolve({ port: actual, server });
    });
    server.on('error', reject);
  });
}

function cleanup() { console.log('\nGracefully shutting down...'); process.exit(); }
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
if (require.main === module && process.stdin.isTTY) {
  require('readline').createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', cleanup);
}
if (require.main === module) {
  start_server({ port: DEFAULT_PORT }).catch((err) => { console.error('Proxy failed to start:', err); process.exit(1); });
}

module.exports = { create_app, start_server, DEFAULT_PORT };
