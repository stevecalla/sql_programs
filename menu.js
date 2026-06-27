'use strict';
// menu.js — ops console for the USAT server fleet, fronted by the proxy (8000).
// Patterned on src/salesforce_email_queue_proof_of_concept/menu.js. No deps.
//   node menu.js        (interactive)
//   node menu.js test   (run proxy tests headless)

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

const APP = 'USAT Server Ops';
const DIR = __dirname;
const PREFS_FILE = path.join(DIR, '.menu_prefs.json');
const PROXY_PORT = Number(process.env.PROXY_PORT) || 8000;
const PROXY_BASE = 'http://127.0.0.1:' + PROXY_PORT;

const R = '\x1b[0m', BOLD = '\x1b[1m', GRAY = '\x1b[90m';
const CYAN = '\x1b[36m', MAGENTA = '\x1b[35m', GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', BLU = '\x1b[34m';
function c(col, s) { return col + s + R; }

function banner(title) {
  const text = APP + '  |  ' + title;
  const line = '='.repeat(Math.max(30, text.length + 4));
  console.log(''); console.log(c(CYAN, line)); console.log(c(BOLD, '  ' + text));
  console.log(c(GRAY, '  ' + new Date().toLocaleString())); console.log(c(CYAN, line)); console.log('');
}

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) {} }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) {} }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(function (res) { rl.question(q, res); }); }
function clean(s) { return String(s || '').trim().replace(/^["']|["']$/g, ''); }

// Spawn a child; let IT handle Ctrl-C (its own SIGINT cleanup), menu resumes on close.
function run(cmd, args) {
  return new Promise(function (resolve) {
    rl.pause();
    const need_shell = process.platform === 'win32' && cmd !== 'node';
    const ignore = function () {};
    process.on('SIGINT', ignore);
    const p = spawn(cmd, args, { cwd: DIR, stdio: 'inherit', shell: need_shell });
    p.on('close', function (code) { process.removeListener('SIGINT', ignore); rl.resume(); resolve(code); });
  });
}

async function get_json(pathname) {
  const url = PROXY_BASE + pathname;
  console.log(c(GRAY, '  GET ' + url));
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await r.json();
    console.log(c(r.ok ? GREEN : RED, '  HTTP ' + r.status));
    console.log(JSON.stringify(body, null, 2));
  } catch (e) {
    console.log(c(RED, '  Could not reach the proxy at ' + PROXY_BASE + ' — is it running?'));
    console.log(c(GRAY, '  ' + e.message));
  }
}

function exec_capture(cmd, args) {
  return new Promise(function (resolve, reject) {
    const p = spawn(cmd, args, { cwd: DIR, shell: process.platform === 'win32' });
    let out = '';
    p.stdout.on('data', function (d) { out += d.toString(); });
    p.on('error', reject);
    p.on('close', function () { resolve(out); });
  });
}

async function pick_and_restart() {
  console.log(c(GRAY, '  Loading pm2 process list...'));
  let names = [];
  try {
    const out = await exec_capture('npx', ['pm2', 'jlist']);
    const a = out.indexOf('['), b = out.lastIndexOf(']');
    names = JSON.parse(a >= 0 ? out.slice(a, b + 1) : out).map(function (x) { return x.name; });
  } catch (e) { console.log(c(RED, '  Could not read the pm2 list (is pm2 running?): ' + e.message)); return; }
  if (!names.length) { console.log(c(YEL, '  No pm2 processes are running.')); return; }
  names.forEach(function (n, i) { console.log('   ' + c(BLU, c(BOLD, '[' + (i + 1) + ']')) + ' ' + n); });
  const ans = clean(await ask('\n  Restart which # (or exact name): '));
  let name = names[Number(ans) - 1];
  if (!name && names.indexOf(ans) >= 0) name = ans;
  if (!name) { console.log(c(RED, '  No match — nothing restarted.')); return; }
  return run('npx', ['pm2', 'restart', name]);
}

function print_reminders() {
  const tips = [
    [YEL, 'Add / change a backend route'],
    [GRAY, '  1) edit proxy_routes.js   2) npm run pm2_reload_proxy   3) test usat-api.kidderwise.org/<prefix>/<endpoint>'],
    [YEL, 'Restart vs reload the proxy'],
    [GRAY, '  reload = npm run pm2_reload_proxy (zero-downtime)   restart = npm run restart_proxy (brief blip)'],
    [GRAY, '  Deploying a backend (pm2 restart <name>) needs NO proxy restart.'],
    [YEL, 'Open the VS Code log terminals (multi-pane)'],
    [GRAY, '  Ctrl+Shift+P -> "Tasks: Run Task" -> "All Logs (19 groups)"  (or "Test"). Ctrl+P then "task " also lists them.'],
    [YEL, 'Open the admin console'],
    [GRAY, '  Start the proxy, then browse ' + PROXY_BASE + '/admin  (login: PROXY_ADMIN_USER / PROXY_ADMIN_PASS in .env).'],
    [YEL, 'Cron jobs'],
    [GRAY, '  Unaffected — they call http://localhost:<port> directly, bypassing the proxy.'],
    [YEL, 'Rate limiter (optional, on the server)'],
    [GRAY, '  npm i express-rate-limit   (proxy runs fine without it; then reload)']
  ];
  console.log(''); tips.forEach(function (t) { console.log('  ' + c(t[0], t[1])); }); console.log('');
}

const SECTIONS = [
  { label: 'Tests', color: MAGENTA, items: [
    { label: 'Run proxy tests', desc: 'node --test on the proxy suite.', cli: 'npm run test_proxy', action: 'test_proxy' }
  ] },
  { label: 'Start the local server', color: GREEN, items: [
    { label: 'Run proxy in FOREGROUND (dev)', desc: 'node server_proxy_8000.js — Ctrl-C to stop.', cli: 'node server_proxy_8000.js', action: 'p_fg' },
    { label: 'Start proxy under pm2 (cluster)', desc: 'Background, 2 workers (server only — Linux path).', cli: 'npm run pm2_start_proxy', action: 'p_start' }
  ] },
  { label: 'Health & status', color: CYAN, items: [
    { label: 'Proxy alive (/api/test)', desc: 'No-backend smoke check.', cli: 'curl ' + PROXY_BASE + '/api/test', action: 'h_test' },
    { label: 'Proxy status (/api/status)', desc: 'Uptime, memory, routes.', cli: 'curl ' + PROXY_BASE + '/api/status', action: 'h_status' },
    { label: 'All backends health (/api/health)', desc: 'Up/down for every enabled backend.', cli: 'curl ' + PROXY_BASE + '/api/health', action: 'h_health' },
    { label: 'Open admin console (browser)', desc: 'Opens ' + PROXY_BASE + '/admin (proxy must be running).', cli: 'open ' + PROXY_BASE + '/admin', action: 'open_admin' }
  ] },
  { label: 'Proxy control (pm2)', color: BLU, items: [
    { label: 'Reload proxy (zero-downtime)', desc: 'After editing proxy_routes.js or proxy code.', cli: 'npm run pm2_reload_proxy', action: 'p_reload' },
    { label: 'Restart proxy (hard)', desc: 'Full restart; brief blip.', cli: 'npm run restart_proxy', action: 'p_restart' },
    { label: 'Stop proxy', desc: 'pm2 stop usat_proxy.', cli: 'npm run stop_proxy', action: 'p_stop' },
    { label: 'Show proxy', desc: 'pm2 show usat_proxy.', cli: 'npm run show_proxy', action: 'p_show' }
  ] },
  { label: 'Fleet (all servers)', color: RED, items: [
    { label: 'Start ALL servers (pm2)', desc: 'npm run pm2_run_all_servers (proxy first).', cli: 'npm run pm2_run_all_servers', action: 'fleet_start_all' },
    { label: 'Restart ALL servers (pm2)', desc: 'Restart every pm2 process.', cli: 'npm run pm2_restart_all', action: 'fleet_restart_all' },
    { label: 'Restart ONE server (pick)', desc: 'List pm2 processes and restart the one you choose.', cli: 'npx pm2 restart <name>', action: 'fleet_restart_one' }
  ] },
  { label: 'Logs (no SSH needed)', color: MAGENTA, items: [
    { label: 'List pm2 processes', desc: 'Status/restarts/memory.', cli: 'npx pm2 list', action: 'l_list' },
    { label: 'Tail proxy logs', desc: 'npx pm2 logs usat_proxy.', cli: 'npm run logs_proxy', action: 'l_proxy' },
    { label: 'Tail ALL logs', desc: 'npx pm2 logs (interleaved).', cli: 'npx pm2 logs', action: 'l_all' },
    { label: 'Tail one server by name', desc: 'Prompts for the pm2 name.', cli: 'npx pm2 logs <name>', action: 'l_pick' }
  ] },
  { label: 'Help', color: YEL, items: [
    { label: 'Reminders / cheat-sheet', desc: 'Routes, reload vs restart, VS Code tasks, admin console.', cli: '', action: 'reminders' }
  ] }
];

const ACTIONS = {
  test_proxy: function () { return run('npm', ['run', 'test_proxy']); },
  p_fg: function () { return run('node', ['server_proxy_8000.js']); },
  p_start: function () { return run('npm', ['run', 'pm2_start_proxy']); },
  h_test: function () { return get_json('/api/test'); },
  h_status: function () { return get_json('/api/status'); },
  h_health: function () { return get_json('/api/health'); },
  open_admin: function () {
    const url = PROXY_BASE + '/admin';
    const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    return run(cmd, args);
  },
  p_reload: function () { return run('npm', ['run', 'pm2_reload_proxy']); },
  p_restart: function () { return run('npm', ['run', 'restart_proxy']); },
  p_stop: function () { return run('npm', ['run', 'stop_proxy']); },
  p_show: function () { return run('npm', ['run', 'show_proxy']); },
  fleet_start_all: function () { return run('npm', ['run', 'pm2_run_all_servers']); },
  fleet_restart_all: function () { return run('npm', ['run', 'pm2_restart_all']); },
  fleet_restart_one: function () { return pick_and_restart(); },
  l_list: function () { return run('npx', ['pm2', 'list']); },
  l_proxy: function () { return run('npm', ['run', 'logs_proxy']); },
  l_all: function () { return run('npx', ['pm2', 'logs']); },
  l_pick: async function () { const name = clean(await ask('  pm2 name: ')); if (!name) return; return run('npx', ['pm2', 'logs', name]); },
  reminders: function () { print_reminders(); return Promise.resolve(0); }
};

function render() {
  console.clear();
  const rule = '='.repeat(64);
  console.log(c(CYAN, rule));
  console.log(c(CYAN, c(BOLD, '  ' + APP + ' — menu')) + c(GRAY, '   (' + DIR + ')'));
  console.log(c(GRAY, '  Proxy: ' + PROXY_BASE + '   Health checks need the proxy running.'));
  console.log(c(CYAN, rule));
  let n = 0; const map = {};
  SECTIONS.forEach(function (sec) {
    console.log(''); console.log(c(sec.color, c(BOLD, '  ' + sec.label)));
    sec.items.forEach(function (it) {
      n += 1; map[n] = it;
      console.log('   ' + c(sec.color, c(BOLD, '[' + n + ']')) + ' ' + c(BOLD, it.label) + c(GRAY, ' — ' + it.desc));
      if (_show_cli && it.cli) console.log('       ' + c(GRAY, '$ ' + it.cli));
    });
  });
  console.log('');
  console.log('  ' + c(BOLD, c(YEL, '[t]')) + c(GRAY, ' toggle CLI (' + (_show_cli ? 'on' : 'off') + ')    ') + c(BOLD, c(YEL, '[q]')) + c(GRAY, ' quit'));
  return map;
}

async function main() {
  load_prefs();
  if (process.argv[2] === 'test') { banner('Run proxy tests'); const code = await ACTIONS.test_proxy(); rl.close(); process.exit(code || 0); }
  for (;;) {
    const map = render();
    const ans = clean(await ask('\nChoose: ')).toLowerCase();
    if (ans === 'q' || ans === 'quit') break;
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = map[Number(ans)];
    if (!it) continue;
    banner(it.label);
    await ACTIONS[it.action]();
    await ask(c(GRAY, '\n(done — press Enter to return to the menu)'));
  }
  rl.close();
}

main();
