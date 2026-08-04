#!/usr/bin/env node
'use strict';
/**
 * menu.js — salesforce_email_queue module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/salesforce_email_queue/menu.js
 *
 * The Email Queue UI + API are served by the platform (:8022) — read-only (no Salesforce writes), no
 * worker. This CLI menu is rendered FROM the same allow-list the admin → Operations web panel uses
 * (admin/console_registry.js), so the two surfaces stay ALIGNED by construction and both mirror the POC's
 * menu at parity. The menu adds a platform-only STATUS & OPEN section (status ping + open URLs).
 *
 * Interactive/terminal-only items the web panel can only note (browser E2E, SF read, corrections/context
 * views) run right here in the CLI; note-only pointers (server, users, list queues/statuses) print their
 * guidance. Metrics "AI ask" prompts for its params, then runs via the shared arg-assembler.
 *
 * Launched from the platform menu (src/usat_apps/menu.js -> MODULES -> Email Queue), or run directly.
 * Self-contained (Node readline, no extra packages); mirrors src/usat_apps/modules/salesforce_merge/menu.js.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');
const registry = require('./admin/console_registry');   // the shared Operations allow-list (source of truth)
const runner = require('./admin/console_runner');        // reuse the exact arg-assembler the web panel uses

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');
const PLATFORM_PORT = 8022;
const PROXY_PORT = 8000;

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BLUE = '\x1b[34m', MAGENTA = '\x1b[35m', CYAN = '\x1b[36m', GRAY = '\x1b[90m';
const c = (color, t) => `${color}${t}${RESET}`;
const COLORS = { RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN };
const color_for = (name) => COLORS[String(name || '').toUpperCase()] || CYAN;

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

// Command sections come straight from the Operations allow-list (aligned with /admin → Operations), then a
// platform-only STATUS & OPEN section. Registry ids are 1..N; the status/open items continue after them.
const CMD_SECTIONS = registry.SECTIONS.map((s) => ({ label: s.label, color: color_for(s.color), items: s.items }));
let _next = registry.ALL.reduce((m, it) => Math.max(m, it.id), 0);
// Cutover (data migration) — CLI-only (not a web Operations button, since COMMIT writes the DB).
const IMP = 'src/usat_apps/modules/salesforce_email_queue/import_corrections.js';
const CUTOVER_SECTION = { label: 'Cutover (data migration)', color: YELLOW, items: [
  { id: ++_next, label: 'Import corrections — DRY RUN', desc: 'Read the 8019 corrections.json, show counts; writes nothing.', bin: 'node', argv: [IMP], cli: 'node ' + IMP },
  { id: ++_next, label: 'Import corrections — COMMIT', desc: 'Idempotent upsert of corrections.json into the DB (run AFTER stopping 8019).', bin: 'node', argv: [IMP, '--commit'], cli: 'node ' + IMP + ' --commit' },
] };
const STATUS_SECTION = { label: 'Status & open (platform)', color: GREEN, items: [
  { id: ++_next, label: 'Platform status (:8022)', desc: 'GET :8022/api/status — usat_apps health (the module mounts here)', status: PLATFORM_PORT, statusLabel: 'platform', cli: 'curl http://localhost:8022/api/status' },
  { id: ++_next, label: 'Open Email Queue (:8022)', desc: 'The operator page on the platform', open: `http://localhost:${PLATFORM_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PLATFORM_PORT}/salesforce/email-queue` },
  { id: ++_next, label: 'Open via proxy (:8000)', desc: 'The operator page through the :8000 proxy', open: `http://localhost:${PROXY_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PROXY_PORT}/salesforce/email-queue` },
] };
const SECTIONS = CMD_SECTIONS.concat([CUTOVER_SECTION, STATUS_SECTION]);
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  const rule = '='.repeat(64);
  console.log(c(CYAN, rule));
  console.log(c(CYAN, c(BOLD, '  USAT Apps · Email Queue')));
  console.log(c(GRAY, '  Aligned with admin → Operations · ' + registry.ALL.length + ' commands + cutover + status/open.'));
  console.log(c(CYAN, rule));
  for (const s of SECTIONS) {
    console.log('');
    console.log(c(s.color, c(BOLD, '  ' + s.label)));
    console.log(c(s.color, '  ' + '-'.repeat(s.label.length)));
    for (const it of s.items) {
      console.log('   ' + c(s.color, c(BOLD, '[' + it.id + ']')) + ' ' + c(BOLD, it.label));
      if (it.desc) console.log('       ' + c(GRAY, it.desc));
      if (_show_cli && it.cli) console.log('       ' + c(GRAY, '$ ' + it.cli));
    }
  }
  console.log('');
  console.log('  ' + c(BOLD, c(YELLOW, '[t]')) + c(GRAY, ' toggle CLI commands (' + (_show_cli ? 'on' : 'off') + ')    ') + c(BOLD, c(YELLOW, '[q]')) + c(GRAY, ' quit') + c(GRAY, '    (or 0)'));
}

async function run_form(rl, it) {
  const params = {};
  for (const p of (it.params || [])) {
    const def = p.default != null ? String(p.default) : '';
    const ans = (await prompt(rl, c(BOLD, `  ${p.label || p.name}${def ? ` [${def}]` : ''}${p.required ? ' *' : ''}: `))).trim();
    params[p.name] = ans || def;
  }
  const built = runner.assemble_argv(it, params);
  console.log('');
  if (!built.ok) { console.log(c(RED, '  ' + (built.error || 'bad params'))); return null; }
  return built.argv;
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
    if (!it) { console.log(c(YELLOW, '  Invalid choice.')); }
    else if (it.status) { await hit_status(it.status, it.statusLabel || ''); }
    else if (it.open) { open_url(it.open); }
    else if (it.params) {                             // web:'form' (Ask-your-data) — prompt, assemble, run
      const argv = await run_form(rl, it);
      if (argv) { rl.close(); await run_cmd(it.bin, argv, it.label); rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); }
    }
    else if (it.bin) {                                // run/terminal items with a real command (tests, SF, metrics, e2e)
      rl.close();                                     // release stdin so an interactive child can read its own prompts
      await run_cmd(it.bin, it.argv, it.label);
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    }
    else if (it.note) { console.log(c(DIM, '  ' + it.note)); }   // note-only pointers (list queues, assist, server, users)
    else { console.log(c(DIM, '  (nothing to run — see the operator app / platform)')); }
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
