'use strict';
/**
 * log_ring.js — an in-memory ring buffer of the server's own console output, plus a pm2 stats reader.
 * (Ported from src/race_results_transform/admin/log_ring.js — identical behavior, used by the POC's
 *  /admin Logs panel.)
 *
 * install(console) patches console.log/info/warn/error so every line is ALSO captured into a ~500-line
 * ring (the real console still prints normally). The /admin Logs panel reads the ring (GET + SSE tail),
 * so you can watch server feedback in the browser. Works in dev (node server…) and prod (pm2).
 *
 * read_pm2() shells `pm2 jlist` (argv spawn, no shell) and pulls this process's status/uptime/restarts/
 * cpu/mem. If pm2 isn't installed or the process isn't found, it resolves { under_pm2:false } so the panel
 * can say so instead of erroring.
 */

const { spawn } = require('child_process');

const MAX = 500;
const ring = [];
const subs = new Set();
let installed = false;

function strip_ansi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

function push(level, text) {
  const at = new Date().toISOString();
  strip_ansi(text).split(/\r?\n/).forEach(function (line) {
    if (line === '') return;
    const evt = { at: at, level: level, line: line };
    ring.push(evt);
    if (ring.length > MAX) ring.shift();
    subs.forEach(function (res) { send_sse(res, 'line', evt); });
  });
}

function send_sse(res, event, data) {
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}

function install(target) {
  if (installed) return;
  installed = true;
  const con = target || console;
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    const original = con[level] ? con[level].bind(con) : function () {};
    con[level] = function () {
      const parts = Array.prototype.map.call(arguments, function (a) {
        return (typeof a === 'string') ? a : safe_stringify(a);
      });
      try { push(level === 'log' ? 'info' : level, parts.join(' ')); } catch (e) {}
      original.apply(null, arguments);
    };
  });
}

function safe_stringify(a) {
  try { return JSON.stringify(a); } catch (e) { return String(a); }
}

function tail(n) {
  const k = Math.max(1, Math.min(MAX, Number(n) || MAX));
  return ring.slice(-k);
}

function subscribe(res) {
  ring.slice(-100).forEach(function (evt) { send_sse(res, 'line', evt); });
  subs.add(res);
  res.on('close', function () { subs.delete(res); });
}

// ---- pm2 ------------------------------------------------------------------------------------------
function read_pm2(process_name) {
  return new Promise(function (resolve) {
    let out = '';
    let proc;
    const need_shell = process.platform === 'win32';   // pm2 is a .cmd shim on Windows
    try {
      proc = spawn('pm2', ['jlist'], { shell: need_shell });
    } catch (e) {
      return resolve({ under_pm2: false, reason: 'pm2 not available' });
    }
    const timer = setTimeout(function () { try { proc.kill(); } catch (e) {} resolve({ under_pm2: false, reason: 'pm2 timed out' }); }, 5000);
    proc.stdout.on('data', function (d) { out += d.toString(); });
    proc.on('error', function () { clearTimeout(timer); resolve({ under_pm2: false, reason: 'pm2 not installed' }); });
    proc.on('close', function () {
      clearTimeout(timer);
      let list;
      try { list = JSON.parse(out); } catch (e) { return resolve({ under_pm2: false, reason: 'could not parse pm2 output' }); }
      if (!Array.isArray(list) || !list.length) return resolve({ under_pm2: false, reason: 'no pm2 processes' });
      const proc_rec = list.find(function (p) { return p && p.name === process_name; }) || list[0];
      const pm2_env = proc_rec.pm2_env || {};
      const monit = proc_rec.monit || {};
      const uptime_ms = pm2_env.pm_uptime ? (Date.now() - pm2_env.pm_uptime) : null;
      resolve({
        under_pm2: true,
        name: proc_rec.name,
        status: pm2_env.status || 'unknown',
        restarts: pm2_env.restart_time || 0,
        uptime_ms: uptime_ms,
        cpu: monit.cpu != null ? monit.cpu : null,
        memory_bytes: monit.memory != null ? monit.memory : null,
        pid: proc_rec.pid || null,
        matched: proc_rec.name === process_name
      });
    });
  });
}

module.exports = {
  install: install,
  push: push,
  tail: tail,
  subscribe: subscribe,
  read_pm2: read_pm2,
  MAX: MAX
};
