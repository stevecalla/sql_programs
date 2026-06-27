'use strict';
/**
 * proxy_log_tail.js — robust, tmux-style live log streaming by incrementally tailing each pm2 process's
 * REAL log files (pm_out_log_path / pm_err_log_path, discovered from `pm2 jlist`).
 *
 * Why this instead of pm2.launchBus: launchBus depends on a persistent RPC/bus connection to the pm2
 * daemon that is easy to break (any pm2.disconnect anywhere kills it) and behaves oddly in cluster mode.
 * Tailing the files pm2 already writes is exactly how `tail -f` / tmux work: no daemon connection to keep
 * alive, survives proxy/app restarts and log rotation, and treats every process uniformly.
 *
 * subscribe(res, name) opens an SSE feed: a short backfill (last lines) then live new lines, each as
 *   event:line  data:{ at, level:'info'|'error', name, line }
 * name = one process, or falsy for ALL processes (the Server-cards wall).
 */

const fs = require('fs');
const { spawn } = require('child_process');

const POLL_MS = 1200;          // how often we check files for growth
const DISCOVER_MS = 5000;      // how often we re-read the pm2 process/log-path list
const BACKFILL_ONE = 60;       // lines of history when watching a single process
const BACKFILL_ALL = 8;        // lines of history per process when watching everything
const TAIL_BYTES = 64 * 1024;  // cap how much we read for backfill / per growth chunk

const subs = new Set();        // { res, name|null }
const files = {};              // filepath -> { name, level:'info'|'error', size }
let started = false;

// --- tiny cached `pm2 jlist` (2s) so discovery + backfills don't spawn a storm ---
let jcache = { at: 0, data: null }, jwaiters = [], jrunning = false;
function jlist(cb) {
  if (jcache.data && (Date.now() - jcache.at) < 2000) return cb(null, jcache.data);
  jwaiters.push(cb);
  if (jrunning) return;
  jrunning = true;
  let out = '', proc;
  const done = (err, list) => { jrunning = false; const w = jwaiters.splice(0); w.forEach((f) => { try { f(err, list); } catch (e) {} }); };
  try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32', windowsHide: true }); }
  catch (e) { return done(e); }
  const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 10000);
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.on('error', (e) => { clearTimeout(timer); done(e); });
  proc.on('close', () => { clearTimeout(timer); let list = null, err = null; try { list = JSON.parse(out); jcache = { at: Date.now(), data: list }; } catch (e) { err = e; } done(err, list); });
}

function send(res, event, data) { try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) {} }
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

function emit(name, level, text) {
  stripAnsi(text).split(/\r?\n/).forEach(function (line) {
    if (line === '') return;
    const evt = { at: new Date().toISOString(), level: level, name: name, line: line };
    subs.forEach(function (s) { if (!s.name || s.name === name) send(s.res, 'line', evt); });
  });
}

function readTailBytes(fp) {
  try {
    const st = fs.statSync(fp); const start = Math.max(0, st.size - TAIL_BYTES); const len = st.size - start;
    if (len <= 0) return '';
    const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); fs.closeSync(fd);
    return b.toString('utf8');
  } catch (e) { return ''; }
}
function tailLines(fp, n) { const lines = stripAnsi(readTailBytes(fp)).split(/\r?\n/).filter(Boolean); return lines.slice(-n); }

function discover() {
  jlist(function (err, list) {
    if (err || !Array.isArray(list)) return;
    const seen = {};
    list.forEach(function (p) {
      const env = p.pm2_env || {};
      [['info', env.pm_out_log_path], ['error', env.pm_err_log_path]].forEach(function (pair) {
        const level = pair[0], fp = pair[1]; if (!fp) return; seen[fp] = 1;
        if (!files[fp]) { let size = 0; try { size = fs.statSync(fp).size; } catch (e) {} files[fp] = { name: p.name, level: level, size: size }; }
        else files[fp].name = p.name;
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
      if (st.size < f.size) f.size = 0;              // truncated / rotated → re-read from start
      if (st.size > f.size) {
        const start = f.size, end = st.size; f.size = end;
        if (end - start > TAIL_BYTES) { /* huge burst — only keep the tail */ }
        const from = Math.max(start, end - TAIL_BYTES);
        let buf = ''; const stream = fs.createReadStream(fp, { start: from, end: end - 1, encoding: 'utf8' });
        stream.on('data', function (d) { buf += d; });
        stream.on('end', function () { if (buf) emit(f.name, f.level, buf); });
        stream.on('error', function () {});
      }
    });
  });
}

function ensureStarted() {
  if (started) return; started = true;
  discover();
  setInterval(discover, DISCOVER_MS);
  setInterval(poll, POLL_MS);
}

function subscribe(res, name) {
  ensureStarted();
  // immediate backfill so the panel is never blank
  jlist(function (err, list) {
    (list || []).forEach(function (p) {
      if (name && p.name !== name) return;
      const env = p.pm2_env || {};
      [['info', env.pm_out_log_path], ['error', env.pm_err_log_path]].forEach(function (pair) {
        const fp = pair[1]; if (!fp) return;
        tailLines(fp, name ? BACKFILL_ONE : BACKFILL_ALL).forEach(function (line) {
          send(res, 'line', { at: new Date().toISOString(), level: pair[0], name: p.name, line: line });
        });
      });
    });
  });
  const sub = { res: res, name: name || null };
  subs.add(sub);
  const ka = setInterval(function () { try { res.write(': keep-alive\n\n'); } catch (e) {} }, 25000);
  res.on('close', function () { clearInterval(ka); subs.delete(sub); });
}

module.exports = { subscribe: subscribe };
