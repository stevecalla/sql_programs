'use strict';
/**
 * log_tail.js — robust, tmux-style live log streaming by incrementally tailing each pm2 process's REAL
 * log files (pm_out_log_path / pm_err_log_path, discovered from `pm2 jlist`). Ported verbatim from
 * utilities/proxy/proxy_log_tail.js.
 *
 * subscribe(res, name) opens an SSE feed: a short backfill (last lines) then live new lines, each as
 *   event:line  data:{ at, level:'info'|'error', name, line }
 * name = one process, or falsy for ALL processes (the Server-cards wall).
 */
const fs = require('fs');
const { spawn } = require('child_process');

const POLL_MS = 1200;
const DISCOVER_MS = 5000;
const BACKFILL_ONE = 60;
const BACKFILL_ALL = 8;
const BACKFILL_MAX = 5000;         // hard cap on requested backfill
const TAIL_BYTES = 64 * 1024;      // live-poll read window
const BACKFILL_BYTES = 2 * 1024 * 1024;   // bigger window for the initial backfill (enough for thousands of lines)

const subs = new Set();
const files = {};
let started = false;

let jcache = { at: 0, data: null }, jwaiters = [], jrunning = false;
function jlist(cb) {
  if (jcache.data && (Date.now() - jcache.at) < 2000) return cb(null, jcache.data);
  jwaiters.push(cb);
  if (jrunning) return;
  jrunning = true;
  let out = '', proc;
  const done = (err, list) => { jrunning = false; const w = jwaiters.splice(0); w.forEach((f) => { try { f(err, list); } catch (e) { /* noop */ } }); };
  try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32', windowsHide: true }); }
  catch (e) { return done(e); }
  const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* noop */ } }, 10000);
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.on('error', (e) => { clearTimeout(timer); done(e); });
  proc.on('close', () => { clearTimeout(timer); let list = null, err = null; try { list = JSON.parse(out); jcache = { at: Date.now(), data: list }; } catch (e) { err = e; } done(err, list); });
}

function send(res, event, data) { try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client gone */ } }
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

function emit(name, level, text, id) {
  stripAnsi(text).split(/\r?\n/).forEach(function (line) {
    if (line === '') return;
    const evt = { at: new Date().toISOString(), level: level, name: name, line: line, id: id };  // id = pm2 instance (cluster worker number)
    subs.forEach(function (s) { if (!s.name || s.name === name) send(s.res, 'line', evt); });
  });
}

function readTailBytes(fp, window) {
  try {
    const win = window || TAIL_BYTES;
    const st = fs.statSync(fp); const start = Math.max(0, st.size - win); const len = st.size - start;
    if (len <= 0) return '';
    const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); fs.closeSync(fd);
    return b.toString('utf8');
  } catch (e) { return ''; }
}
// Read enough of the tail to yield ~n lines (bigger window for larger n).
function tailLines(fp, n) { const lines = stripAnsi(readTailBytes(fp, BACKFILL_BYTES)).split(/\r?\n/).filter(Boolean); return lines.slice(-n); }

function discover() {
  jlist(function (err, list) {
    if (err || !Array.isArray(list)) return;
    const seen = {};
    list.forEach(function (p) {
      const env = p.pm2_env || {};
      [['info', env.pm_out_log_path], ['error', env.pm_err_log_path]].forEach(function (pair) {
        const level = pair[0], fp = pair[1]; if (!fp) return; seen[fp] = 1;
        if (!files[fp]) { let size = 0; try { size = fs.statSync(fp).size; } catch (e) { /* noop */ } files[fp] = { name: p.name, level: level, size: size, id: p.pm_id }; }
        else { files[fp].name = p.name; files[fp].id = p.pm_id; }
      });
    });
    Object.keys(files).forEach(function (fp) { if (!seen[fp]) delete files[fp]; });
  });
}

function poll() {
  Object.keys(files).forEach(function (fp) {
    const f = files[fp];
    fs.stat(fp, function (err, st) {
      if (err) return;
      if (st.size < f.size) f.size = 0;
      if (st.size > f.size) {
        const start = f.size, end = st.size; f.size = end;
        const from = Math.max(start, end - TAIL_BYTES);
        let buf = ''; const stream = fs.createReadStream(fp, { start: from, end: end - 1, encoding: 'utf8' });
        stream.on('data', function (d) { buf += d; });
        stream.on('end', function () { if (buf) emit(f.name, f.level, buf, f.id); });
        stream.on('error', function () { /* noop */ });
      }
    });
  });
}

function ensureStarted() {
  if (started) return; started = true;
  discover();
  // unref'd so these background pollers never, on their own, keep a process (or a test) from exiting.
  const t1 = setInterval(discover, DISCOVER_MS); if (t1.unref) t1.unref();
  const t2 = setInterval(poll, POLL_MS); if (t2.unref) t2.unref();
}

function subscribe(res, name, backfill) {
  ensureStarted();
  // How many history lines to send up front: explicit request (clamped) or the per-mode default.
  let want = parseInt(backfill, 10);
  if (!Number.isFinite(want) || want <= 0) want = name ? BACKFILL_ONE : BACKFILL_ALL;
  want = Math.min(want, BACKFILL_MAX);
  jlist(function (err, list) {
    (list || []).forEach(function (p) {
      if (name && p.name !== name) return;
      const env = p.pm2_env || {};
      const fp = env.pm_out_log_path; if (!fp) return;
      tailLines(fp, want).forEach(function (line) {
        send(res, 'line', { at: new Date().toISOString(), level: 'info', name: p.name, line: line, id: p.pm_id });
      });
    });
  });
  const sub = { res: res, name: name || null };
  subs.add(sub);
  const ka = setInterval(function () { try { res.write(': keep-alive\n\n'); } catch (e) { /* noop */ } }, 25000);
  res.on('close', function () { clearInterval(ka); subs.delete(sub); });
}

module.exports = { subscribe: subscribe };
