#!/usr/bin/env node
/**
 * menu.js — interactive launcher for the USAT Reporting app.
 *
 *   node src/reporting/menu.js      (or: npm run reporting_menu)
 *
 * Numbered menu built on Node's readline (no extra packages). Mirrors the Salesforce merge menu:
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

function run_node(args, label) {
  console.log(c(DIM, `  Running: node ${args.join(' ')}  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn('node', args, { cwd: REPO_ROOT, stdio: 'inherit', shell: false });
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
    http.get('http://127.0.0.1:8021/api/status', (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  HTTP ${res.statusCode}`)); console.log('  ' + b); resolve(); });
    }).on('error', (e) => { console.log(c(YELLOW, `  Backend not reachable on :8021 — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'RUN', color: YELLOW, items: [
    { id: 1, label: 'Dev — API + web (hot reload)', desc: 'Start backend + Vite together; edits show live', run: 'reporting_dev_all', cli: 'npm run reporting_dev_all' },
    { id: 2, label: 'Dev — backend only (nodemon)', desc: 'Express API on :8021, auto-restarts on change', run: 'reporting_dev', cli: 'npm run reporting_dev' },
    { id: 3, label: 'Dev — web only (Vite)', desc: 'React UI on :5174, proxies /api to :8021', run: 'reporting_web', cli: 'npm run reporting_web' },
    { id: 4, label: 'Build the web app', desc: 'Compile React to web/dist (served at root :8021)', run: 'reporting_build', cli: 'npm run reporting_build' },
    { id: 5, label: 'Build for proxy (/reporting base)', desc: 'Build with Vite base /reporting/ for usat-app behind the proxy', run: 'reporting_build_proxy', cli: 'npm run reporting_build_proxy' },
    { id: 6, label: 'Start built server (:8021)', desc: 'Express serves the built UI + API on one port', run: 'reporting_server', cli: 'npm run reporting_server' },
    { id: 7, label: 'Start proxy (:8000)', desc: 'Reverse proxy; serves the app at :8000/reporting/', run: 'proxy_server', cli: 'npm run proxy_server' },
  ]},
  { label: 'DATA PIPELINE (ETL)', color: YELLOW, items: [
    { id: 8, label: 'Reload region_data (from CSV)', desc: 'MySQL: drop + recreate region_data and load the usat_region_data CSV (state ⇄ region ⇄ lat/lng). Run after editing the region CSV, before step 3i.', node: ['reload_region_data.js'], cli: 'node reload_region_data.js' },
    { id: 9, label: 'Create ZIP code table (step 2b)', desc: 'MySQL: rebuild zip_lat_lng_reference (ZIP → lat/lng/city/state/county) from BigQuery public data', node: ['src/participation_data/step_2b_load_zip_reference.js'], cli: 'node src/participation_data/step_2b_load_zip_reference.js' },
    { id: 10, label: 'Create Census population table (step 2c)', desc: 'MySQL: rebuild census_state_population (state → population). Primary: US Census API (most current — needs CENSUS_API_KEY in .env); falls back to BigQuery public census (2021) if no key. Powers penetration / per-capita.', node: ['src/participation_data/step_2c_load_census_population.js'], cli: 'node src/participation_data/step_2c_load_census_population.js' },
    { id: 11, label: 'Build participation summary (step 3i)', desc: 'MySQL: rebuild summary + flows + events tables from the base data (all years)', node: ['src/participation_data/step_3i_create_participation_summary.js'], cli: 'node src/participation_data/step_3i_create_participation_summary.js' },
    { id: 12, label: 'Build participation summary — TEST (step 3i, 2024 & 2025)', desc: 'Same as step 3i above but in TEST mode (2024 & 2025 only) — faster dev run, same summary/flows/events tables, less data. Passes the "test" arg.', node: ['src/participation_data/step_3i_create_participation_summary.js', 'test'], cli: 'node src/participation_data/step_3i_create_participation_summary.js test' },
    { id: 13, label: 'Load metrics to BigQuery (step 3j)', desc: 'Upload summary / flows / events tables to BigQuery (WRITE_TRUNCATE)', node: ['src/participation_data/step_3j_load_bq_participation_summary_metrics.js'], cli: 'node src/participation_data/step_3j_load_bq_participation_summary_metrics.js' },
    { id: 14, label: 'Show data build scope (test vs full)', desc: 'Print the current reporting data scope recorded by step 3i — TEST (2024 & 2025) vs FULL, year range, and built-at.', node: ['show_build_scope.js'], cli: 'node show_build_scope.js' },
  ]},
  { label: 'TESTING', color: CYAN, items: [
    { id: 12, label: 'Unit tests (node:test)', desc: 'Status, auth flow, bootstrap gating — no DB needed', run: 'reporting_test', cli: 'npm run reporting_test' },
  ]},
  { label: 'SERVER & USERS', color: CYAN, items: [
    { id: 13, label: 'Add / update a user', desc: 'Create a web-app login (username, password, role)', node: ['src/reporting/admin.js', 'add'], cli: 'node src/reporting/admin.js add' },
    { id: 14, label: 'List users', desc: 'Show .env recovery + stored web-app logins', node: ['src/reporting/admin.js', 'list'], cli: 'node src/reporting/admin.js list' },
    { id: 15, label: 'Reset a user password', desc: 'Set a new password for an existing login (hashed)', node: ['src/reporting/admin.js', 'passwd'], cli: 'node src/reporting/admin.js passwd' },
    { id: 16, label: 'Remove a user', desc: 'Delete a stored login (prompts + confirm)', node: ['src/reporting/admin.js', 'remove'], cli: 'node src/reporting/admin.js remove' },
    { id: 17, label: 'Show panel access', desc: 'Print the default + per-user panel allow-list', node: ['src/reporting/admin.js', 'access'], cli: 'node src/reporting/admin.js access' },
    { id: 18, label: 'Auth + access tests', desc: 'auth_store roles, .env recovery, panel access', node: ['--test', 'src/reporting/tests/auth.test.js'], cli: 'node --test src/reporting/tests/auth.test.js' },
  ]},
  { label: 'OPEN', color: GREEN, items: [
    { id: 19, label: 'Open dev UI', desc: 'Vite dev server (hot reload) at :5174', open: 'http://localhost:5174', cli: 'open http://localhost:5174' },
    { id: 20, label: 'Open built UI', desc: 'Production-style single-port app at :8021', open: 'http://localhost:8021', cli: 'open http://localhost:8021' },
    { id: 21, label: 'Open via proxy (/reporting)', desc: 'The app through the proxy at :8000/reporting/', open: 'http://localhost:8000/reporting/', cli: 'open http://localhost:8000/reporting/' },
    { id: 22, label: 'Check API status', desc: 'Ping the backend health endpoint', status: true, cli: 'curl http://localhost:8021/api/status' },
    { id: 23, label: 'Census API — get a free key', desc: 'Opens the US Census API key signup. Add the key as CENSUS_API_KEY in .env to pull current population (ACS 1-yr) in step 2c; without it, step 2c uses the BigQuery 2021 fallback.', open: 'https://api.census.gov/data/key_signup.html', cli: 'open https://api.census.gov/data/key_signup.html' },
    { id: 24, label: 'About the Census ACS 1-year data', desc: 'Opens the US Census ACS 1-year documentation — the source of the state population used for penetration / per-capita metrics.', open: 'https://www.census.gov/data/developers/data-sets/acs-1year.html', cli: 'open https://www.census.gov/data/developers/data-sets/acs-1year.html' },
  ]},
  { label: 'PM2 (production)', color: RED, items: [
    { id: 23, label: 'pm2 start', desc: 'Run the server under pm2 (production)', run: 'pm2_start_reporting', cli: 'npm run pm2_start_reporting' },
    { id: 24, label: 'pm2 restart', desc: 'Restart the pm2 process', run: 'restart_reporting', cli: 'npm run restart_reporting' },
    { id: 25, label: 'pm2 stop', desc: 'Stop the pm2 process', run: 'stop_reporting', cli: 'npm run stop_reporting' },
    { id: 26, label: 'pm2 logs', desc: 'Tail the pm2 logs', run: 'pm2_logs_reporting', cli: 'npm run pm2_logs_reporting' },
  ]},
];
// Renumber ids sequentially in display order so inserting/removing items never needs a manual renumber.
let _seq = 0;
for (const s of SECTIONS) for (const it of s.items) it.id = ++_seq;
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + RED, '\n  USAT Reporting'));
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
    else if (it.run) await run_npm(it.run, it.label);
    else if (it.node) await run_node(it.node, it.label);
    else if (it.open) open_url(it.open);
    else if (it.status) await hit_status();
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
