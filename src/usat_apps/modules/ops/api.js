'use strict';
// Ops module — server API (/api/ops/*), admin-gated. Progressive port of the :8000 proxy console:
// READ-ONLY first (Backends health + the route table, ported from the proxy's /api/health +
// utilities/proxy/proxy_routes). Destructive endpoints (pm2 control, crontab write) come in later
// steps. The :8000 proxy stays the live parity reference until cutover.
const { require_admin } = require('../../auth/require_auth');
const console_ring = require('./console_ring');
const log_tail = require('./log_tail');
console_ring.install(console);   // capture usat_apps console output into the ring for the Server console

// The shared route table the proxy forwards on — required read-only (not moved).
let ROUTES = {};
try { ROUTES = require('../../../../utilities/proxy/proxy_routes'); } catch (e) { ROUTES = {}; }

// pm2 jlist (read-only). The pm2 CLI spawn is slow (~1-3s), so we keep a 2s cache and collapse a burst
// of callers into ONE spawn — so refreshes / concurrent loads return instantly instead of re-spawning.
let _jc = { at: 0, data: null }, _jw = [], _jr = false;
function pm2_jlist(cb) {
  if (_jc.data && (Date.now() - _jc.at) < 2000) return cb(null, _jc.data);
  _jw.push(cb);
  if (_jr) return;
  _jr = true;
  const { spawn } = require('child_process');
  let out = ''; let proc;
  const done = function (err, list) { _jr = false; const w = _jw.splice(0); w.forEach(function (f) { try { f(err, list); } catch (e) { /* noop */ } }); };
  try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32', windowsHide: true }); }
  catch (e) { return done(e); }
  const timer = setTimeout(function () { try { proc.kill(); } catch (e) { /* noop */ } }, 10000);
  proc.stdout.on('data', function (d) { out += d.toString(); });
  proc.on('error', function (e) { clearTimeout(timer); done(e); });
  proc.on('close', function () { clearTimeout(timer); let list = null, err = null; try { list = JSON.parse(out); if (list) _jc = { at: Date.now(), data: list }; } catch (e) { err = e; } done(err, list); });
}
function mapProc(p) {
  const env = p.pm2_env || {}; const mon = p.monit || {};
  const script = String(env.pm_exec_path || '');
  const pm = script.match(/_(\d{3,5})\.[cm]?js$/);
  const port = pm ? Number(pm[1]) : (env.env && env.env.PORT ? Number(env.env.PORT) : null);
  return {
    name: p.name, pm_id: (p.pm_id != null ? p.pm_id : env.pm_id), status: env.status,
    cpu: mon.cpu, memory_mb: typeof mon.memory === 'number' ? +(mon.memory / 1048576).toFixed(1) : null,
    restarts: env.restart_time, uptime_ms: env.pm_uptime ? (Date.now() - env.pm_uptime) : null, pid: p.pid, port: port,
  };
}

function routeList() {
  return Object.keys(ROUTES).map(function (prefix) {
    const cfg = ROUTES[prefix];
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    const health = (typeof cfg === 'object' && cfg.health) || '/api/status';
    return { prefix: prefix, target: target, health: health };
  });
}

function mount(app) {
  // The route table (prefix -> target/health). Backends pane lists these.
  app.get('/api/ops/routes', require_admin, function (req, res) {
    res.json({ ok: true, routes: routeList() });
  });

  // Backend health — ping each routed backend's health endpoint (ports the proxy's /api/health).
  app.get('/api/ops/health', require_admin, async function (req, res) {
    const checked = [];
    await Promise.all(routeList().map(async function (r) {
      const t0 = Date.now();
      try {
        const resp = await fetch(r.target + r.health, { signal: AbortSignal.timeout(3000) });
        checked.push({ prefix: r.prefix, ok: resp.ok, status: resp.status, ms: Date.now() - t0, target: r.target });
      } catch (e) {
        checked.push({ prefix: r.prefix, ok: false, error: e.name === 'TimeoutError' ? 'timeout' : ((e.cause && e.cause.code) || e.message), ms: Date.now() - t0, target: r.target });
      }
    }));
    checked.sort(function (a, b) { return a.prefix < b.prefix ? -1 : (a.prefix > b.prefix ? 1 : 0); });
    res.json({ ok: true, all_ok: checked.every(function (c) { return c.ok; }), checked: checked, time: new Date().toISOString() });
  });

  // Host process vitals (this usat_apps process) — mirrors the proxy's /api/status tiles.
  app.get('/api/ops/status', require_admin, function (req, res) {
    const mem = process.memoryUsage();
    res.json({
      ok: true, app: 'usat_apps',
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: { rss: +(mem.rss / 1048576).toFixed(1), heap_used: +(mem.heapUsed / 1048576).toFixed(1) },
      node: process.version, pid: process.pid, pm2_name: process.env.name || 'usat_apps',
      pm2_log_dir: process.env.PM2_LOG_DIR || require('path').join(require('os').homedir(), '.pm2', 'logs'),
      rate_limit: false,
      now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      now_utc: new Date().toISOString(),
    });
  });

  // pm2 process list (status/cpu/mem/restarts/uptime/port) — read-only.
  app.get('/api/ops/pm2', require_admin, function (req, res) {
    pm2_jlist(function (err, list) {
      if (err) return res.status(500).json({ ok: false, error: 'pm2 jlist failed', detail: (err && err.message) || String(err) });
      const processes = (list || []).map(mapProc);
      res.json({ ok: true, time: new Date().toISOString(), count: processes.length, processes: processes });
    });
  });

  // Server console — usat_apps's own console output. Snapshot + SSE live stream.
  app.get('/api/ops/console', require_admin, function (req, res) { res.json({ ok: true, lines: console_ring.tail(req.query.n) }); });
  app.get('/api/ops/console/stream', require_admin, function (req, res) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
    console_ring.subscribe(res);
  });

  // Per-process pm2 log stream (Server cards + Logs). ?name=<proc> for one, omit for ALL (the cards wall).
  app.get('/api/ops/logs/stream', require_admin, function (req, res) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
    log_tail.subscribe(res, req.query.name);
  });
}

module.exports = { mount };
