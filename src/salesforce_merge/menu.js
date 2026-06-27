#!/usr/bin/env node
/**
 * menu.js — interactive launcher for the Salesforce merge tool.
 *
 *   node src/salesforce_merge/menu.js      (or: npm run salesforce_merge_menu)
 *
 * Numbered menu built on Node's readline (no extra packages). Mirrors the email-queue menu:
 * a per-item short description, a [t] toggle to show/hide the underlying CLI command (persisted
 * to .menu_prefs.json), and [q] to quit. All commands run from the repo root.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }

function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

function run_npm(script, label) {
  console.log(c(DIM, `  Running: npm run ${script}  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn('npm', ['run', script], { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
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

function hit_status() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:8020/api/status', (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  HTTP ${res.statusCode}`)); console.log('  ' + b); resolve(); });
    }).on('error', (e) => { console.log(c(YELLOW, `  Backend not reachable on :8020 — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'RUN', color: YELLOW, items: [
    { id: 1, label: 'Dev — API + web (hot reload)', desc: 'Start backend + Vite together; edits show live', run: 'salesforce_merge_dev_all', cli: 'npm run salesforce_merge_dev_all' },
    { id: 2, label: 'Dev — backend only (nodemon)', desc: 'Express API on :8020, auto-restarts on change', run: 'salesforce_merge_dev', cli: 'npm run salesforce_merge_dev' },
    { id: 3, label: 'Dev — web only (Vite)', desc: 'React UI on :5173, proxies /api to :8020', run: 'salesforce_merge_web', cli: 'npm run salesforce_merge_web' },
    { id: 4, label: 'Build the web app', desc: 'Compile React to web/dist for production', run: 'salesforce_merge_build', cli: 'npm run salesforce_merge_build' },
    { id: 5, label: 'Start built server (:8020)', desc: 'Express serves the built UI + API on one port', run: 'salesforce_merge_server', cli: 'npm run salesforce_merge_server' },
  ]},
  { label: 'TESTING', color: CYAN, items: [
    { id: 6, label: 'Unit tests (node:test)', desc: 'Auth, API routes, dashboard reads — no DB needed', run: 'salesforce_merge_test', cli: 'npm run salesforce_merge_test' },
    { id: 7, label: 'E2E (Playwright)', desc: 'Browser smoke: login -> dashboard (stubs the API)', run: 'salesforce_merge_e2e', cli: 'npm run salesforce_merge_e2e' },
  ]},
  { label: 'OPEN', color: GREEN, items: [
    { id: 8, label: 'Open dev UI', desc: 'Vite dev server (hot reload) at :5173', open: 'http://localhost:5173', cli: 'open http://localhost:5173' },
    { id: 9, label: 'Open built UI', desc: 'Production-style single-port app at :8020', open: 'http://localhost:8020', cli: 'open http://localhost:8020' },
    { id: 10, label: 'Check API status', desc: 'Ping the backend health endpoint', status: true, cli: 'curl http://localhost:8020/api/status' },
  ]},
  { label: 'PM2 (production)', color: RED, items: [
    { id: 11, label: 'pm2 start', desc: 'Run the server under pm2 (production)', run: 'pm2_start_salesforce_merge', cli: 'npm run pm2_start_salesforce_merge' },
    { id: 12, label: 'pm2 restart', desc: 'Restart the pm2 process', run: 'restart_salesforce_merge', cli: 'npm run restart_salesforce_merge' },
    { id: 13, label: 'pm2 stop', desc: 'Stop the pm2 process', run: 'stop_salesforce_merge', cli: 'npm run stop_salesforce_merge' },
    { id: 14, label: 'pm2 logs', desc: 'Tail the pm2 logs', run: 'pm2_logs_salesforce_merge', cli: 'npm run pm2_logs_salesforce_merge' },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + RED, '\n  USAT Salesforce Merge tool'));
  console.log(c(DIM, '  ─────────────────────────────────────\n'));
  for (const s of SECTIONS) {
    console.log(c(s.color + BOLD, `  ${s.label}`));
    for (const it of s.items) {
      console.log(`  ${c(BOLD, String(it.id).padStart(3) + '.')} ${it.label.padEnd(30)} ${c(DIM, it.desc)}`);
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
    else if (it.run) await run_npm(it.run, it.label);
    else if (it.open) open_url(it.open);
    else if (it.status) await hit_status();
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
