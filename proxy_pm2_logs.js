'use strict';
/**
 * proxy_pm2_logs.js — live, per-process log streaming sourced from pm2's log bus.
 *
 * pm2.launchBus() opens a real-time feed of EVERY pm2 process's stdout/stderr (events 'log:out' /
 * 'log:err'). We keep a small per-process ring buffer and fan the lines out to SSE subscribers, so the
 * /admin Server cards can stream live exactly like the Overview console (which streams the proxy's own
 * output). This only works while pm2 is running the processes — locally without pm2 there's nothing to
 * stream, so the cards fall back to the file-tail snapshot (/api/logs).
 *
 * The bus is launched lazily on the first subscriber and kept open. If pm2/launchBus is unavailable, we
 * fail soft (no stream, no crash) and the file-tail backfill still paints the cards.
 */

const MAX_PER_PROC = 300;
const rings = {};          // name -> [ { at, level, name, line } ]
const subs = new Set();    // { res, name|null }
let bus = null;
let starting = false;
let started = false;

function send_sse(res, event, data) {
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}

function strip_ansi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

function push(name, level, data) {
  if (!name) return;
  strip_ansi(data).split(/\r?\n/).forEach(function (line) {
    if (line === '') return;
    const evt = { at: new Date().toISOString(), level: level, name: name, line: line };
    (rings[name] = rings[name] || []).push(evt);
    if (rings[name].length > MAX_PER_PROC) rings[name].shift();
    subs.forEach(function (s) { if (!s.name || s.name === name) send_sse(s.res, 'line', evt); });
  });
}

// Launch the pm2 bus once (lazy). Safe to call repeatedly.
function start() {
  if (started || starting) return;
  starting = true;
  let pm2;
  try { pm2 = require('pm2'); }
  catch (e) { starting = false; return; }
  try {
    pm2.launchBus(function (err, b) {
      starting = false;
      if (err || !b) return;            // fail soft — cards still get the file-tail backfill
      started = true; bus = b;
      bus.on('log:out', function (packet) { try { push(packet.process && packet.process.name, 'info', packet.data); } catch (e) {} });
      bus.on('log:err', function (packet) { try { push(packet.process && packet.process.name, 'error', packet.data); } catch (e) {} });
    });
  } catch (e) { starting = false; }
}

// Subscribe an SSE response. name = a single process, or falsy for ALL processes.
function subscribe(res, name) {
  start();
  if (name) { (rings[name] || []).slice(-50).forEach(function (e) { send_sse(res, 'line', e); }); }
  else { Object.keys(rings).forEach(function (k) { rings[k].slice(-10).forEach(function (e) { send_sse(res, 'line', e); }); }); }
  const sub = { res: res, name: name || null };
  subs.add(sub);
  // keep-alive comment every 25s so proxies/load-balancers don't drop the idle stream
  const ka = setInterval(function () { try { res.write(': keep-alive\n\n'); } catch (e) {} }, 25000);
  res.on('close', function () { clearInterval(ka); subs.delete(sub); });
}

module.exports = { subscribe: subscribe, push: push, start: start, MAX_PER_PROC: MAX_PER_PROC };
