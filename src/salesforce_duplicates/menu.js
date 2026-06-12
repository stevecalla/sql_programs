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
const { OUTPUT_DIR_NAME, ARCHIVE_DIR_NAME, META_DIR_NAME, ZIP_TRIM_MAPPING_FILE, TUNING_DIR_NAME, SWEEP_SUMMARY_FILE } = require('./config');

const DIR = __dirname;
const MAIN_SCRIPT = 'step_1_find_duplicates.js';
const SWEEP_SCRIPT = 'sweep_duplicates.js';
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

// Resolve the tuning folder the same way sweep_duplicates.js does: honor the
// SWEEP_TUNING_DIR override if set, else the cross-platform /data path.
async function resolve_tuning_dir() {
  if (process.env.SWEEP_TUNING_DIR) return process.env.SWEEP_TUNING_DIR;
  return path.join(await determineOSPath(), TUNING_DIR_NAME);
}

// Parse one CSV line, honoring quoted cells (the sweep quotes any cell that
// contains a comma / quote / newline).
function parse_csv_line(line) {
  const out = [];
  let cur = '';
  let in_quotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (in_quotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else in_quotes = false; }
      else cur += ch;
    } else if (ch === '"') { in_quotes = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Read the profiles from the latest sweep_summary.csv as objects keyed by the
// CSV header (label, fuzzy_threshold, exact_groups, consolidated_clusters, …).
// Returns [] if the sweep hasn't been run yet (file missing / unreadable).
async function read_sweep_profiles() {
  try {
    const csv_path = path.join(await resolve_tuning_dir(), SWEEP_SUMMARY_FILE);
    if (!fs.existsSync(csv_path)) return [];
    const lines = fs.readFileSync(csv_path, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];
    const header = parse_csv_line(lines[0]);
    return lines.slice(1).map((line) => {
      const cells = parse_csv_line(line);
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    }).filter((r) => r.label);
  } catch (_) {
    return [];
  }
}

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : (v ?? ''); };

// Abbreviate a rule_fields string ("gender+birthdate+zip") to its initials ("gbz").
function abbrev_fields(s) {
  return String(s || '').split('+').map((f) => f.trim()[0] || '').join('');
}

// Build the one-line summary shown next to a profile in the picker, mirroring the
// sweep comparison table: threshold / nickname / fields, then the counts and the
// delta-vs-baseline (added/removed matched pairs).
function profile_summary(row) {
  const thr = `t${row.fuzzy_threshold}`;
  const nick = String(row.nickname_enabled) === 'true' ? 'nickON' : 'nickOFF';
  const fields = abbrev_fields(row.rule_fields);
  const counts = `exact:${_num(row.exact_groups)} fuzzy:${_num(row.fuzzy_pairs)} nick:${_num(row.nickname_pairs)} consol:${_num(row.consolidated_clusters)}`;
  const is_base = String(row.is_baseline) === '1' || row.label === 'baseline';
  const delta = is_base ? 'baseline' : `Δ +${_num(row.added_vs_baseline)}/-${_num(row.removed_vs_baseline)}`;
  return `${thr} ${nick} ${fields}  ${counts}  ${delta}`;
}

// Print the legend that decodes the profile labels and the inline summary.
// Keeps the numbered list readable without having to remember the naming scheme.
function print_profile_key() {
  console.log(c(CYAN, '  KEY — how to read each profile'));
  console.log(c(DIM, "    label  =  t<thr>_nick<ON|OFF>_z<zipTrim>_<fields>   e.g. t88_nickON_z5_gbz"));
  console.log(c(DIM, '    thr      fuzzy name-score threshold a pair must reach (higher = stricter)'));
  console.log(c(DIM, '    nick     nickname matching ON/OFF (Bill↔William, etc.)'));
  console.log(c(DIM, '    z<n>     ZIP trimmed to first n digits (z5 = production)'));
  console.log(c(DIM, '    fields   required matching fields — g=gender  b=birthdate  z=zip  (gbz = all three)'));
  console.log(c(DIM, '    counts   exact=exact-dup groups · fuzzy=fuzzy pairs · nick=nickname pairs · consol=consolidated clusters'));
  console.log(c(DIM, '    Δ        matched pairs vs baseline:  +gained / -lost'));
}

