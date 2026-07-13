#!/usr/bin/env node
'use strict';
/**
 * menu.js — salesforce_merge module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/salesforce_merge/menu.js
 *
 * The merge UI + API are served by the platform (:8022). The heavy Salesforce writes run in an ISOLATED
 * worker process (server_salesforce_merge_worker_8021.js, port 8021) that claims queued jobs from
 * salesforce_merge_run and executes them — so one bad merge can't take the platform down. This menu
 * drives that worker (start / stop / logs / cluster), the Phase-3 smoke + worker-down tests, the DB
 * migrations, and quick status / opens. No admin / users here — the platform owns auth.
 *
 * Launched from the platform menu (src/usat_apps/menu.js -> MODULES -> Salesforce merge), or run directly.
 * Self-contained (Node readline, no extra packages); mirrors src/usat_apps/modules/participation_maps/menu.js.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');
const WORKER_PORT = 8021;
const PLATFORM_PORT = 8022;

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
function hit_status(port, label) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => { console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  ${label} :${port} -> HTTP ${res.statusCode}`)); console.log('  ' + b); resolve(); });
    }).on('error', (e) => { console.log(c(YELLOW, `  ${label} not reachable on :${port} — is it running? (${e.code || e.message})`)); resolve(); });
  });
}

const SECTIONS = [
  { label: 'WORKER · production (pm2)', color: RED, items: [
    { id: 1, label: 'pm2 start worker', desc: 'Start the isolated write worker on :8021 (autorestart on)', bin: 'npm', args: ['run', 'pm2_start_salesforce_merge_worker'], cli: 'npm run pm2_start_salesforce_merge_worker' },
    { id: 2, label: 'pm2 start worker CLUSTER (x2)', desc: 'Two worker instances sharing the queue (pm2 -i 2) — parallel merges', bin: 'npm', args: ['run', 'pm2_start_salesforce_merge_worker_cluster'], cli: 'npm run pm2_start_salesforce_merge_worker_cluster' },
    { id: 3, label: 'pm2 restart worker', desc: 'Restart the worker pm2 process', bin: 'npm', args: ['run', 'restart_salesforce_merge_worker'], cli: 'npm run restart_salesforce_merge_worker' },
    { id: 4, label: 'pm2 stop worker', desc: 'Stop the worker (queued jobs stay queued until it returns)', bin: 'npm', args: ['run', 'stop_salesforce_merge_worker'], cli: 'npm run stop_salesforce_merge_worker' },
    { id: 5, label: 'pm2 logs worker', desc: 'Tail the worker pm2 logs', bin: 'npm', args: ['run', 'pm2_logs_salesforce_merge_worker'], cli: 'npm run pm2_logs_salesforce_merge_worker' },
  ] },
  { label: 'WORKER · dev', color: YELLOW, items: [
    { id: 6, label: 'Run worker (foreground)', desc: 'node server_salesforce_merge_worker_8021.js — Ctrl-C to stop', bin: 'npm', args: ['run', 'salesforce_merge_worker'], cli: 'npm run salesforce_merge_worker' },
    { id: 7, label: 'Dev worker (nodemon)', desc: 'Auto-restarts on changes to the worker + merge store', bin: 'npm', args: ['run', 'salesforce_merge_worker_dev'], cli: 'npm run salesforce_merge_worker_dev' },
  ] },
  { label: 'TESTING', color: CYAN, items: [
    { id: 8, label: 'Smoke test (Phase 3)', desc: 'enqueue -> claim -> run -> done -> result parity. No UI / Salesforce / writes (~5s). Needs the DB.', bin: 'npm', args: ['run', 'salesforce_merge_worker_smoke'], cli: 'npm run salesforce_merge_worker_smoke' },
    { id: 9, label: 'Worker-down test', desc: 'Proves a merge stays QUEUED when 8021 is down and DRAINS when it returns. Stop the pm2 worker first.', bin: 'npm', args: ['run', 'salesforce_merge_worker_down_test'], cli: 'npm run salesforce_merge_worker_down_test' },
  ] },
  { label: 'DATABASE (idempotent migrations)', color: GREEN, items: [
    { id: 10, label: 'Migrate: created_at_mtn / created_at_utc', desc: 'Add the MTN/UTC timestamp columns to the four merge tables (also auto-applied on boot).', bin: 'node', args: ['src/queries/create_drop_db_table/alter_salesforce_merge_timestamps.js'], cli: 'node src/queries/create_drop_db_table/alter_salesforce_merge_timestamps.js' },
    { id: 11, label: 'Migrate: Phase-3 worker columns', desc: 'Ensure claimed_by / claimed_at / cancel_requested / params / result on salesforce_merge_run.', bin: 'node', args: ['src/queries/create_drop_db_table/alter_salesforce_merge_run_phase3.js'], cli: 'node src/queries/create_drop_db_table/alter_salesforce_merge_run_phase3.js' },
  ] },
  { label: 'STATUS & OPEN', color: GREEN, items: [
    { id: 12, label: 'Worker status (:8021)', desc: 'GET :8021/api/status — is the worker online? (the "no worker online" banner uses this)', status: WORKER_PORT, statusLabel: 'worker', cli: 'curl http://localhost:8021/api/status' },
    { id: 13, label: 'Platform status (:8022)', desc: 'GET :8022/api/status — usat_apps health (public)', status: PLATFORM_PORT, statusLabel: 'platform', cli: 'curl http://localhost:8022/api/status' },
    { id: 14, label: 'Open merge in the platform', desc: 'usat_apps at :8022 — the Salesforce merge page', open: `http://localhost:${PLATFORM_PORT}/salesforce/merge`, cli: `open http://localhost:${PLATFORM_PORT}/salesforce/merge` },
    { id: 15, label: 'Open via proxy (:8000)', desc: 'The merge page through the :8000 proxy', open: 'http://localhost:8000/salesforce/merge', cli: 'open http://localhost:8000/salesforce/merge' },
  ] },
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + CYAN, '\n  USAT Apps · Salesforce merge'));
  console.log(c(DIM, '  ─────────────────────────────────\n'));
  for (const s of SECTIONS) {
    console.log(c(s.color + BOLD, `  ${s.label}`));
    for (const it of s.items) {
      console.log(`  ${c(BOLD, String(it.id).padStart(3) + '.')} ${it.label.padEnd(32)} ${c(DIM, it.desc)}`);
      if (_show_cli && it.cli) console.log('       ' + c(DIM, '$ ' + it.cli));
    }
    console.log('');
  }
  console.log('  ' + c(BOLD + YELLOW, '[t]') + c(DIM, ` toggle CLI (${_show_cli ? 'on' : 'off'})    `) + c(BOLD + YELLOW, '[q]') + c(DIM, ' back / quit') + c(DIM, '    (or 0)'));
}

async function main() {
  load_prefs();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  while (true) {
    print_menu();
    const ans = (await prompt(rl, c(BOLD, '\n  Select: '))).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'b' || ans === 'back' || ans === '0') { console.log(c(DIM, '\n  Back.')); rl.close(); return; }
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = ALL.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) console.log(c(YELLOW, '  Invalid choice.'));
    else if (it.bin) await run_cmd(it.bin, it.args, it.label);
    else if (it.open) open_url(it.open);
    else if (it.status) await hit_status(it.status, it.statusLabel || '');
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
