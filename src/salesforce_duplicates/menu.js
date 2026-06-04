#!/usr/bin/env node
/**
 * menu.js — Interactive launcher for the Salesforce duplicates tool.
 *
 * Usage:
 *   node menu.js
 *
 * Shows a numbered list. Type the number and press Enter. Uses only the
 * Node.js built-in readline — no extra packages. Includes a "Show/hide CLI
 * commands" toggle that prints the equivalent "$ ..." command under each item
 * (in-session only — it resets when the menu restarts).
 */

'use strict';
const dotenv = require('dotenv');
dotenv.config({ path: '../../.env' });

const path = require('path');
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const { determineOSPath } = require('../../utilities/determineOSPath');
const { OUTPUT_DIR_NAME, ARCHIVE_DIR_NAME } = require('./config');

const DIR = __dirname;
const MAIN_SCRIPT = 'step_1_find_duplicates.js';
const SERVER_PORT = 8017;

// ── Colors ────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const c = (color, text) => `${color}${text}${RESET}`;

// ── CLI-command toggle (in-session only; resets when the menu restarts) ─────
let _show_cli = false;

// ── Helpers ───────────────────────────────────────────────────────────────
function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// Spawn `node <args>` from this directory, streaming output to the console,
// and resolve with the exit code. Used for the real script and tests
// (tests need `--test` as a node flag, so we spawn node directly).
function run_node(args, label, env = {}) {
  console.log(c(DIM, `  Running ${label}: node ${args.join(' ')}\n`));
  return new Promise((resolve) => {
    const proc = spawn(process.execPath ?? 'node', args, {
      stdio: 'inherit',
      cwd: DIR,
      shell: false,
      env: { ...process.env, ...env },
    });
    proc.on('close', (code) => resolve(code));
  });
}

function report(code, label) {
  if (code === 0) console.log(c(GREEN, `\n  ✓ ${label} passed.`));
  else console.log(c(RED, `\n  ✗ ${label} failed (exit code ${code}).`));
}

function open_path(p) {
  const cmd = process.platform === 'win32' ? `start "" "${p}"`
            : process.platform === 'darwin' ? `open "${p}"`
            : `xdg-open "${p}"`;
  try { execSync(cmd, { stdio: 'ignore' }); }
  catch { console.log(`\n  Open this folder manually:\n  ${p}\n`); }
}

