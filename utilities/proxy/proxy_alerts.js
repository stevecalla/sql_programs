'use strict';
/**
 * proxy_alerts.js — opt-in Slack alerting for the proxy. Posts ONLY on a state change, so it never spams:
 *   • a backend goes DOWN / RECOVERS (same health check the dashboard uses)
 *   • a pm2 process restarts many times in one interval (crash-loop, e.g. usat_slack)
 *
 * Enable in .env:  PROXY_ALERTS=true
 *   PROXY_ALERT_CHANNEL=steve_calla_slack_channel   (default; must map to a webhook in slack_message_api)
 *   PROXY_ALERT_INTERVAL_MS=120000                  (default 2 min)
 *   PROXY_ALERT_RESTART_JUMP=5                       (restarts in one interval that counts as a crash-loop)
 * Reuses the existing slack_message_api util. No-ops if disabled or if Slack isn't available.
 */
const { spawn } = require('child_process');

let slack_message_api = null;
try { ({ slack_message_api } = require('../slack_messaging/slack_message_api')); } catch (e) { /* optional */ }

const CHANNEL = process.env.PROXY_ALERT_CHANNEL || 'steve_calla_slack_channel';
const INTERVAL_MS = Number(process.env.PROXY_ALERT_INTERVAL_MS) || 120000;
const RESTART_JUMP = Number(process.env.PROXY_ALERT_RESTART_JUMP) || 5;

function notify(msg) { if (!slack_message_api) return; try { slack_message_api('🛰️ USAT Proxy — ' + msg, CHANNEL); } catch (e) {} }

async function check_backends(routes, state) {
  await Promise.all(Object.entries(routes).map(async ([prefix, cfg]) => {
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    const health = (typeof cfg === 'object' && cfg.health) || '/api/status';
    let ok = false, info = '';
    try { const r = await fetch(target + health, { signal: AbortSignal.timeout(4000) }); ok = r.ok; info = 'HTTP ' + r.status; }
    catch (e) { info = (e.cause && e.cause.code) || e.name || e.message; }
    const prev = state[prefix];
    if (prev !== undefined) {
      if (prev && !ok) notify('❌ ' + prefix + ' backend DOWN (' + info + ')');
      else if (!prev && ok) notify('✅ ' + prefix + ' backend recovered');
    }
    state[prefix] = ok;
  }));
}

function pm2_jlist(cb) {
  let out = '', proc;
  try { proc = spawn('pm2', ['jlist'], { shell: process.platform === 'win32', windowsHide: true }); }
  catch (e) { return cb(e); }
  const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 10000);
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.on('error', (e) => { clearTimeout(timer); cb(e); });
  proc.on('close', () => { clearTimeout(timer); try { cb(null, JSON.parse(out)); } catch (e) { cb(e); } });
}

function check_restarts(state) {
  pm2_jlist((err, list) => {
    if (err || !Array.isArray(list)) return;
    list.forEach((p) => {
      const name = p.name;
      const restarts = (p.pm2_env && p.pm2_env.restart_time) || 0;
      const prev = state[name];
      if (prev !== undefined && (restarts - prev) >= RESTART_JUMP) {
        notify('🔁 ' + name + ' restarted ' + (restarts - prev) + '× in the last ' + Math.round(INTERVAL_MS / 1000) + 's (possible crash-loop)');
      }
      state[name] = restarts;
    });
  });
}

function start(routes) {
  if (String(process.env.PROXY_ALERTS).toLowerCase() !== 'true') return;          // opt-in only
  if ((process.env.NODE_APP_INSTANCE || '0') !== '0') return;                      // one cluster worker only (no dup alerts)
  if (!slack_message_api) { console.warn('[alerts] slack_message_api unavailable — alerts disabled'); return; }
  console.log('[alerts] enabled → channel "' + CHANNEL + '", every ' + Math.round(INTERVAL_MS / 1000) + 's');
  const backend_state = {}, restart_state = {};
  const tick = () => { check_backends(routes, backend_state).catch(() => {}); check_restarts(restart_state); };
  const t = setInterval(tick, INTERVAL_MS); if (t.unref) t.unref();
  setTimeout(tick, 5000); // prime shortly after boot (records baseline; first cycle won't alert)
}

module.exports = { start };
