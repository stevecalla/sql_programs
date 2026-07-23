#!/usr/bin/env node
'use strict';
/**
 * menu.js — event_coi module operations (Event / Race Certificate Request builder).
 *
 *   node src/usat_apps/modules/event_coi/menu.js
 *
 * The UI + API are served by the platform (:8022). Phase 3-4 adds a Playwright runner that logs into
 * the CSR24 portal and submits one certificate per holder. Self-contained (Node readline, no extra
 * packages); mirrors src/usat_apps/modules/salesforce_merge/menu.js. Launch directly, or from the
 * platform menu (src/usat_apps/menu.js).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');
const PORT = 8022;                          // platform (served UI + API)
const PAGE = '/insurance/event-coi';        // this module's route

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }
function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

function run_cmd(bin, args, label) {
  console.log(c(DIM, `  Running: ${bin} ${args.join(' ')}  (cwd: repo root)  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('close', (code) => { console.log(code === 0 ? c(GREEN, `\n  ✓ ${label} done.`) : c(RED, `\n  ✗ ${label} exited (${code}).`)); resolve(code); });
  });
}
function open_url(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: 'ignore' }); console.log(c(DIM, `  Opened ${url}`)); }
  catch { console.log(`  Open manually: ${url}`); }
}
function hit(pathname) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}${pathname}`, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  GET ${pathname} -> HTTP ${res.statusCode}`)); console.log('  ' + b.slice(0, 400)); resolve(); });
    }).on('error', (e) => { console.log(c(YELLOW, `  Backend not reachable on :${PORT} — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'RUN', color: YELLOW, items: [
    { id: 1, label: 'Dev — API + web (hot reload)', desc: 'Backend + Vite together; edits show live', bin: 'npm', args: ['run', 'usat_apps_dev_all'], cli: 'npm run usat_apps_dev_all' },
    { id: 2, label: 'Dev — web only (Vite)', desc: 'React UI dev server, proxies /api to :8022', bin: 'npm', args: ['run', 'usat_apps_web'], cli: 'npm run usat_apps_web' },
    { id: 3, label: 'Build the web app', desc: 'Compile React to web/dist (served at :8022)', bin: 'npm', args: ['run', 'usat_apps_build'], cli: 'npm run usat_apps_build' },
    { id: 4, label: 'Start built server (:8022)', desc: 'Express serves the built UI + API on one port', bin: 'npm', args: ['run', 'usat_apps_server'], cli: 'npm run usat_apps_server' },
  ]},
  { label: 'OPEN / STATUS', color: CYAN, items: [
    { id: 5, label: 'Open the Event COI page', desc: `Opens http://127.0.0.1:${PORT}${PAGE}`, act: () => open_url(`http://127.0.0.1:${PORT}${PAGE}`) },
    { id: 6, label: 'Backend status', desc: 'GET /api/status on :8022', act: () => hit('/api/status') },
    { id: 7, label: 'Module ping (needs sign-in)', desc: 'GET /api/event-coi/ping — Phase 2', act: () => hit('/api/event-coi/ping') },
  ]},
  { label: 'TESTS', color: CYAN, items: [
    { id: 8, label: 'Run module tests', desc: 'node src/usat_apps/run_tests.js modules/event_coi (holder_parse + validate_request)', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/event_coi'], cli: 'node src/usat_apps/run_tests.js modules/event_coi' },
  ]},
  { label: 'RUNNER — Playwright (Phase 3)', color: RED, items: [
    { id: 9, label: 'Portal dry run (login + fill, NO submit)', desc: 'Logs in, opens the form, fills one test holder, screenshots each stage to dry_run_screens/ — nothing is submitted. Prefix HEADLESS=0 to watch the browser.', bin: 'node', args: ['src/usat_apps/modules/event_coi/run_dry.js'], cli: 'node src/usat_apps/modules/event_coi/run_dry.js' },
  ]},
];

function render() {
  console.clear();
  console.log(c(BOLD, '\n  Event COI — module menu') + c(DIM, '   (Event / Race Certificate Request builder)\n'));
  SECTIONS.forEach((s) => {
    console.log('  ' + c(s.color, c(BOLD, s.label)));
    s.items.forEach((it) => {
      console.log('   ' + c(BOLD, String(it.id).padStart(2)) + '  ' + it.label);
      console.log('       ' + c(DIM, it.desc) + (_show_cli && it.cli ? c(CYAN, '   [' + it.cli + ']') : ''));
    });
    console.log('');
  });
  console.log(c(DIM, `  [t] ${_show_cli ? 'hide' : 'show'} CLI commands   [q] quit\n`));
}

async function main() {
  load_prefs();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const items = SECTIONS.flatMap((s) => s.items);
  for (;;) {
    render();
    const ans = (await prompt(rl, '  > ')).trim().toLowerCase();
    if (ans === 'q') break;
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = items.find((x) => String(x.id) === ans);
    if (!it) { continue; }
    console.log('');
    if (it.act) { await it.act(); }
    else { await run_cmd(it.bin, it.args, it.label); }
    await prompt(rl, c(DIM, '\n  (enter to return) '));
  }
  rl.close();
}
main();