// Prompt the user to choose a profile. If a sweep_summary.csv exists, show the
// profiles as a numbered list WITH their key counts (so they're easy to tell
// apart) and accept either the number or a typed label; otherwise fall back to
// free-text entry. `show_key` prints the decoding legend first (suppress it on a
// second consecutive prompt, e.g. the B side of a diff). Returns the chosen
// label, or null if cancelled (blank).
async function pick_label(rl, question, show_key = true) {
  const profiles = await read_sweep_profiles();
  if (profiles.length === 0) {
    console.log(c(YELLOW, '  No sweep_summary.csv found yet — run the sweep first (menu item 16) to generate profile labels.'));
    const typed = (await prompt(rl, c(BOLD, `  ${question} (type a label, or blank to cancel): `))).trim();
    return typed || null;
  }
  const labels = profiles.map((p) => p.label);
  const w = Math.max(...labels.map((l) => l.length));
  if (show_key) print_profile_key();
  console.log(c(DIM, '  Available profiles  (label — threshold/nickname/fields · counts · Δ vs baseline):'));
  profiles.forEach((p, i) => {
    console.log(`    ${c(BOLD, String(i + 1).padStart(2))}. ${p.label.padEnd(w)}  ${c(DIM, profile_summary(p))}`);
  });
  const raw = (await prompt(rl, c(BOLD, `  ${question} (number or label, blank to cancel): `))).trim();
  if (!raw) return null;
  const asNum = parseInt(raw, 10);
  if (String(asNum) === raw && asNum >= 1 && asNum <= labels.length) return labels[asNum - 1];
  if (labels.includes(raw)) return raw;
  console.log(c(YELLOW, `  "${raw}" is not a listed profile — passing it through anyway (the sweep will validate it).`));
  return raw;
}

