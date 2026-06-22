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
const { OUTPUT_DIR_NAME, ARCHIVE_DIR_NAME, META_DIR_NAME, ZIP_TRIM_MAPPING_FILE, TUNING_DIR_NAME, SNAPSHOT_TABLE_NAME } = require('./config');

const DIR = __dirname;
const MAIN_SCRIPT = 'step_1_find_duplicates.js';
const SWEEP_SCRIPT = 'src/sweep_duplicates.js';
const VERIFY_SCRIPT = 'src/verify_database_snapshot.js';
const MERGE_ID_REVIEW_SCRIPT = 'src/merge_id_review.js';
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

function report(code, label, verb = 'passed') {
  if (code === 0) console.log(c(GREEN, `\n  ✓ ${label} ${verb}.`));
  else console.log(c(RED, `\n  ✗ ${label} failed (exit code ${code}).`));
}

function open_path(p) {
  const cmd = process.platform === 'win32' ? `start "" "${p}"`
            : process.platform === 'darwin' ? `open "${p}"`
            : `xdg-open "${p}"`;
  try { execSync(cmd, { stdio: 'ignore' }); }
  catch { console.log(`\n  Open this folder manually:\n  ${p}\n`); }
}

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
      console.log(c(YELLOW, `  Could not reach the server on port ${SERVER_PORT} — is it running? (start the Slack server from the SERVER menu, in another terminal)`));
      console.log(c(DIM, `  ${e.code || e.message}`));
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

