#!/usr/bin/env node
/**
 * menu.js — interactive launcher for race_results_transform.
 *
 * Usage:  node menu.js
 *
 * Numbered, sectioned list of actions with a one-line description each. Toggle
 * "Show/hide CLI commands" to print the underlying `$ ...` command beneath each
 * item (choice persists in .menu_prefs.json). Built on Node's readline — no deps.
 * Matches the conventions of src/event_analysis/menu.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execSync } = require('child_process');
const data_dir = require('./data_dir');

const DIR = __dirname;
const SERVER = path.join(DIR, '..', '..', 'server_race_results_transform_8018.js');
const PREFS_FILE = path.join(DIR, '.menu_prefs.json');

// ── colors ──
const R = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BLUE = '\x1b[34m', MAGENTA = '\x1b[35m', GRAY = '\x1b[90m';
function c(col, s) { return col + s + R; }

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) {} }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) {} }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(function (res) { rl.question(q, res); }); }
function clean(p) { return p.trim().replace(/^["']|["']$/g, ''); }

function run(cmd, args) {
  return new Promise(function (resolve) {
    // Release stdin so the child can read interactive prompts (e.g. cli confirms).
    // The menu's persistent readline would otherwise swallow the keystrokes.
    rl.pause();
    // `node` is directly executable on Windows, so DON'T wrap it in a shell: a cmd.exe
    // wrapper intercepts Ctrl-C and the child (e.g. the server) never receives SIGINT,
    // so it can't shut down cleanly. Only npm/open and similar need a shell on Windows.
    const need_shell = process.platform === 'win32' && cmd !== 'node';
    // While the child owns the terminal let IT handle Ctrl-C (the server's own SIGINT
    // cleanup exits it); the menu ignores SIGINT meanwhile and just returns when the
    // child closes -- so Ctrl-C stops the server and drops you back to the menu.
    const ignore = function () {};
    process.on('SIGINT', ignore);
    const p = spawn(cmd, args, { cwd: DIR, stdio: 'inherit', shell: need_shell });
    p.on('close', function (code) { process.removeListener('SIGINT', ignore); rl.resume(); resolve(code); });
  });
}
async function run_test(file, label) {
  console.log(c(DIM, '\n  running ' + label + '…\n'));
  const code = await run('node', ['--test', file]);
  console.log(code === 0 ? c(GREEN, '\n  ✓ ' + label + ' passed') : c(YELLOW, '\n  ✗ ' + label + ' had failures'));
}

// ── menu definition ──
const SECTIONS = [
  { label: 'Convert', color: CYAN, items: [
    { id: 1, label: 'Convert a file', desc: 'Reformat one .xlsx or .csv to the USAT template; prints a scorecard.', cli: 'node src/cli.js convert <file> [-o out.xlsx]', action: 'convert' },
    { id: 2, label: 'Batch-convert a folder', desc: 'Reformat every .xlsx/.csv in a folder.', cli: 'node src/cli.js batch <folder> [-o outdir]', action: 'batch' },
    { id: 3, label: 'Convert everything in data/inputs', desc: 'Reformat every file in your (gitignored) data/inputs folder into data/outputs.', cli: 'node src/cli.js batch data/inputs -o data/outputs', action: 'examples' }
  ] },
  { label: 'Inspect', color: BLUE, items: [
    { id: 4, label: 'Inspect headers + auto-mapping', desc: 'Show detected headers and how each maps to the template; no file written.', cli: 'node src/cli.js inspect <file>', action: 'inspect' }
  ] },
  { label: 'Tests — engine & UI (node, no browser)', color: MAGENTA, items: [
    { id: 5, label: 'Run ALL engine/UI tests', desc: 'Runs every node --test suite (dependency-free, no browser). Browser tests are in the next section.', cli: 'node --test tests/*.test.js', action: 'test_all' },
    { id: 6, label: 'Smoke — modules load', desc: 'Each engine module parses + exports; schema has all 12 columns in order.', cli: 'node --test tests/smoke.test.js', action: 'test_smoke' },
    { id: 7, label: 'Value normalization', desc: 'Gender→M/F/NB · DOB→mm/dd/yyyy · times incl. DNS/DNF · state abbrev · member→1-day · category buckets.', cli: 'node --test tests/normalize.test.js', action: 'test_normalize' },
    { id: 8, label: 'Column matching', desc: 'Finish time beats splits · "Age Group" beats "Race / Division" · name-order independence.', cli: 'node --test tests/match.test.js', action: 'test_match' },
    { id: 9, label: 'Table display format', desc: 'Excel times render as times (not dates) · DOB as mm/dd/yyyy · long member #s intact — on real files.', cli: 'node --test tests/display.test.js', action: 'test_display' },
    { id: 10, label: 'Excel / CSV I/O round-trip', desc: 'Write an .xlsx and read it back; member numbers stay text (no scientific notation).', cli: 'node --test tests/io.test.js', action: 'test_io' },
    { id: 11, label: 'Integrity & reconciliation', desc: 'Row counts tie out · dividers skipped · column ledger · Name/Email/Zip preserved · always 12-col output.', cli: 'node --test tests/reconcile.test.js', action: 'test_reconcile' },
    { id: 12, label: 'Golden fixtures (real files)', desc: 'Convert the 2 xlsx + 2 csv examples and compare to the checked-in expected snapshots.', cli: 'node --test tests/fixtures.test.js', action: 'test_fixtures' },
    { id: 13, label: 'Lint — snake_case', desc: 'Fail if any of our identifiers are camelCase (DOM/library names + UPPER_SNAKE constants + element ids are allowed).', cli: 'node --test tests/lint_snake_case.test.js', action: 'test_lint' },
    { id: 14, label: 'Config wiring (package + tasks)', desc: 'repo-root package.json scripts + .vscode/tasks.json register this tool (step 16/16) like the other servers.', cli: 'node --test tests/config_wiring.test.js', action: 'test_config' }
  ] },
  { label: 'Tests — browser (Playwright)', color: MAGENTA, items: [
    { id: 15, label: 'Install browser E2E (one-time)', desc: 'Dev: npm run e2e:install (axe-core + chromium/firefox/webkit). Linux server: npm run e2e:install:server (adds --with-deps; root).', cli: 'npm run e2e:install', action: 'e2e_install' },
    { id: 16, label: 'Run ALL browser tests', desc: 'Real-browser convert/download/split/combine + UI/a11y/visual/mobile across chromium/firefox/webkit. Run Install (15) once first.', cli: 'npm run e2e', action: 'e2e_run' },
    { id: 17, label: 'Browser E2E — chromium only (fast)', desc: 'Runs the suite on just chromium, skipping firefox/webkit/mobile projects.', cli: 'npm run e2e:chromium', action: 'e2e_chromium' },
    { id: 18, label: 'Browser E2E — analytics DB round-trip (chromium)', desc: 'Drives the app, then checks MySQL received the events and the table schema exists. Skips if no DB.', cli: 'npm run e2e:db', action: 'e2e_db' },
    { id: 19, label: 'Browser E2E — watch in Chrome (headed)', desc: 'Same tests in a visible, slowed Chrome window so you can watch. Desktop only (not the headless server).', cli: 'npm run e2e:headed', action: 'e2e_headed' },
    { id: 20, label: 'Browser E2E — step through (pause each step)', desc: 'Headed Chrome that PAUSES on every step via the Playwright Inspector; click Resume to advance one step at a time. Desktop only.', cli: 'npm run e2e:step', action: 'e2e_step' },
    { id: 21, label: 'Refresh visual snapshot baselines', desc: 'Regenerate the committed screenshot baselines (e2e/visual.spec.js-snapshots). Run after intended UI changes.', cli: 'npm run e2e:snap', action: 'e2e_snap' }
  ] },
  { label: 'Server & app', color: GREEN, items: [
    { id: 22, label: 'Start the web app server (port 8018)', desc: 'Serve public/ at http://localhost:8018; also opens a public ngrok URL if NGROK_AUTHTOKEN is set (otherwise it just notes that and keeps running). Ctrl-C to stop.', cli: 'node ../../server_race_results_transform_8018.js', action: 'server' },
    { id: 23, label: 'Open the web app in a browser', desc: 'Open http://localhost:8018 (start the server first).', cli: 'open http://localhost:8018', action: 'open' }
  ] },
  { label: 'Usage analytics', color: CYAN, items: [
    { id: 24, label: 'Usage stats (last 7 days)', desc: 'Print the usage summary (same as the Slack digest): visits, new/repeat, uploads, conversions, downloads by mode, completion, auto-map accuracy, top files.', cli: 'node src/cli.js stats', action: 'metrics_stats' },
    { id: 25, label: 'Usage data — size', desc: 'Events table size (MB), row count, date range, and rows per year.', cli: 'node src/cli.js metrics:size', action: 'metrics_size' },
    { id: 26, label: 'Usage data — cleanup (purge old years)', desc: 'Keep current + prior calendar year; preview, confirm, then purge older rows.', cli: 'node src/cli.js metrics:cleanup', action: 'metrics_cleanup' },
    { id: 27, label: 'Usage data — PURGE ALL (danger)', desc: 'Delete every analytics row regardless of date (asks to confirm). For clearing test data.', cli: 'node src/cli.js metrics:purge-all', action: 'metrics_purge_all' }
  ] },
  { label: 'Settings', color: GRAY, items: [
    { id: 28, label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item. Persists in .menu_prefs.json.', action: 'toggle' },
    { id: 29, label: 'Quit', desc: 'Exit the menu.', action: 'quit' }
  ] }
];
const ALL = SECTIONS.flatMap(function (s) { return s.items; });

function banner() {
  console.log('');
  console.log(c(BOLD + CYAN, 'race_results_transform') + c(GRAY, '  ·  race results → USAT template'));
  console.log(c(GRAY, '─'.repeat(62)));
  SECTIONS.forEach(function (sec) {
    console.log('');
    console.log(c(sec.color + BOLD, '  ' + sec.label));
    sec.items.forEach(function (it) {
      console.log('  ' + c(BOLD, String(it.id).padStart(2)) + '. ' + it.label + c(GRAY, '  — ' + it.desc));
      if (_show_cli && it.cli) console.log('      ' + c(DIM, '$ ' + it.cli));
    });
  });
  console.log('');
}

async function handle(item) {
  switch (item.action) {
    case 'convert': {
      const f = clean(await ask('Path to .xlsx/.csv: ')); if (!f) return;
      const o = clean(await ask('Output path (blank = auto): '));
      const args = ['src/cli.js', 'convert', f]; if (o) args.push('-o', o);
      await run('node', args); break;
    }
    case 'batch': { const d = clean(await ask('Folder: ')); if (d) await run('node', ['src/cli.js', 'batch', d]); break; }
    case 'inspect': { const f = clean(await ask('Path to .xlsx/.csv: ')); if (f) await run('node', ['src/cli.js', 'inspect', f]); break; }
    case 'examples': await run('node', ['src/cli.js', 'batch', await data_dir.inputs(), '-o', await data_dir.outputs()]); break;
    case 'test_all': {
      const tdir = path.join(DIR, 'tests');
      const files = fs.readdirSync(tdir).filter(function (f) { return /\.test\.js$/.test(f); }).sort()
        .map(function (f) { return path.join('tests', f); });
      console.log(c(DIM, '\n  Running all ' + files.length + ' test files: node --test tests/\n'));
      const code = await run('node', ['--test'].concat(files));
      console.log(code === 0 ? c(GREEN, '\n  \u2713 all node tests passed') : c(YELLOW, '\n  \u2717 some node tests failed'));
      break;
    }
    case 'test_smoke': await run_test('tests/smoke.test.js', 'smoke tests'); break;
    case 'test_normalize': await run_test('tests/normalize.test.js', 'value-normalization tests'); break;
    case 'test_match': await run_test('tests/match.test.js', 'column-matching tests'); break;
    case 'test_display': await run_test('tests/display.test.js', 'display-format tests'); break;
    case 'test_io': await run_test('tests/io.test.js', 'I/O round-trip tests'); break;
    case 'test_reconcile': await run_test('tests/reconcile.test.js', 'integrity tests'); break;
    case 'test_fixtures': await run_test('tests/fixtures.test.js', 'golden-fixture tests'); break;
    case 'test_lint': await run_test('tests/lint_snake_case.test.js', 'snake_case lint'); break;
    case 'test_config': await run_test('tests/config_wiring.test.js', 'config-wiring checks'); break;
    case 'e2e_run': console.log(c(DIM, '\n  running Playwright browser tests, headless (run "Install browser E2E" first if this fails)…\n')); await run('npm', ['run', 'e2e']); break;
    case 'e2e_headed': console.log(c(DIM, '\n  opening Chrome (headed, slowed)…\n')); await run('npm', ['run', 'e2e:headed']); break;
    case 'e2e_step': console.log(c(DIM, '\n  opening Chrome with the Inspector — click Resume to advance each step…\n')); await run('npm', ['run', 'e2e:step']); break;
    case 'e2e_install': console.log(c(DIM, '\n  installing Playwright + Chromium (one-time)…\n')); await run('npm', ['run', 'e2e:install']); break;
    case 'e2e_chromium': console.log(c(DIM, '\n  running browser tests on chromium only…\n')); await run('npm', ['run', 'e2e:chromium']); break;
    case 'e2e_snap': console.log(c(DIM, '\n  refreshing visual snapshot baselines…\n')); await run('npm', ['run', 'e2e:snap']); break;
    case 'e2e_db': console.log(c(DIM, '\n  browser→MySQL round-trip (needs local DB)…\n')); await run('npm', ['run', 'e2e:db']); break;
    case 'metrics_stats': await run('node', ['src/cli.js', 'stats']); break;
    case 'metrics_size': await run('node', ['src/cli.js', 'metrics:size']); break;
    case 'metrics_cleanup': await run('node', ['src/cli.js', 'metrics:cleanup']); break;
    case 'metrics_purge_all': await run('node', ['src/cli.js', 'metrics:purge-all']); break;
    case 'server': console.log(c(DIM, 'Starting server… Ctrl-C to stop.')); await run('node', [SERVER]); break;
    case 'open': {
      const url = 'http://localhost:8018';
      const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
      try { execSync(cmd, { stdio: 'ignore' }); console.log(c(GREEN, '  ✓ Opened ' + url)); } catch (e) { console.log(c(YELLOW, '  Could not open a browser — go to ' + url)); }
      break;
    }
    case 'toggle': _show_cli = !_show_cli; save_prefs(); console.log(c(GREEN, '  CLI commands ' + (_show_cli ? 'shown' : 'hidden'))); break;
    case 'quit': return 'quit';
  }
}

async function main() {
  load_prefs();
  for (;;) {
    banner();
    if (_show_cli) console.log(c(DIM, '  (CLI commands shown — toggle with 15)\n'));
    const choice = clean(await ask('Choose a number: ')).toLowerCase();
    if (choice === 'q' || choice === 'quit' || choice === 'exit') break;
    const item = ALL.find(function (i) { return String(i.id) === choice; });
    if (!item) { console.log(c(YELLOW, '  Invalid choice.')); continue; }
    try {
      if ((await handle(item)) === 'quit') break;
    } catch (e) { console.error(c(YELLOW, '  Action failed: ' + e.message)); }
    // Pause so command output stays on screen until the user is ready (like event_analysis).
    if (item.action !== 'quit' && item.action !== 'toggle') {
      await ask(c(DIM, '\n  Press Enter to return to the menu… '));
    }
  }
  rl.close();
}
if (require.main === module) main();
