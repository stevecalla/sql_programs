'use strict';
// Ops · Console registry + runner — the fleet ops the Operations pane can run. Ported from
// utilities/proxy/proxy_console_registry.js. Reached only behind require_admin. The client sends
// { id, params, confirm } — NEVER a command string; argv is assembled HERE from the registry and
// spawned shell:false (no shell = no injection). Output is ANSI-stripped, line-capped, timed out.
const { spawn } = require('child_process');
const path = require('path');
const { require_admin } = require('../../auth/require_auth');

const RUN_DIR = path.join(__dirname, '..', '..', '..', '..');  // repo root
const MAX_LINES = 4000;
const RUN_TIMEOUT_MS = 4 * 60 * 1000;

// Mirrors the root menu.js sections/items (the terminal fleet console) for the web Operations panel.
// web: 'run' (spawn + capture) | 'form' (validated param, then run) | 'link' (open a URL) |
//      'terminal' (greyed — interactive/streaming, run in a terminal / another pane).
const SECTIONS = [
  { label: 'Tests', items: [
    { id: 1, action: 'test_proxy', label: 'Run proxy tests', desc: 'node --test on the proxy suite.', cli: 'npm run test_proxy', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'test_proxy'] },
  ] },
  { label: 'Start the local server', items: [
    { id: 2, action: 'p_fg', label: 'Run proxy in FOREGROUND (dev)', desc: 'node server_proxy_8000.js — long-running.', cli: 'node server_proxy_8000.js', web: 'terminal', klass: 'na', note: 'Long-running foreground process — run it in a terminal.' },
    { id: 3, action: 'p_start', label: 'Start proxy under pm2', desc: 'Background, cluster workers.', cli: 'npm run pm2_start_proxy', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'pm2_start_proxy'], confirm: true },
  ] },
  { label: 'Health & status', items: [
    { id: 4, action: 'h_status', label: 'Proxy status (/api/status)', desc: 'Uptime, memory, routes.', cli: 'open /api/status', web: 'link', klass: 'read', href: '/api/status' },
    { id: 5, action: 'h_health', label: 'All backends health', desc: 'Up/down per backend.', cli: 'open /api/ops/health', web: 'link', klass: 'read', href: '/api/ops/health' },
  ] },
  { label: 'System health', items: [
    { id: 6, action: 'sys_monitor', label: 'System monitor (top/htop/…)', desc: 'CPU/mem/disk/net snapshots.', cli: 'top | htop | btop | …', web: 'terminal', klass: 'na', note: 'Use the System health pane → Live commands (or a terminal for the full-screen TUIs).' },
  ] },
  { label: 'Proxy control (pm2)', items: [
    { id: 7, action: 'reload_proxy', label: 'Reload proxy (zero-downtime)', desc: 'Re-reads proxy_routes.js; recycles workers.', cli: 'npm run pm2_reload_proxy', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'pm2_reload_proxy'] },
    { id: 8, action: 'restart_proxy', label: 'Restart proxy (hard)', desc: 'Full restart; brief blip.', cli: 'npm run restart_proxy', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'restart_proxy'] },
    { id: 9, action: 'stop_proxy', label: 'Stop proxy (danger)', desc: 'pm2 stop usat_proxy.', cli: 'npm run stop_proxy', web: 'run', klass: 'destruct', bin: 'npm', argv: ['run', 'stop_proxy'], confirm: true },
    { id: 10, action: 'show_proxy', label: 'Show proxy', desc: 'pm2 show usat_proxy (status, restarts, memory).', cli: 'npm run show_proxy', web: 'run', klass: 'read', bin: 'npm', argv: ['run', 'show_proxy'] },
  ] },
  { label: 'Fleet (all servers)', items: [
    { id: 11, action: 'start_all', label: 'Start ALL servers', desc: 'pm2_run_all_servers (proxy first). Long-running.', cli: 'npm run pm2_run_all_servers', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'pm2_run_all_servers'], confirm: true },
    { id: 12, action: 'restart_all', label: 'Restart ALL servers (danger)', desc: 'Bounce every pm2 process.', cli: 'npm run pm2_restart_all', web: 'run', klass: 'destruct', bin: 'npm', argv: ['run', 'pm2_restart_all'], confirm: true },
    { id: 13, action: 'restart_one', label: 'Restart ONE server', desc: 'Restart a single pm2 process by name.', cli: 'npx pm2 restart <name>', web: 'form', klass: 'mutate', bin: 'npx', argv: ['pm2', 'restart'], confirm: true, params: [{ name: 'name', label: 'pm2 name (e.g. usat_events)', type: 'name', required: true }] },
  ] },
  { label: 'Logs', items: [
    { id: 14, action: 'list_pm2', label: 'List pm2 processes', desc: 'Status/restarts/memory for every process.', cli: 'npx pm2 list', web: 'run', klass: 'read', bin: 'npx', argv: ['pm2', 'list'] },
    { id: 15, action: 'logs_proxy', label: 'Tail proxy logs', desc: 'Streams continuously.', cli: 'npm run logs_proxy', web: 'terminal', klass: 'na', note: 'Streams forever — use the Logs pane (pick the proxy) or a terminal.' },
    { id: 16, action: 'logs_all', label: 'Tail ALL logs', desc: 'Streams continuously.', cli: 'npx pm2 logs', web: 'terminal', klass: 'na', note: 'Streams forever — use the Server cards pane or a terminal.' },
    { id: 17, action: 'logs_one', label: 'Tail one server by name', desc: 'Streams one pm2 process.', cli: 'npx pm2 logs <name>', web: 'terminal', klass: 'na', note: 'Streams forever — use the Logs pane (pick the process) or a terminal.' },
  ] },
  { label: 'Help', items: [
    { id: 18, action: 'reminders', label: 'Reminders / cheat-sheet', desc: 'Routes, reload vs restart, tasks, console.', cli: '', web: 'terminal', klass: 'na', note: 'See the Reference pane for routes, reload-vs-restart, and the cheat-sheet.' },
  ] },
];
const ALL = SECTIONS.reduce(function (a, s) { return a.concat(s.items); }, []);
function by_id(id) { return ALL.find(function (it) { return String(it.id) === String(id); }) || null; }
function strip_ansi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

