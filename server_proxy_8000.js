#!/usr/bin/env node
/**
 * server_proxy_8000.js — single reverse proxy in front of the USAT server_*.js
 * services. One public host (usat-api.kidderwise.org) + path prefixes.
 * create_app()/start_server() factory; dual-stack listen; optional ngrok;
 * cleanup() on SIGINT/SIGTERM (+ readline TTY fallback). Management console at
 * /admin (cookie-session auth, mirrors email_queue). Pretty-printed JSON.
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
const proxy_console = require('./proxy_console_registry');
const log_ring = require('./proxy_log_ring');
const pm2_logs = require('./proxy_pm2_logs');

let rate_limit = null;
try { rate_limit = require('express-rate-limit'); }
catch (_) { console.warn('[proxy] express-rate-limit not installed — rate limiting disabled. Run: npm i express-rate-limit'); }

const DEFAULT_PORT = Number(process.env.PROXY_PORT) || 8000;
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || path.join(os.homedir(), '.pm2', 'logs');
const is_test_ngrok = false;
const ROUTES = require('./proxy_routes');
let active_server = null;

const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#e4002b"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="7" cy="7" r="2.5" fill="#fff"/><circle cx="25" cy="7" r="2.5" fill="#fff"/><circle cx="7" cy="25" r="2.5" fill="#fff"/><circle cx="25" cy="25" r="2.5" fill="#fff"/></svg>';

// Open a Server-Sent-Events stream (live "Server console" in /admin).
function open_sse(res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
}

function login_html(err) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Sign in — USAT Proxy</title>'
    + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
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
  app.set('json spaces', 2);
  app.set('etag', false); // live admin data — never 304/cache // pretty-print JSON (readable in a browser)

  const log_ts = function () { return new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }); };

  // Mirror this process's console output into an in-memory ring so /admin can tail it live (SSE).
  // Idempotent; never blocks startup. This is what makes the Logs panel populate in dev + under pm2.
  try { log_ring.install(console); } catch (e) { /* logging must never break the proxy */ }

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

  // Favicon (public) — USAT red hub, used by /admin + login.
  app.get('/favicon.svg', (req, res) => res.type('image/svg+xml').send(FAVICON));
  app.get('/favicon.ico', (req, res) => res.redirect('/favicon.svg'));

  // Health
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
  app.get('/api/me', proxy_auth.require_auth, (req, res) => res.json({ ok: true, user: proxy_auth.current_user(req), role: 'admin', auth: 'env account (PROXY_ADMIN_*)' }));

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

  // Management console
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

  // Gated pm2 log tail
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

  // Live "Server console": the proxy's own console output, mirrored into a ring buffer.
  // GET = snapshot tail; /stream = SSE (last 100 then live). Populates in dev AND under pm2,
  // unlike /api/logs which needs a <name>-out.log file on disk.
  app.get('/api/admin-logs', proxy_auth.require_auth, (req, res) => res.json({ ok: true, lines: log_ring.tail(req.query.n) }));
  app.get('/api/admin-logs/stream', proxy_auth.require_auth, (req, res) => { open_sse(res); log_ring.subscribe(res); });

  // Live per-process log stream from pm2's log bus (Server cards). ?name=<proc> for one, omit for all.
  // Works while pm2 is running the processes; otherwise the cards fall back to the /api/logs file tail.
  app.get('/api/logs/stream', proxy_auth.require_auth, (req, res) => { open_sse(res); pm2_logs.subscribe(res, req.query.name); });

  // Gated pm2 process list (status/cpu/mem/restarts/port) — Processes pane + fleet wall.
  // Uses the pm2 CLI (`pm2 jlist`) via spawn, NOT the pm2 module — so it never calls pm2.disconnect()
  // and therefore can't kill the launchBus log stream the Server cards rely on.
  app.get('/api/pm2', proxy_auth.require_auth, (req, res) => {
    const { spawn } = require('child_process');
    let out = '', errout = '', proc;
    try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32' }); }
    catch (e) { return res.status(500).json({ ok: false, error: 'pm2 not available', detail: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 6000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { errout += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.status(500).json({ ok: false, error: 'pm2 spawn failed', detail: e.message }); });
    proc.on('close', () => {
      clearTimeout(timer);
      let list;
      try { list = JSON.parse(out); } catch (e) { return res.status(500).json({ ok: false, error: 'could not parse pm2 jlist', detail: (errout || e.message).slice(0, 300) }); }
      const processes = (list || []).map((p) => {
        const env = p.pm2_env || {}; const mon = p.monit || {};
        const script = String(env.pm_exec_path || '');
        const pm = script.match(/_(\d{3,5})\.[cm]?js$/);                 // server_<name>_<port>.js
        const port = pm ? Number(pm[1]) : (env.env && env.env.PORT ? Number(env.env.PORT) : null);
        return {
          name: p.name, status: env.status, cpu: mon.cpu,
          memory_mb: typeof mon.memory === 'number' ? +(mon.memory / 1048576).toFixed(1) : null,
          restarts: env.restart_time, uptime_ms: env.pm_uptime ? (Date.now() - env.pm_uptime) : null,
          pid: p.pid, port: port,
        };
      });
      res.json({ ok: true, time: new Date().toISOString(), count: processes.length, processes });
    });
  });

  // Gated control actions (mirror the menu): reload the proxy, restart a server, restart all.
  // Shells the pm2 CLI (not the module) so it never disconnects the launchBus log stream.
  app.post('/api/control/:action', proxy_auth.require_auth, express.urlencoded({ extended: false }), (req, res) => {
    const { spawn } = require('child_process');
    const action = req.params.action;
    const name = String((req.query.name || (req.body && req.body.name) || '')).trim();
    let args;
    if (action === 'reload-proxy') args = ['reload', process.env.name || 'usat_proxy'];
    else if (action === 'restart' && /^[\w.-]+$/.test(name)) args = ['restart', name];
    else if (action === 'restart-all') args = ['restart', 'all'];
    else return res.status(400).json({ ok: false, error: 'unknown action or missing/invalid name' });
    console.log('[' + log_ts() + '] [control] pm2 ' + args.join(' '));
    let out = '', errout = '', proc;
    try { proc = spawn('pm2', args, { shell: process.platform === 'win32' }); }
    catch (e) { return res.status(500).json({ ok: false, error: 'pm2 spawn failed', detail: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 20000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { errout += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.status(500).json({ ok: false, error: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); res.json({ ok: code === 0, action, name: name || undefined, code, msg: (out || errout).slice(-500) }); });
  });

  // Console: registry of allowlisted ops (mirrors menu.js) + a runner (shell:false, capped+timed).
  app.get('/api/console', proxy_auth.require_auth, (req, res) => res.json({ ok: true, sections: proxy_console.public_sections() }));
  app.post('/api/console/run', proxy_auth.require_auth, express.json(), async (req, res) => {
    const b = req.body || {};
    const item = proxy_console.by_id(b.id);
    if (!item) return res.status(404).json({ ok: false, error: 'unknown command id' });
    if (item.web !== 'run' && item.web !== 'form') return res.status(400).json({ ok: false, error: 'not runnable from the web' });
    if (item.confirm && b.confirm !== true) return res.status(400).json({ ok: false, error: 'confirmation required' });
    console.log('[' + log_ts() + '] [console] run #' + item.id + ' ' + item.action);
    const result = await proxy_console.run(item, b.params || {});
    res.json(Object.assign({ id: item.id, action: item.action }, result));
  });

  // Reject bad methods
  const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  app.use((req, res, next) => {
    if (!ALLOWED_METHODS.includes(req.method)) return res.status(405).json({ ok: false, error: 'method not allowed' });
    next();
  });

  if (rate_limit) app.use(rate_limit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  // Forwarding rules — app.use(prefix,...) strips the prefix, so NO pathRewrite.
  for (const [prefix, cfg] of Object.entries(ROUTES)) {
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    app.use(prefix, createProxyMiddleware({
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
    }));
  }

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
        console.log('\nUSAT Proxy on http://localhost:' + actual + '   (/api/status, /admin)');
        console.log('  Press Ctrl-C to stop.\n');
      }
      if (is_test_ngrok) {
        try { require('./utilities/create_ngrok_tunnel').create_ngrok_tunnel(port); }
        catch (e) { console.warn('[proxy] ngrok not available:', e.message); }
      }
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
