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

const SECTIONS = [
  { label: 'Tests', items: [
    { id: 1, action: 'test_proxy', label: 'Run proxy tests', desc: 'node --test on the proxy suite (endpoints, auth, 404/405).', cli: 'npm run test_proxy', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'test_proxy'] },
  ] },
  { label: 'Proxy control', items: [
    { id: 2, action: 'reload_proxy', label: 'Reload proxy (zero-downtime)', desc: 'Re-reads proxy_routes.js; recycles workers one at a time.', cli: 'npm run pm2_reload_proxy', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'pm2_reload_proxy'] },
    { id: 3, action: 'restart_proxy', label: 'Restart proxy (hard)', desc: 'Full restart; brief blip.', cli: 'npm run restart_proxy', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'restart_proxy'] },
    { id: 4, action: 'show_proxy', label: 'Show proxy', desc: 'pm2 show usat_proxy (status, restarts, memory).', cli: 'npm run show_proxy', web: 'run', klass: 'read', bin: 'npm', argv: ['run', 'show_proxy'] },
    { id: 5, action: 'stop_proxy', label: 'Stop proxy (danger)', desc: 'pm2 stop usat_proxy — that host goes away until restarted.', cli: 'npm run stop_proxy', web: 'run', klass: 'destruct', bin: 'npm', argv: ['run', 'stop_proxy'], confirm: true },
  ] },
  { label: 'Fleet (all servers)', items: [
    { id: 6, action: 'list_pm2', label: 'List pm2 processes', desc: 'Status/restarts/memory for every process.', cli: 'npx pm2 list', web: 'run', klass: 'read', bin: 'npx', argv: ['pm2', 'list'] },
    { id: 7, action: 'restart_one', label: 'Restart ONE server', desc: 'Restart a single pm2 process by name.', cli: 'npx pm2 restart <name>', web: 'form', klass: 'mutate', bin: 'npx', argv: ['pm2', 'restart'], confirm: true, params: [{ name: 'name', label: 'pm2 name (e.g. usat_events)', type: 'name', required: true }] },
    { id: 8, action: 'restart_all', label: 'Restart ALL servers (danger)', desc: 'Bounce every pm2 process.', cli: 'npm run pm2_restart_all', web: 'run', klass: 'destruct', bin: 'npm', argv: ['run', 'pm2_restart_all'], confirm: true },
    { id: 9, action: 'start_all', label: 'Start ALL servers', desc: 'pm2_run_all_servers (proxy first). Long-running.', cli: 'npm run pm2_run_all_servers', web: 'run', klass: 'mutate', bin: 'npm', argv: ['run', 'pm2_run_all_servers'], confirm: true },
  ] },
  { label: 'Logs (use the Logs pane / a terminal)', items: [
    { id: 10, action: 'logs_proxy', label: 'Tail proxy logs', desc: 'Streams continuously — use the Logs pane, or a terminal.', cli: 'npm run logs_proxy', web: 'terminal', klass: 'na', note: 'Streams forever; open the Logs pane or run npm run logs_proxy in a terminal.' },
    { id: 11, action: 'logs_all', label: 'Tail ALL logs', desc: 'Streams continuously.', cli: 'npx pm2 logs', web: 'terminal', klass: 'na', note: 'Streams forever; run npx pm2 logs in a terminal.' },
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
    const lines = []; let truncated = false; let done = false;
    function push(t) { strip_ansi(t).split(/\r?\n/).forEach(function (l) { if (lines.length < MAX_LINES) lines.push(l); else truncated = true; }); }
    const p = spawn(item.bin, argv, { cwd: RUN_DIR, shell: process.platform === 'win32', windowsHide: true });
    const to = setTimeout(function () { if (!done) { try { p.kill('SIGKILL'); } catch (e) { /* noop */ } push('\n[timed out after ' + (RUN_TIMEOUT_MS / 1000) + 's]'); } }, RUN_TIMEOUT_MS);
    p.stdout.on('data', function (d) { push(d.toString()); });
    p.stderr.on('data', function (d) { push(d.toString()); });
    p.on('error', function (e) { done = true; clearTimeout(to); resolve({ ok: false, error: e.message, output: lines.join('\n') }); });
    p.on('close', function (code) { done = true; clearTimeout(to); resolve({ ok: code === 0, code: code, truncated: truncated, output: lines.join('\n') }); });
  });
}
function public_sections() {
  return SECTIONS.map(function (s) {
    return { label: s.label, items: s.items.map(function (it) {
      return { id: it.id, action: it.action, label: it.label, desc: it.desc, cli: it.cli, web: it.web, klass: it.klass, confirm: !!it.confirm, note: it.note || '', params: it.params || [] };
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
