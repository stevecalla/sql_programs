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
const log_tail = require('./proxy_log_tail');   // tmux-style live tail of pm2 log files (Server cards)

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

// `pm2 jlist` via the CLI with a 2s shared cache so a burst of concurrent callers (all the card
// backfills on first load + the /api/pm2 poll) collapses into ONE spawn instead of dozens.
let _jlist_cache = { at: 0, data: null }, _jlist_waiters = [], _jlist_running = false;
function pm2_jlist(cb) {
  if (_jlist_cache.data && (Date.now() - _jlist_cache.at) < 2000) return cb(null, _jlist_cache.data);
  _jlist_waiters.push(cb);
  if (_jlist_running) return;
  _jlist_running = true;
  const { spawn } = require('child_process');
  let out = '', proc;
  const flush = (err, list) => { _jlist_running = false; const w = _jlist_waiters.splice(0); w.forEach((f) => { try { f(err, list); } catch (e) {} }); };
  try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32', windowsHide: true }); }
  catch (e) { return flush(e); }
  const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 10000);
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.on('error', (e) => { clearTimeout(timer); flush(e); });
  proc.on('close', () => {
    clearTimeout(timer);
    let list = null, err = null;
    try { list = JSON.parse(out); _jlist_cache = { at: Date.now(), data: list }; } catch (e) { err = e; }
    flush(err, list);
  });
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

  // Gated pm2 log tail. Resolves each process's ACTUAL log paths from `pm2 jlist`
  // (pm_out_log_path / pm_err_log_path) so it works regardless of where pm2 writes logs —
  // fixes cards that were blank because the guessed PM2_LOG_DIR/<name> file didn't exist.
  // Falls back to scanning PM2_LOG_DIR if pm2 jlist is unavailable.
  app.get('/api/logs', proxy_auth.require_auth, (req, res) => {
    const name = req.query.name;
    const lines = Math.min(Number(req.query.lines) || 200, 2000);
    const tailFile = (fp) => { try { return fs.readFileSync(fp, 'utf8').split(/\r?\n/).slice(-lines).join('\n'); } catch (e) { return null; } };
    const fromDir = () => {
      let files;
      try { files = fs.readdirSync(PM2_LOG_DIR).filter((f) => f.endsWith('.log')); }
      catch (e) { return res.status(500).json({ ok: false, error: 'cannot read pm2 log dir', dir: PM2_LOG_DIR, detail: e.message }); }
      if (!name) return res.json({ ok: true, dir: PM2_LOG_DIR, files });
      const logs = {};
      files.filter((f) => f === name || f.indexOf(name + '-') === 0 || f.indexOf(name) === 0)
        .forEach((f) => { const t = tailFile(path.join(PM2_LOG_DIR, f)); logs[f] = t == null ? '(error reading)' : t; });
      res.json({ ok: true, dir: PM2_LOG_DIR, name, lines, logs });
    };
    pm2_jlist((err, list) => {
      if (err) return fromDir();
      if (!name) return res.json({ ok: true, processes: (list || []).map((p) => p.name) });
      const logs = {};
      (list || []).filter((p) => p && p.name === name).forEach((p) => {
        const env = p.pm2_env || {};
        [['out', env.pm_out_log_path], ['error', env.pm_err_log_path]].forEach(([k, fp]) => {
          if (!fp) return; const t = tailFile(fp); if (t != null) logs[path.basename(fp)] = t;
        });
      });
      if (Object.keys(logs).length === 0) return fromDir();   // nothing readable → try the dir scan
      res.json({ ok: true, name, lines, logs });
    });
  });

  // Live "Server console": the proxy's own console output, mirrored into a ring buffer.
  // GET = snapshot tail; /stream = SSE (last 100 then live). Populates in dev AND under pm2,
  // unlike /api/logs which needs a <name>-out.log file on disk.
  app.get('/api/admin-logs', proxy_auth.require_auth, (req, res) => res.json({ ok: true, lines: log_ring.tail(req.query.n) }));
  app.get('/api/admin-logs/stream', proxy_auth.require_auth, (req, res) => { open_sse(res); log_ring.subscribe(res); });

  // Live per-process log stream — tails the real pm2 log files (tmux-style). ?name=<proc> for one,
  // omit for all (the Server-cards wall). Robust: no pm2 daemon/bus connection to keep alive.
  app.get('/api/logs/stream', proxy_auth.require_auth, (req, res) => { open_sse(res); log_tail.subscribe(res, req.query.name); });

  // Gated system health — live host stats (memory, swap, CPU load, disk, PSI, temps) read straight from
  // the OS, plus the latest daily summary if HEALTH_SUMMARY_FILE points at the cron's output file.
  app.get('/api/system', proxy_auth.require_auth, async (req, res) => {
    const out = { ok: true, host: os.hostname(), now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }), uptime_sec: Math.round(os.uptime()) };
    const la = os.loadavg(); const cores = os.cpus().length;
    out.cpu = { load1: +la[0].toFixed(2), load5: +la[1].toFixed(2), load15: +la[2].toFixed(2), cores: cores, util_pct: +((la[0] / cores) * 100).toFixed(1) };
    try {
      const kv = {}; fs.readFileSync('/proc/meminfo', 'utf8').split('\n').forEach((l) => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) kv[m[1]] = Number(m[2]) * 1024; });
      const total = kv.MemTotal, avail = (kv.MemAvailable != null ? kv.MemAvailable : kv.MemFree);
      out.memory = { total, available: avail, used: total - avail, used_pct: +(100 * (total - avail) / total).toFixed(1) };
      if (kv.SwapTotal) out.swap = { total: kv.SwapTotal, free: kv.SwapFree, used: kv.SwapTotal - kv.SwapFree, used_pct: +(100 * (kv.SwapTotal - kv.SwapFree) / kv.SwapTotal).toFixed(1) };
    } catch (e) { const t = os.totalmem(), f = os.freemem(); out.memory = { total: t, available: f, used: t - f, used_pct: +(100 * (t - f) / t).toFixed(1) }; }
    const psi = (file) => { try { const t = fs.readFileSync(file, 'utf8'); const s = (t.match(/some [^\n]*avg10=([\d.]+)/) || [])[1]; const fu = (t.match(/full [^\n]*avg10=([\d.]+)/) || [])[1]; return { some: s != null ? Number(s) : null, full: fu != null ? Number(fu) : null }; } catch (e) { return null; } };
    out.psi = { memory: psi('/proc/pressure/memory'), cpu: psi('/proc/pressure/cpu'), io: psi('/proc/pressure/io') };
    try { const base = '/sys/class/thermal'; const temps = {}; fs.readdirSync(base).filter((d) => d.indexOf('thermal_zone') === 0).forEach((z) => { try { const type = fs.readFileSync(base + '/' + z + '/type', 'utf8').trim(); const t = Number(fs.readFileSync(base + '/' + z + '/temp', 'utf8').trim()) / 1000; if (!isNaN(t)) temps[type] = +t.toFixed(1); } catch (e) {} }); out.temps = temps; } catch (e) { out.temps = {}; }
    try { await new Promise((resolve) => { (fs.statfs ? fs.statfs : (p, cb) => cb(new Error('no statfs')))('/', (err, st) => {
      if (!err && st) {
        const bs = st.bsize;
        const total = st.blocks * bs;                 // raw filesystem size (≈ df "Size")
        const avail = st.bavail * bs;                 // available to non-root (≈ df "Avail")
        const used = (st.blocks - st.bfree) * bs;     // actually used (≈ df "Used", excludes root reserve)
        const denom = used + avail || total;          // df bases Use% on used+avail, not raw size
        out.disk = { total, avail, free: avail, used, used_pct: +(100 * used / denom).toFixed(1) };
      }
      resolve();
    }); }); } catch (e) {}
    const tailText = (fp, max) => { try { const st = fs.statSync(fp); const start = Math.max(0, st.size - (max || 16000)); const len = st.size - start; const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); fs.closeSync(fd); return { text: b.toString('utf8'), mtime: st.mtime.toISOString() }; } catch (e) { return null; } };
    // Daily health summary: env override → the cron's saved summary → the raw metrics log.
    try {
      const cands = [process.env.HEALTH_SUMMARY_FILE,
        path.join(__dirname, 'utilities', 'cron_system_metrics', 'latest_summary.txt'),
        path.join(__dirname, 'utilities', 'cron_system_metrics', 'system_metrics.log')].filter(Boolean);
      for (const fp of cands) { if (fs.existsSync(fp)) { const r = tailText(fp, 8000); if (r) { out.summary = { path: fp, mtime: r.mtime, text: r.text }; break; } } }
    } catch (e) {}
    // Ubuntu update/upgrade log.
    try { const fp = process.env.UBUNTU_UPDATE_LOG || path.join(__dirname, 'utilities', 'cron_update_ubuntu', 'ubuntu-update.log'); if (fs.existsSync(fp)) { const r = tailText(fp, 8000); if (r) out.ubuntu = { path: fp, mtime: r.mtime, text: r.text }; } } catch (e) {}
    res.json(out);
  });

  // Gated "live commands" — run one of a fixed allow-list of read-only system snapshots (htop-style).
  // shell:false, fixed argv (no user input reaches the shell), capped output + timeout.
  const SYS_CMDS = {
    top:     { label: 'top',      bin: 'top',    argv: ['-b', '-n', '1'], note: 'Classic process monitor (batch snapshot). Built-in.' },
    htop:    { label: 'htop',     interactive: true, note: 'Interactive process viewer — run in a terminal (full-screen TUI). Install: sudo apt install htop' },
    btop:    { label: 'btop',     interactive: true, note: 'Modern CPU/RAM/disk/network monitor — run in a terminal (full-screen TUI). Install: sudo apt install btop' },
    atop:    { label: 'atop',     bin: 'atop',   argv: ['1', '1'], note: 'One resource sample incl. per-process. Install: sudo apt install atop' },
    glances: { label: 'glances',  bin: 'glances',argv: ['--stdout-csv', 'cpu,mem,load,uptime', '-t', '1', '--stop-after', '1'], note: 'All-in-one monitor (CSV snapshot). Install: sudo apt install glances' },
    nmon:    { label: 'nmon',     interactive: true, note: 'Interactive CPU/mem/disk/net summary — run in a terminal (full-screen TUI). Install: sudo apt install nmon' },
    procs:   { label: 'processes',bin: 'bash',   argv: ['-lc', 'ps -eo pid,ppid,%cpu,%mem,rss,comm --sort=-%cpu | head -n 30'], note: 'Top 30 processes by CPU.' },
    mem:     { label: 'free -h',  bin: 'free',   argv: ['-h'], note: 'Memory + swap usage.' },
    disk:    { label: 'df -h',    bin: 'df',     argv: ['-h'], note: 'Filesystem disk usage.' },
    vmstat:  { label: 'vmstat',   bin: 'vmstat', argv: ['1', '2'], note: 'Virtual memory / CPU / IO sample.' },
    uptime:  { label: 'uptime',   bin: 'uptime', argv: [], note: 'Uptime + load averages.' },
    sensors: { label: 'sensors',  bin: 'sensors',argv: [], note: 'Hardware temperatures (lm-sensors).' },
    pm2:     { label: 'pm2 list', bin: 'pm2',    argv: ['list'], note: 'pm2 process table.' },
  };
  app.get('/api/system/cmds', proxy_auth.require_auth, (req, res) => res.json({ ok: true, cmds: Object.keys(SYS_CMDS).map((id) => ({ id, label: SYS_CMDS[id].label, note: SYS_CMDS[id].note, interactive: !!SYS_CMDS[id].interactive })) }));
  app.get('/api/system/cmd', proxy_auth.require_auth, (req, res) => {
    const c = SYS_CMDS[String(req.query.name || '')]; if (!c) return res.status(400).json({ ok: false, error: 'unknown command' });
    if (c.interactive) return res.json({ ok: true, name: req.query.name, label: c.label, output: c.label + ' is a full-screen terminal app — it can\'t render here.\n\n' + c.note + '\n\nRun it in a terminal/SSH session.', time: new Date().toISOString() });
    const { spawn } = require('child_process');
    let out = '', proc;
    try { proc = spawn(c.bin, c.argv, { shell: false, windowsHide: true }); }
    catch (e) { return res.status(500).json({ ok: false, error: c.bin + ' not available', detail: e.message }); }
    const cap = () => { if (out.length > 60000) { out = out.slice(0, 60000) + '\n…(truncated)'; try { proc.kill(); } catch (e) {} } };
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 8000);
    proc.stdout.on('data', (d) => { out += d.toString(); cap(); });
    proc.stderr.on('data', (d) => { out += d.toString(); cap(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: c.bin + ': ' + e.message, output: out }); });
    proc.on('close', () => { clearTimeout(timer); res.json({ ok: true, name: req.query.name, label: c.label, output: out || '(no output)', time: new Date().toISOString() }); });
  });

  // Gated crontab view (read-only). `crontab -l` for the user the proxy runs as.
  app.get('/api/system/cron', proxy_auth.require_auth, (req, res) => {
    const { spawn } = require('child_process');
    let out = '', err = '', proc;
    try { proc = spawn('crontab', ['-l'], { shell: false, windowsHide: true }); }
    catch (e) { return res.json({ ok: false, error: 'crontab not available (Windows?)', detail: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 6000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); res.json({ ok: true, user: os.userInfo ? (os.userInfo().username || '') : '', crontab: (out.trim() || ('(no crontab installed for this user)' + (err ? '\n' + err.trim() : ''))), code, time: new Date().toISOString() }); });
  });

  // Gated crontab WRITE (guarded): validates every line, backs up the current crontab to a timestamped
  // file, then installs the new one via `crontab -`. Refuses empty input and obviously-bad lines.
  app.post('/api/system/cron', proxy_auth.require_auth, express.text({ type: '*/*', limit: '256kb' }), (req, res) => {
    const { spawn } = require('child_process');
    const content = String(req.body || '');
    if (!content.trim()) return res.status(400).json({ ok: false, error: 'refusing to write an empty crontab' });
    const bad = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => {
      if (l[0] === '#') return false;                                              // comment
      if (/^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)\s+\S/.test(l)) return false; // @shortcut + cmd
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) return false;                     // VAR=value
      return l.split(/\s+/).length < 6;                                           // need 5 time fields + a command
    });
    if (bad.length) return res.status(400).json({ ok: false, error: 'invalid cron line(s): ' + bad.slice(0, 3).join('  |  ') });
    const dir = path.join(__dirname, '.crontab_backups');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const backup = path.join(dir, 'crontab_' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak');
    let cur = '';
    const lister = spawn('crontab', ['-l'], { shell: false, windowsHide: true });
    lister.stdout.on('data', (d) => { cur += d.toString(); });
    lister.on('error', writeNew);
    lister.on('close', () => { try { fs.writeFileSync(backup, cur); } catch (e) {} writeNew(); });
    function writeNew() {
      let w; try { w = spawn('crontab', ['-'], { shell: false, windowsHide: true }); }
      catch (e) { return res.status(500).json({ ok: false, error: 'crontab not available', detail: e.message }); }
      let werr = '';
      w.stderr.on('data', (d) => { werr += d.toString(); });
      w.on('error', (e) => res.status(500).json({ ok: false, error: e.message }));
      w.on('close', (code) => { if (code === 0) { console.log('[' + log_ts() + '] [cron] crontab updated (backup ' + path.basename(backup) + ')'); res.json({ ok: true, backup: path.basename(backup), time: new Date().toISOString() }); } else res.status(500).json({ ok: false, error: 'crontab write failed (code ' + code + ')' + (werr ? ': ' + werr.trim() : ''), backup: path.basename(backup) }); });
      w.stdin.write(content.endsWith('\n') ? content : content + '\n'); w.stdin.end();
    }
  });

  // Gated disk-usage explorer — `du -h --max-depth=1 <path> | sort -h` for an allow-listed set of paths,
  // plus journald usage. Runs as the proxy user (no sudo), so protected dirs may be undercounted.
  const DU_PATHS = ['/', '/var', '/var/lib', '/var/lib/mysql', '/var/log', '/var/cache', '/var/lib/docker', '/home', '/usr', '/snap', '/tmp'];
  app.get('/api/system/du', proxy_auth.require_auth, (req, res) => {
    const { spawn } = require('child_process');
    const p = String(req.query.path || '');
    if (p === 'journal') {
      let out = '', proc;
      try { proc = spawn('journalctl', ['--disk-usage'], { shell: false, windowsHide: true }); }
      catch (e) { return res.json({ ok: false, error: e.message }); }
      const t = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 8000);
      proc.stdout.on('data', (d) => { out += d.toString(); }); proc.stderr.on('data', (d) => { out += d.toString(); });
      proc.on('error', (e) => { clearTimeout(t); res.json({ ok: false, error: e.message }); });
      proc.on('close', () => { clearTimeout(t); res.json({ ok: true, path: 'journal', output: out.trim() || '(no output)', time: new Date().toISOString() }); });
      return;
    }
    if (DU_PATHS.indexOf(p) < 0) return res.status(400).json({ ok: false, error: 'path not allowed' });
    let out = '', proc;
    try { proc = spawn('bash', ['-lc', 'du -h --max-depth=1 ' + p + ' 2>/dev/null | sort -h'], { shell: false, windowsHide: true }); }
    catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 60000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: e.message }); });
    proc.on('close', () => { clearTimeout(timer); res.json({ ok: true, path: p, output: out.trim() || '(no readable entries — protected dirs need sudo; run in a terminal for exact numbers)', time: new Date().toISOString() }); });
  });
  app.get('/api/system/du-paths', proxy_auth.require_auth, (req, res) => res.json({ ok: true, paths: DU_PATHS }));

  // Gated pm2 process list (status/cpu/mem/restarts/port) — Processes pane + fleet wall.
  // Uses the pm2 CLI (`pm2 jlist`) via spawn, NOT the pm2 module — so it never calls pm2.disconnect()
  // and therefore can't kill the launchBus log stream the Server cards rely on.
  app.get('/api/pm2', proxy_auth.require_auth, (req, res) => {
    pm2_jlist((err, list) => {
      if (err) return res.status(500).json({ ok: false, error: 'pm2 jlist failed', detail: (err && err.message) || String(err) });
      const processes = (list || []).map((p) => {
        const env = p.pm2_env || {}; const mon = p.monit || {};
        const script = String(env.pm_exec_path || '');
        const pm = script.match(/_(\d{3,5})\.[cm]?js$/);                 // server_<name>_<port>.js
        const port = pm ? Number(pm[1]) : (env.env && env.env.PORT ? Number(env.env.PORT) : null);
        return {
          name: p.name, pm_id: (p.pm_id != null ? p.pm_id : env.pm_id), status: env.status, cpu: mon.cpu,
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
    try { proc = spawn('pm2', args, { shell: process.platform === 'win32', windowsHide: true }); }
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
      try { require('./proxy_alerts').start(ROUTES); } catch (e) { console.warn('[proxy] alerts not started:', e.message); }
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