function assemble_argv(item, params) {
  params = params || {};
  const extra = [];
  (item.params || []).forEach(function (p) {
    let v = params[p.name];
    if (v == null) v = (p.default != null ? p.default : '');
    v = String(v).trim();
    if (p.required && !v) throw new Error('missing ' + p.name);
    if (p.type === 'name' && !/^[\w.\-]+$/.test(v)) throw new Error('invalid ' + p.name + ' (letters, digits, _ . - only)');
    extra.push(v);
  });
  return item.argv.concat(extra);
}
function run(item, params) {
  return new Promise(function (resolve) {
    let argv;
    try { argv = assemble_argv(item, params); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const timeout_ms = item.timeout_ms || RUN_TIMEOUT_MS;
    const lines = []; let truncated = false; let done = false;
    function push(t) { strip_ansi(t).split(/\r?\n/).forEach(function (l) { if (lines.length < MAX_LINES) lines.push(l); else truncated = true; }); }
    const p = spawn(item.bin, argv, { cwd: RUN_DIR, shell: process.platform === 'win32', windowsHide: true });
    const to = setTimeout(function () { if (!done) { try { p.kill('SIGKILL'); } catch (e) { /* noop */ } push('\n[timed out after ' + (timeout_ms / 1000) + 's]'); } }, timeout_ms);
    p.stdout.on('data', function (d) { push(d.toString()); });
    p.stderr.on('data', function (d) { push(d.toString()); });
    p.on('error', function (e) { done = true; clearTimeout(to); resolve({ ok: false, error: e.message, output: lines.join('\n') }); });
    p.on('close', function (code) { done = true; clearTimeout(to); resolve({ ok: code === 0, code: code, truncated: truncated, output: lines.join('\n') }); });
  });
}
function public_sections() {
  return SECTIONS.map(function (s) {
    return { label: s.label, items: s.items.map(function (it) {
      return { id: it.id, action: it.action, label: it.label, desc: it.desc, cli: it.cli, web: it.web, klass: it.klass, confirm: !!it.confirm, note: it.note || '', href: it.href || '', params: it.params || [] };
    }) };
  });
}

function mount(app) {
  app.get('/api/ops/console', require_admin, function (req, res) { res.json({ ok: true, sections: public_sections() }); });
  app.post('/api/ops/console/run', require_admin, async function (req, res) {
    const b = req.body || {};
    const item = by_id(b.id);
    if (!item) return res.status(404).json({ ok: false, error: 'unknown command id' });
    if (item.web !== 'run' && item.web !== 'form') return res.status(400).json({ ok: false, error: 'not runnable from the web' });
    if (item.confirm && b.confirm !== true) return res.status(400).json({ ok: false, error: 'confirmation required' });
    const result = await run(item, b.params || {});
    res.json(Object.assign({ id: item.id, action: item.action }, result));
  });
}

module.exports = { SECTIONS, by_id, run, public_sections, mount };
