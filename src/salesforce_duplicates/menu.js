#!/usr/bin/env node
/**
 * menu.js — Interactive launcher for the Salesforce duplicates tool.
 *
 * Usage:
 *   node menu.js
 *
 * Shows a numbered list. Type the number and press Enter. Uses only the
 * Node.js built-in readline — no extra packages. Mirrors the style of
 * src/event_analysis/menu.js.
 */

'use strict';
const dotenv = require('dotenv');
dotenv.config({ path: '../../.env' });

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const { determineOSPath } = require('../../utilities/determineOSPath');
const { OUTPUT_DIR_NAME, ARCHIVE_DIR_NAME } = require('./sf_duplicates_060326.js');

const DIR = __dirname;
const MAIN_SCRIPT = 'sf_duplicates_060326.js';

// ── Colors ────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const c = (color, text) => `${color}${text}${RESET}`;

// ── Helpers ───────────────────────────────────────────────────────────────
function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// Spawn `node <args>` from this directory, streaming output to the console,
// and resolve with the exit code. Used for both the real script and tests
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

// ── Menu definition ─────────────────────────────────────────────────────────
const SECTIONS = [
  {
    label: 'TESTING — verify the code is working',
    color: CYAN,
    items: [
      { id: 1, label: 'Run ALL tests',         desc: 'Every *.test.js under tests/ via node --test', action: 'run_tests_all',  cli: 'node --test tests/' },
      { id: 2, label: 'Run file output tests',  desc: 'tests/file_output.test.js — CSV write + archive rotation', action: 'run_tests_file', cli: 'node --test tests/file_output.test.js' },
      { id: 3, label: 'Syntax check',           desc: `Parse-check ${MAIN_SCRIPT} (no run)`, action: 'syntax_check', cli: `node --check ${MAIN_SCRIPT}` },
    ],
  },
  {
    label: 'RUN — the real duplicate finder',
    color: YELLOW,
    items: [
      { id: 4, label: 'Find duplicates — TEST',       desc: 'IS_TEST=true: dev sandbox, fetch capped at 5,000', action: 'run_test', cli: `SF_DUP_IS_TEST=true node ${MAIN_SCRIPT}` },
      { id: 5, label: 'Find duplicates — PRODUCTION', desc: 'IS_TEST=false: prod login, full fetch, writes CSVs to /data', action: 'run_prod', cli: `SF_DUP_IS_TEST=false node ${MAIN_SCRIPT}` },
    ],
  },
  {
    label: 'OUTPUT',
    color: GREEN,
    items: [
      { id: 6, label: 'Open output folder',  desc: `Most recent files (${OUTPUT_DIR_NAME})`, action: 'open_output' },
      { id: 7, label: 'Open archive folder', desc: `Previous run (${ARCHIVE_DIR_NAME})`, action: 'open_archive' },
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
    }
    console.log('');
  }
  console.log(c(DIM, '    0. Exit\n'));
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function handle_action(action, rl) {
  console.log('');
  switch (action) {
    case 'run_tests_all': {
      const code = await run_node(['--test', 'tests/'], 'all tests');
      report(code, 'all tests');
      break;
    }
    case 'run_tests_file': {
      const target = path.join('tests', 'file_output.test.js');
      if (!fs.existsSync(path.join(DIR, target))) {
        console.log(c(YELLOW, `  Test file not found: ${target}`));
        break;
      }
      const code = await run_node(['--test', target], 'file output tests');
      report(code, 'file output tests');
      break;
    }
    case 'syntax_check': {
      const code = await run_node(['--check', MAIN_SCRIPT], 'syntax check');
      report(code, 'syntax check');
      break;
    }
    case 'run_test': {
      const label = 'duplicate finder (TEST)';
      const code = await run_node([MAIN_SCRIPT], label, { SF_DUP_IS_TEST: 'true' });
      report(code, label);
      break;
    }
    case 'run_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION run — logs into prod Salesforce and writes files. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'duplicate finder (PRODUCTION)';
      const code = await run_node([MAIN_SCRIPT], label, { SF_DUP_IS_TEST: 'false' });
      report(code, label);
      break;
    }
    case 'open_output':
    case 'open_archive': {
      const name = action === 'open_output' ? OUTPUT_DIR_NAME : ARCHIVE_DIR_NAME;
      const os_path = await determineOSPath();
      const folder = path.join(os_path, name);
      fs.mkdirSync(folder, { recursive: true });
      console.log(c(DIM, `  Opening ${folder}`));
      open_path(folder);
      break;
    }
    default:
      console.log(c(YELLOW, `  Unknown action: ${action}`));
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
    else { await handle_action(item.action, rl); }
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { SECTIONS, ALL_ITEMS, handle_action, main };
