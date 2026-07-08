'use strict';
// In-memory ring buffer of usat_apps's own console output + SSE fan-out. Ported from
// utilities/proxy/proxy_log_ring.js. install(console) patches console.* so every line is captured into
// a ~500-line ring (the real console still prints). The Ops Overview "Server console" reads it via SSE,
// so you can watch live server feedback in the browser (works in dev and under pm2).
const MAX = 500;
const ring = [];
const subs = new Set();
let installed = false;

function strip_ansi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }
function send_sse(res, event, data) { try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client gone */ } }

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
function safe_stringify(a) { try { return JSON.stringify(a); } catch (e) { return String(a); } }

function install(target) {
  if (installed) return;
  installed = true;
  const con = target || console;
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    const original = con[level] ? con[level].bind(con) : function () {};
    con[level] = function () {
      const parts = Array.prototype.map.call(arguments, function (a) { return (typeof a === 'string') ? a : safe_stringify(a); });
      try { push(level === 'log' ? 'info' : level, parts.join(' ')); } catch (e) { /* never break logging */ }
      original.apply(null, arguments);
    };
  });
}
function tail(n) { const k = Math.max(1, Math.min(MAX, Number(n) || MAX)); return ring.slice(-k); }
function subscribe(res) {
  ring.slice(-100).forEach(function (evt) { send_sse(res, 'line', evt); });
  subs.add(res);
  res.on('close', function () { subs.delete(res); });
}

module.exports = { install: install, push: push, tail: tail, subscribe: subscribe, MAX: MAX };
