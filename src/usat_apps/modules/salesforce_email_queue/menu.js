#!/usr/bin/env node
'use strict';
/**
 * menu.js — salesforce_email_queue module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/salesforce_email_queue/menu.js
 *
 * The Email Queue UI + API are served by the platform (:8022) — read-only (no Salesforce writes), no
 * worker. This menu drives the module/services tests, the live SF-read + corrections-DB smokes, and
 * quick status / opens. No admin / users here — the platform owns auth.
 *
 * Launched from the platform menu (src/usat_apps/menu.js -> MODULES -> Email Queue), or run directly.
 * Self-contained (Node readline, no extra packages); mirrors src/usat_apps/modules/salesforce_merge/menu.js.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');
const PLATFORM_PORT = 8022;
const PROXY_PORT = 8000;

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

const M = 'src/usat_apps/modules/salesforce_email_queue';   // script path prefix (cwd = repo root)

const SECTIONS = [
  { label: 'TESTS (no DB / no Salesforce)', color: GREEN, items: [
    { id: 1, label: 'Module tests (sf + api gate)', desc: 'The salesforce_email_queue module suite — sf_threads + panel-gate contract', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/salesforce_email_queue'], cli: 'node src/usat_apps/run_tests.js modules/salesforce_email_queue' },
    { id: 2, label: 'Shared services tests', desc: 'services/{ai,text_clean,knowledge,corrections,salesforce} — the shared brain', bin: 'node', args: ['src/usat_apps/run_tests.js', 'services'], cli: 'node src/usat_apps/run_tests.js services' },
  ] },
  { label: 'SALESFORCE · read (live)', color: CYAN, items: [
    { id: 3, label: 'Verify SF read — Production', desc: 'Connect (read role) + list queues via services/salesforce. Needs SF_PROD_* + network.', bin: 'node', args: [`${M}/check_sf_read.js`], cli: `node ${M}/check_sf_read.js` },
    { id: 4, label: 'Verify SF read — Sandbox', desc: 'Same, against the dev org (SF_DEV_* + test.salesforce.com).', bin: 'node', args: [`${M}/check_sf_read.js`, '--sandbox'], cli: `node ${M}/check_sf_read.js --sandbox` },
  ] },
  { label: 'DATABASE (live)', color: YELLOW, items: [
    { id: 5, label: 'Corrections DB smoke', desc: 'Ensure salesforce_email_queue_corrections, insert a test row, read it back. Needs LOCAL_MYSQL_*.', bin: 'node', args: [`${M}/check_corrections_db.js`], cli: `node ${M}/check_corrections_db.js` },
  ] },
  { label: 'STATUS & OPEN', color: GREEN, items: [
    { id: 6, label: 'Platform status (:8022)', desc: 'GET :8022/api/status — usat_apps health (the module mounts here)', status: PLATFORM_PORT, statusLabel: 'platform', cli: 'curl http://localhost:8022/api/status' },
    { id: 7, label: 'Open Email Queue in the platform', desc: 'usat_apps at :8022 — the Email Queue page (scaffold UI until Phase 3)', open: `http://localhost:${PLATFORM_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PLATFORM_PORT}/salesforce/email-queue` },
    { id: 8, label: 'Open via proxy (:8000)', desc: 'The Email Queue page through the :8000 proxy', open: `http://localhost:${PROXY_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PROXY_PORT}/salesforce/email-queue` },
  ] },
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + CYAN, '\n  USAT Apps · Email Queue'));
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
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  while (true) {
    print_menu();
    const ans = (await prompt(rl, c(BOLD, '\n  Select: '))).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'b' || ans === 'back' || ans === '0') { console.log(c(DIM, '\n  Back.')); rl.close(); return; }
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = ALL.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) console.log(c(YELLOW, '  Invalid choice.'));
    else if (it.info) console.log(it.info);
    else if (it.bin) {
      rl.close();                                   // release stdin so an interactive child can read its own prompts
      await run_cmd(it.bin, it.args, it.label);
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    }
    else if (it.open) open_url(it.open);
    else if (it.status) await hit_status(it.status, it.statusLabel || '');
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