// Hit a server endpoint on localhost:SERVER_PORT and print the response.
// Requires the server to already be running (menu item 11, in another terminal).
function hit_endpoint(method, route, body = null) {
  console.log(c(DIM, `  ${method} http://localhost:${SERVER_PORT}${route}`));
  return new Promise((resolve) => {
    const headers = body
      ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      : {};
    const req = http.request(
      { host: '127.0.0.1', port: SERVER_PORT, path: route, method, headers },
      (res) => {
        let chunks = '';
        res.on('data', (d) => { chunks += d; });
        res.on('end', () => {
          console.log(c(res.statusCode < 400 ? GREEN : YELLOW, `  HTTP ${res.statusCode}`));
          if (chunks) console.log(`  ${chunks}`);
          resolve();
        });
      }
    );
    req.on('error', (e) => {
      console.log(c(YELLOW, `  Could not reach the server on port ${SERVER_PORT} — is it running? (menu item 11, in another terminal)`));
      console.log(c(DIM, `  ${e.code || e.message}`));
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

// ── Menu definition ─────────────────────────────────────────────────────────
// Test items carry `target` (path passed to `node --test`) + `test_label`.
const SECTIONS = [
  {
    label: 'TESTING — verify the code is working',
    color: CYAN,
    items: [
      { id: 1, label: 'Run ALL tests',     desc: 'Every suite under tests/ at once', action: 'run_tests', target: 'tests/',                        test_label: 'all tests',        cli: 'node --test tests/' },
      { id: 2, label: 'normalize tests',   desc: 'Field cleaning + key builders',     action: 'run_tests', target: 'tests/normalize.test.js',       test_label: 'normalize tests',  cli: 'node --test tests/normalize.test.js' },
      { id: 3, label: 'matcher tests',     desc: 'Levenshtein, similarity, rule flags', action: 'run_tests', target: 'tests/matcher.test.js',       test_label: 'matcher tests',    cli: 'node --test tests/matcher.test.js' },
      { id: 4, label: 'grouping tests',    desc: 'UnionFind + fuzzy group builder',   action: 'run_tests', target: 'tests/grouping.test.js',        test_label: 'grouping tests',   cli: 'node --test tests/grouping.test.js' },
      { id: 5, label: 'file output tests', desc: 'CSV write + archive rotation',       action: 'run_tests', target: 'tests/file_output.test.js',     test_label: 'file output tests', cli: 'node --test tests/file_output.test.js' },
      { id: 6, label: 'Syntax check',      desc: `Parse-check ${MAIN_SCRIPT} (no run)`, action: 'syntax_check',                                       cli: `node --check ${MAIN_SCRIPT}` },
    ],
  },
  {
    label: 'RUN — the real duplicate finder',
    color: YELLOW,
    items: [
      { id: 7, label: 'Find duplicates — TEST',       desc: '--test: dev sandbox, fetch capped at 5,000', action: 'run_test', cli: `node ${MAIN_SCRIPT} --test` },
      { id: 8, label: 'Find duplicates — PRODUCTION', desc: '--prod: prod login, full fetch, writes CSVs to /data', action: 'run_prod', cli: `node ${MAIN_SCRIPT} --prod` },
    ],
  },
  {
    label: 'OUTPUT',
    color: GREEN,
    items: [
      { id: 9,  label: 'Open output folder',  desc: `Most recent files (${OUTPUT_DIR_NAME})`, action: 'open_output' },
      { id: 10, label: 'Open archive folder', desc: `Previous run (${ARCHIVE_DIR_NAME})`, action: 'open_archive' },
    ],
  },
  {
    label: 'SERVER — Slack slash-command server (start, then hit from another terminal)',
    color: CYAN,
    items: [
      { id: 11, label: 'Start Slack server (port 8017)', desc: 'Endpoints: test / stats / scheduled / reporting (Ctrl-C to stop)', action: 'start_server', cli: 'node server_salesforce_duplicates_8017.js' },
      { id: 12, label: 'Hit /test',      desc: 'GET health check (server must be running)', action: 'hit_test',      cli: `curl http://localhost:${8017}/salesforce-duplicates-test` },
      { id: 13, label: 'Hit /stats',     desc: 'POST latest-run counts (mode=latest file=all)', action: 'hit_stats',     cli: `curl -X POST http://localhost:${8017}/salesforce-duplicates-stats -d "text=mode=latest file=all"` },
      { id: 14, label: 'Hit /scheduled', desc: 'GET regenerate + post (env=test to use dev sandbox)', action: 'hit_scheduled', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?env=test"` },
    ],
  },
  {
    label: 'PREFERENCES',
    color: MAGENTA,
    items: [
      { id: 15, label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item', action: 'toggle_cli' },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + RED, '\n  USAT Salesforce Duplicates'));
  console.log(c(DIM, '  ─────────────────────────────────────────────\n'));
  for (const section of SECTIONS) {
    console.log(c(section.color + BOLD, `  ${section.label}`));
    for (const item of section.items) {
      const num = String(item.id).padStart(3);
      console.log(`  ${c(BOLD, num + '.')} ${item.label.padEnd(28)} ${c(DIM, item.desc)}`);
      // Second dimmed line with the CLI equivalent — only when the toggle is on.
      // Items without a `cli` field (Open folders, the toggle itself) skip it.
      if (_show_cli && item.cli) {
        console.log(`        ${c(DIM, '$ ' + item.cli)}`);
      }
    }
    console.log('');
  }
  console.log(c(DIM, '    0. Exit\n'));
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function handle_action(item, rl) {
  console.log('');
  switch (item.action) {
    case 'run_tests': {
      const is_dir = item.target.endsWith('/');
      if (!fs.existsSync(path.join(DIR, item.target))) {
        console.log(c(YELLOW, `  ${is_dir ? 'tests/ directory' : 'Test file'} not found: ${item.target}`));
        break;
      }
      const code = await run_node(['--test', item.target], item.test_label);
      report(code, item.test_label);
      break;
    }
    case 'syntax_check': {
      const code = await run_node(['--check', MAIN_SCRIPT], 'syntax check');
      report(code, 'syntax check');
      break;
    }
    case 'run_test': {
      const label = 'duplicate finder (TEST)';
      const code = await run_node([MAIN_SCRIPT, '--test'], label);
      report(code, label);
      break;
    }
    case 'run_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION run — logs into prod Salesforce and writes files. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'duplicate finder (PRODUCTION)';
      const code = await run_node([MAIN_SCRIPT, '--prod'], label);
      report(code, label);
      break;
    }
    case 'open_output':
    case 'open_archive': {
      const name = item.action === 'open_output' ? OUTPUT_DIR_NAME : ARCHIVE_DIR_NAME;
      const os_path = await determineOSPath();
      const folder = path.join(os_path, name);
      fs.mkdirSync(folder, { recursive: true });
      console.log(c(DIM, `  Opening ${folder}`));
      open_path(folder);
      break;
    }
    case 'start_server': {
      // The server lives at the repo root and loads .env from there, so spawn
      // it with cwd = repo root (two levels up from this menu).
      const repo_root = path.resolve(DIR, '..', '..');
      console.log(c(DIM, `  Starting server from ${repo_root} (Ctrl-C to stop)...\n`));
      await new Promise((resolve) => {
        const proc = spawn(process.execPath ?? 'node', ['server_salesforce_duplicates_8017.js'], {
          stdio: 'inherit',
          cwd: repo_root,
          shell: false,
        });
        proc.on('close', resolve);
      });
      break;
    }
    case 'hit_test': {
      await hit_endpoint('GET', '/salesforce-duplicates-test');
      break;
    }
    case 'hit_stats': {
      await hit_endpoint('POST', '/salesforce-duplicates-stats', 'text=mode=latest file=all');
      break;
    }
    case 'hit_scheduled': {
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?env=test');
      break;
    }
    case 'toggle_cli': {
      _show_cli = !_show_cli;
      console.log(c(GREEN, `  ✓ CLI commands ${_show_cli ? 'shown' : 'hidden'}.`));
      break;
    }
    default:
      console.log(c(YELLOW, `  Unknown action: ${item.action}`));
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.on('SIGINT', () => { console.log(c(DIM, '\n  Bye.')); rl.close(); process.exit(0); });

  const max_id = Math.max(...ALL_ITEMS.map((i) => i.id));
  while (true) {
    print_menu();
    const raw = (await prompt(rl, c(BOLD, `  Select (0-${max_id}): `))).trim();
    if (raw === '0' || raw.toLowerCase() === 'q' || raw.toLowerCase() === 'exit') {
      console.log(c(DIM, '\n  Bye.'));
      rl.close();
      return;
    }
    const item = ALL_ITEMS.find((i) => i.id === parseInt(raw, 10));
    if (!item) { console.log(c(YELLOW, '  Invalid choice.')); }
    else { await handle_action(item, rl); }
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { SECTIONS, ALL_ITEMS, handle_action, main };
