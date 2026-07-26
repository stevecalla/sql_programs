#!/usr/bin/env node
'use strict';
/**
 * menu.js — event_coi module operations (Event / Race Certificate Request builder).
 *
 *   node src/usat_apps/modules/event_coi/menu.js
 *
 * The React UI is served by usat_apps (:8022). THIS module's backend — the event_coi API
 * runs on the dedicated server_event_coi_8023.js. Self-contained (Node readline, no extra
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
const API_PORT = 8023;                       // THIS module's dedicated backend (event_coi API)
const WEB_PORT = 8022;                       // usat_apps serves the React UI + proxies /api/event-coi -> :8023
const PAGE = '/events/insurance-coi';        // this module's route on the web tier

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }
function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

function run_cmd(bin, args, label, env) {
  console.log(c(DIM, `  Running: ${bin} ${args.join(' ')}  (cwd: repo root)  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: env ? Object.assign({}, process.env, env) : process.env });
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
    http.get(`http://127.0.0.1:${API_PORT}${pathname}`, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  GET ${pathname} -> HTTP ${res.statusCode}`)); console.log('  ' + b.slice(0, 400)); resolve(); });
    }).on('error', (e) => { console.log(c(YELLOW, `  COI backend not reachable on :${API_PORT} — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'RUN — COI backend (:8023)', color: YELLOW, items: [
    { id: 1, label: 'COI backend — dev (hot reload, :8023)', desc: 'nodemon server_event_coi_8023.js — the event_coi API. Restarts on edits. This is what this module owns; the UI (:8022) is started from the usat_apps menu.', bin: 'npm', args: ['run', 'event_coi_dev'], cli: 'npm run event_coi_dev' },
    { id: 2, label: 'COI backend — start (:8023)', desc: 'node server_event_coi_8023.js — run the COI backend once (no auto-restart).', bin: 'npm', args: ['run', 'event_coi_server'], cli: 'npm run event_coi_server' },
    { id: 3, label: 'Deploy COI backend (pm2 :8023)', desc: 'npm run event_coi_deploy — (re)start the pm2 usat_event_coi process + reload the proxy. Use after pulling on the server.', bin: 'npm', args: ['run', 'event_coi_deploy'], cli: 'npm run event_coi_deploy' },
    { id: 4, label: 'Web UI — Vite dev (:5175, serves the page)', desc: 'npm run usat_apps_web — the React page lives on the web tier and proxies /api/event-coi -> :8023. Run this AND item 1 to use the page locally. (Full web build/serve lives in the usat_apps menu.)', bin: 'npm', args: ['run', 'usat_apps_web'], cli: 'npm run usat_apps_web' },
  ]},
  { label: 'OPEN / STATUS', color: CYAN, items: [
    { id: 5, label: 'Open the Event COI page', desc: `Opens http://127.0.0.1:${WEB_PORT}${PAGE} (web tier; needs the :8023 backend up too)`, act: () => open_url(`http://127.0.0.1:${WEB_PORT}${PAGE}`) },
    { id: 6, label: 'COI backend health (:8023)', desc: 'GET /api/event-coi/health on :8023 — public; reports the concurrency snapshot. Confirms the dedicated backend is up.', act: () => hit('/api/event-coi/health') },
    { id: 7, label: 'Module ping (:8023, needs sign-in)', desc: 'GET /api/event-coi/ping on :8023 — confirms the module is mounted + your panel access.', act: () => hit('/api/event-coi/ping') },
  ]},
  { label: 'TESTS', color: CYAN, items: [
    { id: 8, label: 'Run module tests', desc: 'node src/usat_apps/run_tests.js modules/event_coi (holder_parse + validate_request)', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/event_coi'], cli: 'node src/usat_apps/run_tests.js modules/event_coi' },
  ]},
  { label: 'RUNNER — Playwright (Phase 3)', color: RED, items: [
    { id: 9, label: 'Portal dry run (login + fill, NO submit)', desc: 'Headless. Logs in, opens the form, fills one test holder, screenshots each stage to dry_run_screens/ — nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/run_dry.js'], cli: 'node src/usat_apps/modules/event_coi/run_dry.js' },
    { id: 10, label: 'Portal dry run — WATCH (visible browser)', desc: 'Same as 9 but HEADED: opens a visible Chromium so you can watch login → open form → fill happen live. Still NO submit. Leaves the browser open at the end for you to inspect.', bin: 'node', args: ['src/usat_apps/modules/event_coi/run_dry.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/run_dry.js' },
  ]},
  { label: 'STRESS — concurrency (NO submit)', color: RED, items: [
    { id: 11, label: 'Concurrency stress test (headless)', desc: 'Spins up N real Playwright runs at once (login → open form → fill → screenshot), skipping the Submit click. Prompts for count + holders. Reports per-run timing, peak concurrent browsers, and total wall time. Cap = EVENT_COI_MAX_CONCURRENT.', bin: 'node', args: ['src/usat_apps/modules/event_coi/stress_test.js'], cli: 'node src/usat_apps/modules/event_coi/stress_test.js' },
    { id: 12, label: 'Concurrency stress test — WATCH', desc: 'Same as 11 but HEADED: opens N visible Chromium windows so you can watch them run in parallel. Still NO submit. Use a small count.', bin: 'node', args: ['src/usat_apps/modules/event_coi/stress_test.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/stress_test.js' },
  ]},
  { label: 'SUBMIT CHECK - verify the submit button (NO submit)', color: RED, items: [
    { id: 13, label: 'Submit-button check - WATCH', desc: 'Headed: logs in, fills the form, and INSPECTS the Submit button + form + anti-forgery token WITHOUT clicking Submit. Confirms the runner targets the real button and the form is POST-ready. Nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/submit_check.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/submit_check.js' },
    { id: 14, label: 'Submit-button check - headless', desc: 'Same as 13 but headless; prints the report to the console. Nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/submit_check.js'], cli: 'node src/usat_apps/modules/event_coi/submit_check.js' },
    { id: 15, label: 'Pending Requests check - WATCH', desc: 'Headed, read-only: logs in and opens the portal Pending Requests queue, screenshots it, and lists the rows. Never opens the certificate form or submits.', bin: 'node', args: ['src/usat_apps/modules/event_coi/pending_check.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/pending_check.js' },
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
    else { await run_cmd(it.bin, it.args, it.label, it.env); }
    await prompt(rl, c(DIM, '\n  (enter to return) '));
  }
  rl.close();
}
main();