// Hit a server endpoint on localhost:SERVER_PORT and print the response.
// Requires the server to already be running (start it from the SERVER menu, in another terminal).
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
      { id: 8, label: 'Find duplicates — TEST FULL',  desc: '--test --full: dev sandbox, ALL records (Bulk API)', action: 'run_test_full', cli: `node ${MAIN_SCRIPT} --test --full` },
      { id: 9, label: 'Find duplicates — PROD PARTIAL', desc: '--prod --partial: prod login, capped sample (try before the full run)', action: 'run_prod_partial', cli: `node ${MAIN_SCRIPT} --prod --partial` },
      { id: 10, label: 'Find duplicates — PRODUCTION', desc: '--prod: prod login, full fetch, writes CSVs to /data', action: 'run_prod', cli: `node ${MAIN_SCRIPT} --prod` },
    ],
  },
  {
    label: 'OUTPUT',
    color: GREEN,
    items: [
      { id: 11,  label: 'Open output folder',  desc: `Most recent files (${OUTPUT_DIR_NAME})`, action: 'open_output' },
      { id: 12, label: 'Open archive folder', desc: `Previous run (${ARCHIVE_DIR_NAME})`, action: 'open_archive' },
      { id: 13, label: 'Open review folder',  desc: `ZIP trim mapping + run summary (${META_DIR_NAME})`, action: 'open_meta' },
    ],
  },
  {
    label: 'DUPLICATE TUNING — compare duplicate counts across criteria (review-only)',
    color: YELLOW,
    items: [
      { id: 14, label: 'Sweep snapshot — TEST',       desc: 'Fetch records ONCE (dev sandbox) and cache them for the sweep', action: 'sweep_snapshot_test', cli: `node ${SWEEP_SCRIPT} snapshot --test` },
      { id: 15, label: 'Sweep snapshot — PRODUCTION', desc: 'Fetch records ONCE (production) and cache them for the sweep', action: 'sweep_snapshot_prod', cli: `node ${SWEEP_SCRIPT} snapshot --prod` },
      { id: 16, label: 'Run sweep (grid over snapshot)', desc: 'Replay the grid in sweep_grid.json; prints summary + table, writes sweep_summary.csv', action: 'sweep_run', cli: `node ${SWEEP_SCRIPT} run` },
      { id: 17, label: 'Sweep detail (one profile)', desc: 'Matched pairs for one profile -> CSV (prompts: picks a profile from the last sweep)', action: 'sweep_detail', cli: `node ${SWEEP_SCRIPT} detail "<profile-label>"` },
      { id: 18, label: 'Sweep diff (two profiles)', desc: 'Pair-level diff between two profiles -> CSV (prompts: picks profile A + B)', action: 'sweep_diff', cli: `node ${SWEEP_SCRIPT} diff "<labelA>" "<labelB>"` },
      { id: 19, label: 'Open tuning folder',  desc: `Snapshot + sweep CSVs (${TUNING_DIR_NAME})`, action: 'open_tuning' },
    ],
  },
  {
    label: 'SERVER — Slack slash-command server (start, then hit from another terminal)',
    color: CYAN,
    items: [
      { id: 20, label: 'Start Slack server (port 8017)', desc: 'Endpoints: test / stats / scheduled / reporting (Ctrl-C to stop)', action: 'start_server', cli: 'node server_salesforce_duplicates_8017.js' },
      { id: 21, label: 'Hit /test',      desc: 'GET health check (server must be running)', action: 'hit_test',      cli: `curl http://localhost:${8017}/salesforce-duplicates-test` },
      { id: 22, label: 'Hit /stats',     desc: 'POST latest-run counts (mode=latest file=all)', action: 'hit_stats',     cli: `curl -X POST http://localhost:${8017}/salesforce-duplicates-stats -d "text=mode=latest file=all"` },
      { id: 23, label: 'Hit /scheduled — TEST',       desc: 'is_test=true: dev sandbox regenerate + Slack post', action: 'hit_scheduled_test', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=true"` },
      { id: 24, label: 'Hit /scheduled — TEST FULL',  desc: 'is_test=true&full=true: dev sandbox, ALL records + Slack post', action: 'hit_scheduled_test_full', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=true&full=true"` },
      { id: 25, label: 'Hit /scheduled — PRODUCTION', desc: 'is_test=false: production regenerate + Slack post', action: 'hit_scheduled_prod', cli: `curl "http://localhost:${8017}/scheduled-salesforce-duplicates?is_test=false"` },
    ],
  },
  {
    label: 'DISCOVERY — confirm Salesforce field names (read-only)',
    color: MAGENTA,
    items: [
      { id: 26, label: 'Discover Salesforce fields', desc: 'Describe + Tooling SOQL for a field on an entity (prompts: entity / term / mode)', action: 'discover_fields', cli: 'node discover_account_fields.js --prod Account Merge' },
    ],
  },
  {
    label: 'PREFERENCES',
    color: MAGENTA,
    items: [
      { id: 27, label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item', action: 'toggle_cli' },
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
      const label = 'sweep snapshot (dev sandbox)';
      const code = await run_node([SWEEP_SCRIPT, 'snapshot', '--test'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_snapshot_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  PRODUCTION snapshot — logs into prod Salesforce to cache records for tuning. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      const label = 'sweep snapshot (production)';
      const code = await run_node([SWEEP_SCRIPT, 'snapshot', '--prod'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_run': {
      const label = 'criteria sweep (grid over snapshot)';
      const code = await run_node([SWEEP_SCRIPT, 'run'], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_detail': {
      const profile = await pick_label(rl, 'Profile to drill into');
      if (!profile) { console.log(c(DIM, '  Cancelled.')); break; }
      const label = `sweep detail (${profile})`;
      const code = await run_node([SWEEP_SCRIPT, 'detail', profile], label);
      report(code, label, 'completed');
      break;
    }
    case 'sweep_diff': {
      const a = await pick_label(rl, 'First profile (A)');
      if (!a) { console.log(c(DIM, '  Cancelled.')); break; }
      const b = await pick_label(rl, 'Second profile (B)', false);
      if (!b) { console.log(c(DIM, '  Cancelled.')); break; }
      if (a === b) { console.log(c(YELLOW, '  Both choices are the same profile — a diff would be empty. Cancelled.')); break; }
      const label = `sweep diff (${a} vs ${b})`;
      const code = await run_node([SWEEP_SCRIPT, 'diff', a, b], label);
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
    case 'hit_scheduled_test': {
      // Dev sandbox — safe to fire without confirmation.
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=true');
      break;
    }
    case 'hit_scheduled_test_full': {
      // Dev sandbox, FULL fetch (all records) — safe to fire without confirmation.
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=true&full=true');
      break;
    }
    case 'hit_scheduled_prod': {
      const answer = (await prompt(rl, c(YELLOW, '  This triggers a PRODUCTION run + Slack post on the running server. Continue? (y/N): '))).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log(c(DIM, '  Cancelled.')); break; }
      await hit_endpoint('GET', '/scheduled-salesforce-duplicates?is_test=false');
      break;
    }
    case 'discover_fields': {
      // Read-only field discovery. Prompts with defaults applied on blank Enter.
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