// ── Menu definition ─────────────────────────────────────────────────────────
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
    label: 'RUN — the real duplicate finder (SQL backbone ON; add --in-memory to bypass)',
    color: YELLOW,
    items: [
      { id: 7, label: 'Find duplicates — TEST',       desc: '--test: dev sandbox, capped 5,000 -> streams into the snapshot table (SQL backbone)', action: 'run_test', cli: `node ${MAIN_SCRIPT} --test` },
      { id: 8, label: 'Find duplicates — TEST FULL',  desc: '--test --full: dev sandbox, ALL records (Bulk) -> snapshot table (SQL backbone)', action: 'run_test_full', cli: `node ${MAIN_SCRIPT} --test --full` },
      { id: 9, label: 'Find duplicates — PROD PARTIAL', desc: '--prod --partial: capped sample -> snapshot table (SQL backbone; try before full)', action: 'run_prod_partial', cli: `node ${MAIN_SCRIPT} --prod --partial` },
      { id: 10, label: 'Find duplicates — PRODUCTION', desc: '--prod: full fetch -> streams into snapshot table (SQL backbone), writes CSVs to /data', action: 'run_prod', cli: `node ${MAIN_SCRIPT} --prod` },
    ],
  },
  {
    label: 'MERGE ID QA — compare our duplicates to Salesforce merge IDs (read-only)',
    color: GREEN,
    items: [
      { id: 11, label: 'Review merge ID results', desc: 'Latest run: account buckets + duplicate pairs + a preview, from the DB', action: 'merge_id_review', cli: `node ${MERGE_ID_REVIEW_SCRIPT} report` },
    ],
  },
  {
    label: 'OUTPUT',
    color: GREEN,
    items: [
      { id: 12,  label: 'Open output folder',  desc: `Most recent files (${OUTPUT_DIR_NAME})`, action: 'open_output' },
      { id: 13, label: 'Open archive folder', desc: `Previous run (${ARCHIVE_DIR_NAME})`, action: 'open_archive' },
      { id: 14, label: 'Open review folder',  desc: `ZIP trim mapping + run summary (${META_DIR_NAME})`, action: 'open_meta' },
    ],
  },
  {
    label: 'DUPLICATE TUNING — compare duplicate counts across criteria (DB-backed, review-only)',
    color: YELLOW,
    items: [
      { id: 15, label: 'Sweep snapshot — TEST',       desc: 'Fetch records ONCE (dev sandbox) and STREAM them into the snapshot table', action: 'sweep_snapshot_test', cli: `node ${SWEEP_SCRIPT} snapshot --test` },
      { id: 16, label: 'Sweep snapshot — PRODUCTION', desc: 'Fetch records ONCE (production) and STREAM them into the snapshot table', action: 'sweep_snapshot_prod', cli: `node ${SWEEP_SCRIPT} snapshot --prod` },
      { id: 17, label: 'Run sweep (grid over snapshot)', desc: 'Replay config.DEFAULT_SWEEP_GRID over the DB snapshot; prints summary + table, writes sweep_summary.csv', action: 'sweep_run', cli: `node ${SWEEP_SCRIPT} run` },
      { id: 18, label: 'Sweep snapshot status (DB)', desc: 'Verify the DB snapshot: meta + live row count from the database', action: 'sweep_status', cli: `node ${SWEEP_SCRIPT} status` },
      { id: 19, label: 'Open tuning folder',  desc: `Sweep CSVs (${TUNING_DIR_NAME})`, action: 'open_tuning' },
    ],
  },
  {
    label: 'SQL BACKBONE — verify the Phase 0 loader against the local DB (step by step)',
    color: GREEN,
    items: [
      { id: 20, label: 'Loader unit tests (no DB)', desc: 'tests/database_snapshot.test.js — logic only, no MySQL', action: 'run_tests', target: 'tests/database_snapshot.test.js', test_label: 'database_snapshot tests', cli: 'node --test tests/database_snapshot.test.js' },
      { id: 21, label: 'Step 1 — Load synthetic rows', desc: `Drop+recreate ${SNAPSHOT_TABLE_NAME} in usat_sales_db and load 4 rows`, action: 'db_verify_load', cli: `node ${VERIFY_SCRIPT} load` },
      { id: 22, label: 'Step 2 — Show rows + dup groups', desc: 'SELECT the rows and run the exact-duplicate GROUP BY (SQL output)', action: 'db_verify_show', cli: `node ${VERIFY_SCRIPT} show` },
      { id: 23, label: 'Step 3 — Drop the table', desc: 'Remove the verification table (cleanup)', action: 'db_verify_drop', cli: `node ${VERIFY_SCRIPT} drop` },
    ],
  },
  {
    label: 'SERVER — Slack slash-command server (start, then hit from another terminal)',
    color: CYAN,
    items: [
      { id: 24, label: 'Start Slack server (port 8017)', desc: 'Endpoints: test / stats / scheduled / reporting (Ctrl-C to stop)', action: 'start_server', cli: 'node server_salesforce_duplicates_8017.js' },
      { id: 25, label: 'Hit /test',      desc: 'GET health check (server must be running)', action: 'hit_test',      cli: `curl http://localhost:${8017}/salesforce-duplicates-test` },
      { id: 26, label: 'Hit /stats',     desc: 'POST latest-run counts (mode=latest file=all)', action: 'hit_stats',     cli: `curl -X POST http://localhost:${8017}/salesforce-duplicates-stats -d "text=mode=latest file=all"` },
      { id: 27, label: 'Hit /scheduled — TEST',       desc: 'is_test=true: dev sandbox regenerate + Slack post', action: 'hit_scheduled_test', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=true"` },
      { id: 28, label: 'Hit /scheduled — TEST FULL',  desc: 'is_test=true&full=true: dev sandbox, ALL records + Slack post', action: 'hit_scheduled_test_full', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=true&full=true"` },
      { id: 29, label: 'Hit /scheduled — PRODUCTION', desc: 'is_test=false: production regenerate + Slack post', action: 'hit_scheduled_prod', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=false"` },
    ],
  },
  {
    label: 'DISCOVERY — confirm Salesforce field names (read-only)',
    color: MAGENTA,
    items: [
      { id: 30, label: 'Discover Salesforce fields', desc: 'Describe + Tooling SOQL for a field on an entity (prompts: entity / term / mode)', action: 'discover_fields', cli: 'node discover_account_fields.js --prod Account Merge' },
    ],
  },
  {
    label: 'PREFERENCES',
    color: MAGENTA,
    items: [
      { id: 31, label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item', action: 'toggle_cli' },
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
      const label = 'duplicate finder run (dev sandbox)';
      const code = await run_node([MAIN_SCRIPT, '--test'], label);
      report(code, label, 'completed');
      break;
    }
    case 'run_test_full': {
      const label = 'duplicate finder run (dev sandbox, FULL)';
      const code = await run_node([MAIN_SCRIPT, '--test', '--full'], label);
      report(code, label, 'completed');
      break;
    }
    case 'run_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION run — logs into prod Salesforce and writes files. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'duplicate finder run (production)';
      const code = await run_node([MAIN_SCRIPT, '--prod'], label);
      report(code, label, 'completed');
      break;
    }
    case 'run_prod_partial': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION PARTIAL — logs into prod Salesforce and pulls a small sample. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'duplicate finder run (production, PARTIAL sample)';
      const code = await run_node([MAIN_SCRIPT, '--prod', '--partial'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_snapshot_test': {
      const label = 'sweep snapshot (dev sandbox -> DB)';
      const code = await run_node([SWEEP_SCRIPT, 'snapshot', '--test'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_snapshot_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION snapshot — logs into prod Salesforce and streams records into the DB. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'sweep snapshot (production -> DB)';
      const code = await run_node([SWEEP_SCRIPT, 'snapshot', '--prod'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_run': {
      const label = 'criteria sweep (grid over DB snapshot)';
      const code = await run_node([SWEEP_SCRIPT, 'run'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_status': {
      const label = 'sweep snapshot status (DB)';
      const code = await run_node([SWEEP_SCRIPT, 'status'], label);
      report(code, label, 'completed');
      break;
    }
    case 'db_verify_load': {
      const label = 'DB verify — load synthetic rows';
      const code = await run_node([VERIFY_SCRIPT, 'load'], label);
      report(code, label, 'completed');
      break;
    }
    case 'db_verify_show': {
      const label = 'DB verify — show rows + duplicate groups';
      const code = await run_node([VERIFY_SCRIPT, 'show'], label);
      report(code, label, 'completed');
      break;
    }
    case 'db_verify_drop': {
      const label = 'DB verify — drop the table';
      const code = await run_node([VERIFY_SCRIPT, 'drop'], label);
      report(code, label, 'completed');
      break;
    }
    case 'open_output':
    case 'open_archive':
    case 'open_meta':
    case 'open_tuning': {
      const name = item.action === 'open_output' ? OUTPUT_DIR_NAME
                 : item.action === 'open_archive' ? ARCHIVE_DIR_NAME
                 : item.action === 'open_tuning' ? TUNING_DIR_NAME
                 : META_DIR_NAME;
      const os_path = await determineOSPath();
      const folder = path.join(os_path, name);
      fs.mkdirSync(folder, { recursive: true });
      if (item.action === 'open_meta') {
        console.log(c(DIM, `  Review folder — ZIP trim mapping: ${ZIP_TRIM_MAPPING_FILE}`));
      }
      console.log(c(DIM, `  Opening ${folder}`));
      open_path(folder);
      break;
    }
    case 'start_server': {
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
    case 'hit_scheduled_test': {
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=true');
      break;
    }
    case 'hit_scheduled_test_full': {
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=true&full=true');
      break;
    }
    case 'hit_scheduled_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  This triggers a PRODUCTION run + Slack post on the running server. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=false');
      break;
    }
    case 'merge_id_review': {
      const label = 'merge ID review (latest run, from DB)';
      const code = await run_node([MERGE_ID_REVIEW_SCRIPT, 'report'], label);
      report(code, label, 'completed');
      break;
    }
    case 'discover_fields': {
      const entity_raw = (await prompt(rl, c(BOLD, '  Entity API name [Account] (Contact also works): '))).trim();
      const entity = entity_raw || 'Account';
      const term_raw = (await prompt(rl, c(BOLD, '  Qualified API name contains [Merge]: '))).trim();
      const term = term_raw || 'Merge';
      const mode_raw = (await prompt(rl, c(BOLD, '  Run against (t)est sandbox or (p)roduction? [p]: '))).trim().toLowerCase();
      const mode = mode_raw === 't' || mode_raw === 'test' ? '--test' : '--prod';
      const label = `field discovery (${entity} / "${term}" / ${mode})`;
      const code = await run_node(['discover_account_fields.js', mode, entity, term], label);
      report(code, label, 'completed');
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
