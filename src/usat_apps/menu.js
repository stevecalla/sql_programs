#!/usr/bin/env node
/**
 * menu.js — interactive launcher for the USAT Apps platform.
 *
 *   node src/usat_apps/menu.js
 *
 * Numbered menu built on Node's readline (no extra packages). Mirrors the reporting/merge menus:
 * a per-item short description, a [t] toggle to show/hide the underlying CLI command (persisted to
 * .menu_prefs.json), and [q] to quit. Self-contained — runs node/npm directly (no root npm scripts),
 * so it works without editing the repo-root package.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_DIR = path.join(__dirname, 'web');
const SERVER = 'server_usat_apps_8022.js';
const PORT = 8022;
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }

function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

// Run a command (node or npm) with inherited stdio. `cwd` defaults to the repo root.
function run_cmd(bin, args, label, cwd) {
  console.log(c(DIM, `  Running: ${bin} ${args.join(' ')}  (cwd: ${path.relative(REPO_ROOT, cwd || REPO_ROOT) || '.'})  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: cwd || REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('close', (code) => {
      console.log(code === 0 ? c(GREEN, `\n  ✓ ${label} done.`) : c(RED, `\n  ✗ ${label} exited (${code}).`));
      resolve(code);
    });
  });
}

function open_url(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: 'ignore' }); console.log(c(DIM, `  Opened ${url}`)); }
  catch { console.log(`  Open manually: ${url}`); }
}

function hit_endpoint(pathname) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}${pathname}`, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => {
        console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  GET ${pathname} -> HTTP ${res.statusCode}`));
        console.log('  ' + b);
        if (res.statusCode === 401) console.log(c(DIM, '  (401 = not signed in from this tool — /api/me and /api/modules need a browser session cookie; sign in at the UI first.)'));
        resolve();
      });
    }).on('error', (e) => { console.log(c(YELLOW, `  Backend not reachable on :${PORT} — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'RUN', color: YELLOW, items: [
    { id: 1, label: 'Dev — API + web (hot reload)', desc: 'Backend + Vite together (concurrently); edits show live', bin: 'npm', args: ['run', 'usat_apps_dev_all'], cli: 'npm run usat_apps_dev_all' },
    { id: 2, label: 'Dev — backend only (nodemon)', desc: 'Express API on :8022, auto-restarts on change', bin: 'npm', args: ['run', 'usat_apps_dev'], cli: 'npm run usat_apps_dev' },
    { id: 3, label: 'Dev — web only (Vite)', desc: 'React UI on :5175, proxies /api to :8022', bin: 'npm', args: ['run', 'usat_apps_web'], cli: 'npm run usat_apps_web' },
    { id: 4, label: 'Build the web app', desc: 'npm install + compile React to web/dist (served at :8022)', bin: 'npm', args: ['run', 'usat_apps_build'], cli: 'npm run usat_apps_build' },
    { id: 5, label: 'Build for proxy (root base)', desc: 'Build with Vite base / for the :8000 proxy (served at usat-app root)', bin: 'npm', args: ['run', 'usat_apps_build_proxy'], cli: 'npm run usat_apps_build_proxy' },
    { id: 6, label: 'Start built server (:8022)', desc: 'Express serves the built UI + API on one port', bin: 'npm', args: ['run', 'usat_apps_server'], cli: 'npm run usat_apps_server' },
    { id: 7, label: 'Start proxy (:8000)', desc: 'Reverse proxy; serves the app at :8000/ (usat-app host)', bin: 'npm', args: ['run', 'proxy_server'], cli: 'npm run proxy_server' },
  ]},
  { label: 'TESTING', color: CYAN, items: [
    { id: 8, label: 'Run all tests', desc: 'Platform (auth, metrics, status) + all module suites — no DB', bin: 'npm', args: ['run', 'usat_apps_test'], cli: 'npm run usat_apps_test' },
    { id: 9, label: 'Participation maps tests', desc: 'Just the participation_maps module (agg, unique) \u2014 no DB', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/participation_maps'], cli: 'node src/usat_apps/run_tests.js modules/participation_maps' },
    { id: 10, label: 'E2E \u2014 UI/UX (Playwright)', desc: 'Browser suite: platform shell + participation map. Isolated build/port/creds \u2014 never touches the real dist. One-time: npx playwright install chromium', bin: 'npm', args: ['run', 'usat_apps_e2e'], cli: 'npm run usat_apps_e2e' },
    { id: 11, label: 'E2E \u2014 interactive runner', desc: 'Same suite in Playwright --ui (watch, step through, time-travel).', bin: 'npm', args: ['run', 'usat_apps_e2e_ui'], cli: 'npm run usat_apps_e2e_ui' },
  ]},
  { label: 'USERS & ACCESS', color: CYAN, items: [
    { id: 12, label: 'Add / update a user', desc: 'Create a web-app login (username/email, password, role)', bin: 'node', args: ['src/usat_apps/admin.js', 'add'], cli: 'node src/usat_apps/admin.js add' },
    { id: 13, label: 'List users', desc: 'Show .env recovery + stored web-app logins', bin: 'node', args: ['src/usat_apps/admin.js', 'list'], cli: 'node src/usat_apps/admin.js list' },
    { id: 14, label: 'Reset a user password', desc: 'Set a new password for an existing stored login', bin: 'node', args: ['src/usat_apps/admin.js', 'passwd'], cli: 'node src/usat_apps/admin.js passwd' },
    { id: 15, label: 'Remove a user', desc: 'Delete a stored login (prompts + confirm)', bin: 'node', args: ['src/usat_apps/admin.js', 'remove'], cli: 'node src/usat_apps/admin.js remove' },
    { id: 16, label: 'Show panel access', desc: 'Print the default + per-user panel allow-list + catalog', bin: 'node', args: ['src/usat_apps/admin.js', 'access'], cli: 'node src/usat_apps/admin.js access' },
  ]},
  { label: 'OPEN', color: GREEN, items: [
    { id: 17, label: 'Open built UI', desc: 'Production-style single-port app at :8022', open: `http://localhost:${PORT}`, cli: `open http://localhost:${PORT}` },
    { id: 18, label: 'Open dev UI', desc: 'Vite dev server (hot reload) at :5175', open: 'http://localhost:5175', cli: 'open http://localhost:5175' },
    { id: 19, label: 'Open via proxy (/)', desc: 'The app through the proxy at :8000/', open: 'http://localhost:8000/', cli: 'open http://localhost:8000/' },
    { id: 20, label: 'Check API status', desc: 'GET /api/status — backend health (public)', endpoint: '/api/status', cli: `curl http://localhost:${PORT}/api/status` },
    { id: 21, label: 'Check login / whoami', desc: 'GET /api/me — current user + role + panels (needs a signed-in session)', endpoint: '/api/me', cli: `curl http://localhost:${PORT}/api/me` },
    { id: 22, label: 'Show your modules', desc: 'GET /api/modules — the module catalog the nav is built from (needs a session)', endpoint: '/api/modules', cli: `curl http://localhost:${PORT}/api/modules` },
  ]},
  { label: 'PM2 (production)', color: RED, items: [
    { id: 23, label: 'pm2 start', desc: 'Run the server under pm2 (production)', bin: 'npm', args: ['run', 'pm2_start_usat_apps'], cli: 'npm run pm2_start_usat_apps' },
    { id: 24, label: 'pm2 restart', desc: 'Restart the pm2 process', bin: 'npm', args: ['run', 'restart_usat_apps'], cli: 'npm run restart_usat_apps' },
    { id: 25, label: 'pm2 stop', desc: 'Stop the pm2 process', bin: 'npm', args: ['run', 'stop_usat_apps'], cli: 'npm run stop_usat_apps' },
    { id: 26, label: 'pm2 logs', desc: 'Tail the pm2 logs', bin: 'npm', args: ['run', 'pm2_logs_usat_apps'], cli: 'npm run pm2_logs_usat_apps' },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + CYAN, '\n  USAT Apps'));
  console.log(c(DIM, '  ─────────────────────────────────────\n'));
  for (const s of SECTIONS) {
    console.log(c(s.color + BOLD, `  ${s.label}`));
    for (const it of s.items) {
      console.log(`  ${c(BOLD, String(it.id).padStart(3) + '.')} ${it.label.padEnd(32)} ${c(DIM, it.desc)}`);
      if (_show_cli && it.cli) console.log('       ' + c(DIM, '$ ' + it.cli));
    }
    console.log('');
  }
  console.log('  ' + c(BOLD + YELLOW, '[t]') + c(DIM, ` toggle CLI commands (${_show_cli ? 'on' : 'off'})    `) + c(BOLD + YELLOW, '[q]') + c(DIM, ' quit') + c(DIM, '    (or 0 to exit)'));
}

async function main() {
  load_prefs();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  while (true) {
    print_menu();
    const ans = (await prompt(rl, c(BOLD, '\n  Select: '))).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === '0') { console.log(c(DIM, '\n  Bye.')); rl.close(); return; }
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = ALL.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) console.log(c(YELLOW, '  Invalid choice.'));
    else if (it.bin) await run_cmd(it.bin, it.args, it.label, it.cwd);
    else if (it.open) open_url(it.open);
    else if (it.endpoint) await hit_endpoint(it.endpoint);
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
