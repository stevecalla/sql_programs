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
const data_dir = require('./src/data_dir');

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
// Capture the bot's channels as JSON (via the CLI, which loads .env) for a numbered pick-list.
function slack_channels_json() {
  try {
    const out = execSync('node src/cli.js slack:channels --json', { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.trim());
  } catch (e) { return null; }
}
// Show a numbered list of the bot's channels and return the chosen id (blank = SLACK_CHANNEL_ID default).
async function slack_pick_channel() {
  const chans = slack_channels_json();
  if (!chans) { console.log(c(YELLOW, '  Could not load channels (is SLACK_BOT_TOKEN set in .env?).')); return clean(await ask('  Channel (id or name, blank = default): ')); }
  if (!chans.length) { console.log(c(YELLOW, '  The bot is in no channels yet — /invite it in Slack first.')); return ''; }
  console.log(c(DIM, '\n  Channels the bot is in:'));
  chans.forEach(function (ch, i) { console.log('    ' + c(BOLD, '[' + (i + 1) + ']') + ' ' + (ch.is_private ? '🔒 ' : '#  ') + ch.name + c(GRAY, '  ' + ch.id)); });
  const pick = clean(await ask('  Pick a number (or type an id/name; blank = SLACK_CHANNEL_ID default): '));
  if (!pick) return '';
  const idx = Number(pick);
  if (idx >= 1 && idx <= chans.length) return chans[idx - 1].id;
  return pick;   // user typed an id/name directly
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
    { id: 6, label: 'Config wiring (package + tasks)', desc: 'repo-root package.json scripts + .vscode/tasks.json register this tool (step 16/16) like the other servers.', cli: 'node --test tests/config_wiring.test.js', action: 'test_config' },
    { id: 7, label: 'Table display format', desc: 'Excel times render as times (not dates) · DOB as mm/dd/yyyy · long member #s intact — on real files.', cli: 'node --test tests/display.test.js', action: 'test_display' },
    { id: 8, label: 'Golden fixtures (real files)', desc: 'Convert the 2 xlsx + 2 csv examples and compare to the checked-in expected snapshots.', cli: 'node --test tests/fixtures.test.js', action: 'test_fixtures' },
    { id: 9, label: 'Excel / CSV I/O round-trip', desc: 'Write an .xlsx and read it back; member numbers stay text (no scientific notation).', cli: 'node --test tests/io.test.js', action: 'test_io' },
    { id: 10, label: 'Lint — snake_case', desc: 'Fail if any of our identifiers are camelCase (DOM/library names + UPPER_SNAKE constants + element ids are allowed).', cli: 'node --test tests/lint_snake_case.test.js', action: 'test_lint' },
    { id: 11, label: 'Column matching', desc: 'Finish time beats splits · "Age Group" beats "Race / Division" · name-order independence.', cli: 'node --test tests/match.test.js', action: 'test_match' },
    { id: 12, label: 'Value normalization', desc: 'Gender→M/F/NB · DOB→mm/dd/yyyy · times incl. DNS/DNF · state abbrev · member→1-day · category buckets.', cli: 'node --test tests/normalize.test.js', action: 'test_normalize' },
    { id: 13, label: 'Integrity & reconciliation', desc: 'Row counts tie out · dividers skipped · column ledger · Name/Email/Zip preserved · always 12-col output.', cli: 'node --test tests/reconcile.test.js', action: 'test_reconcile' },
    { id: 14, label: 'Smoke — modules load', desc: 'Each engine module parses + exports; schema has all 12 columns in order.', cli: 'node --test tests/smoke.test.js', action: 'test_smoke' }
  ] },
  { label: 'Tests — browser (Playwright)', color: MAGENTA, items: [
    { id: 15, label: 'Install browser E2E (one-time)', desc: 'Dev: npm run e2e:install (axe-core + chromium/firefox/webkit). Linux server: npm run e2e:install:server (adds --with-deps; root).', cli: 'npm run e2e:install', action: 'e2e_install' },
    { id: 16, label: 'Run ALL browser tests', desc: 'Real-browser convert/download/split/combine + UI/a11y/visual/mobile across chromium/firefox/webkit. Run the Install item once first.', cli: 'npm run e2e', action: 'e2e_run' },
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
    { id: 27, label: 'Usage data — purge TEST rows only (is_test=1)', desc: 'Delete only deliberate test-run rows (browser opened with ?metrics_test=1). Real + demo data is untouched.', cli: 'node src/cli.js metrics:purge-test', action: 'metrics_purge_test' },
    { id: 28, label: 'Usage data — PURGE ALL (danger)', desc: 'Delete every analytics row regardless of date (asks to confirm). For clearing test data.', cli: 'node src/cli.js metrics:purge-all', action: 'metrics_purge_all' }
  ] },
  { label: 'AI \u2014 ask your data', color: CYAN, items: [
    { id: 29, label: 'AI ask \u2014 ask a question (read-only)', desc: 'Ask the usage data in plain English; choose OpenAI or Claude. Read-only; prints the answer + the SQL it ran.', cli: 'node src/cli.js ask "<question>" [--provider openai|claude]', action: 'ask_question' },
    { id: 30, label: 'AI ask \u2014 guard demo (try a query)', desc: 'See the read-only guard ACCEPT/REJECT example queries or your own SQL, with the enforced LIMIT.', cli: 'node metrics/ask/demo_guard.js ["<sql>"]', action: 'ask_demo' },
    { id: 31, label: 'AI ask \u2014 guard & catalog tests', desc: 'Read-only SQL guard + ask catalog tests. Also runs inside Run ALL.', cli: 'node --test tests/ask_db.test.js tests/ask_guard.test.js', action: 'test_ask' },
    { id: 32, label: 'AI ask \u2014 view question log', desc: 'Recent AI questions + answers (audit log; no PII).', cli: 'node src/cli.js ask:log [--n 20]', action: 'ask_log' },
    { id: 33, label: 'AI ask \u2014 run SQL directly (read-only)', desc: 'Run a read-only SELECT yourself (guarded: SELECT-only, allowlisted table, enforced LIMIT). No AI involved.', cli: 'node src/cli.js ask:sql "<SELECT ...>"', action: 'ask_sql' },
    { id: 34, label: 'AI ask \u2014 view/manage corrections', desc: 'Operator clarifications the AI uses as grounding (G2). Deactivate with: node src/cli.js ask:uncorrect <id>.', cli: 'node src/cli.js ask:corrections [--n 20] [--all]', action: 'ask_corrections' },
    { id: 35, label: 'AI ask \u2014 test corrections (guided)', desc: 'Step-by-step process to confirm a saved correction is incorporated into the next answer (G2).', cli: 'node src/cli.js ask:test:corrections', action: 'ask_test_corrections' },
    { id: 36, label: 'AI ask \u2014 test follow-up thread (guided)', desc: 'Step-by-step process to confirm follow-up questions keep conversational context (B1).', cli: 'node src/cli.js ask:test:threads', action: 'ask_test_threads' },
    { id: 37, label: 'AI ask \u2014 run eval scenarios (records report)', desc: 'Runs the review scenarios against the live model (needs API key + DB) and writes a recorded report.', cli: 'node src/cli.js ask:eval', action: 'ask_eval' }
  ] },
  { label: 'Try Me (sample data)', color: GREEN, items: [
    { id: 38, label: 'Try Me — UI + is_demo wiring tests', desc: 'node test: the Try-me dropdown markup + the is_demo column wired across DDL, server whitelist, and browser allow-list.', cli: 'node --test tests/try_me.test.js', action: 'test_try_me' },
    { id: 39, label: 'Try Me — metrics report tests (demo split)', desc: 'node test: the is_demo split query + demo_split shape, plus Last-User-Activity MTN / dashboard_view exclusion.', cli: 'node --test tests/metrics_report.test.js', action: 'test_metrics_report' },
    { id: 40, label: 'Try Me vs real — counts (read-only SQL)', desc: 'Show demo (Try Me) vs real uploads/conversions/downloads straight from the events table.', cli: 'node src/cli.js ask:sql "SELECT … GROUP BY kind"', action: 'metrics_demo_split' }
  ] },
  { label: 'Salesforce (pull race-results files)', color: BLUE, items: [
    { id: 41, label: 'Salesforce — list files (today, MT)', desc: 'List Race Results Doc files modified today (Mountain Time). Needs SF_* env vars in .env.', cli: 'node src/cli.js sf:list --today', action: 'sf_list' },
    { id: 42, label: 'Salesforce — list recent files (precise or broad, prod or test)', desc: 'List recent files newest-first. Prompts: environment (prod/sandbox), search (precise term or broadened OR terms), and how many — so you can compare recall.', cli: 'node src/cli.js sf:list [--test] [--search "..."] --limit N', action: 'sf_list_recent' },
    { id: 43, label: 'Salesforce — pull files to a folder', desc: 'Download Race Results Doc files (snake_case names) into a folder. Prompts for date + folder + strategy.', cli: 'node src/cli.js sf:pull <opts> -o <dir>', action: 'sf_pull' },
    { id: 44, label: 'Salesforce — list EMAIL-queue files (prod or test)', desc: 'List Rankings email-queue race-results attachments. Prompts for environment, open-only/all status, and count.', cli: 'node src/cli.js sf:list-email [--all] [--test]', action: 'sf_list_email' },
    { id: 45, label: 'Salesforce — pull EMAIL-queue files to a folder', desc: 'Download Rankings email-queue attachments (snake_case names). Prompts for environment, status, and folder.', cli: 'node src/cli.js sf:pull-email <opts> -o <dir>', action: 'sf_pull_email' }
  ] },
  { label: 'Slack (pull race-results files)', color: BLUE, items: [
    { id: 46, label: 'Slack — check connection (probe)', desc: 'Read-only: confirm SLACK_BOT_TOKEN works, show the bot identity, and list the channels it is in. Optionally probe one channel for files.', cli: 'node src/cli.js slack:probe [--channel <id|name>]', action: 'slack_probe' },
    { id: 47, label: 'Slack — list the bot’s channels', desc: 'List the channels the bot is a member of (+ ids). Invite the bot to a channel in Slack and it shows up here.', cli: 'node src/cli.js slack:channels', action: 'slack_channels' },
    { id: 48, label: 'Slack — list files (date range)', desc: 'List spreadsheet attachments in a channel for a date range. Prompts for channel + date.', cli: 'node src/cli.js slack:list --channel <id|name> [date opts]', action: 'slack_list' },
    { id: 49, label: 'Slack — pull files to a folder', desc: 'Download a channel’s spreadsheet attachments (snake_case names) into a folder. Prompts for channel + date + folder + strategy.', cli: 'node src/cli.js slack:pull <opts> -o <dir>', action: 'slack_pull' },
    { id: 50, label: 'Slack — run Slack tests', desc: 'Run the Slack engine + UI unit tests (mock client, no network).', cli: 'node --test tests/slack_*.test.js', action: 'slack_tests' },
    { id: 51, label: 'Slack — setup & how-to (future self)', desc: 'Print the runbook: app scopes, getting the bot token into .env, and the self-service /invite channel flow.', action: 'slack_howto' }
  ] },
  { label: 'Usage analytics — maintenance', color: CYAN, items: [
    { id: 52, label: 'Backfill source: salesforce → sf_upload_queue', desc: 'One-time, idempotent relabel of legacy source=salesforce rows (the SF Email Queue is new, so all prior salesforce activity was the upload queue). Dry-run → confirm.', cli: 'node src/cli.js metrics:backfill-source', action: 'metrics_backfill_source' }
  ] },
  { label: 'Settings', color: GRAY, items: [
    { id: 53, label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item. Persists in .menu_prefs.json.', action: 'toggle' },
    { id: 54, label: 'Quit', desc: 'Exit the menu.', action: 'quit' }
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
    case 'ask_question': {
      try {
        const { CATALOG } = require('./metrics/ask/db');
        console.log(c(DIM, '\n  Read-only AI query over: ' + CATALOG.map(function (t) { return t.name; }).join(', ')));
      } catch (e) { /* ignore */ }
      let example = 'How many people used the converter last week?';
      try { const qs = require('./metrics/ask/context').load_context().example_questions || []; if (qs.length) example = qs[Math.floor(Math.random() * qs.length)]; } catch (e) { /* ignore */ }
      const q = clean(await ask(c(DIM, '\n  Your question  [Enter for example: ' + example + ']: '))) || example;
      let models = [];
      try { models = require('./metrics/ask/models').list(); } catch (e) { /* ignore */ }
      if (!models.length) models = [{ provider: 'openai', model: process.env.OPENAI_MODEL || '(OPENAI_MODEL)', label: 'OpenAI' }];
      console.log(c(DIM, '\n  Model (edit metrics/ask/models.js to add more):'));
      models.forEach(function (m, i) { console.log(c(DIM, '    ' + (i + 1) + ') ' + m.label + '  \u00b7 ' + m.model + (i === 0 ? '   [default]' : ''))); });
      const pick = clean(await ask(c(DIM, '  Pick a model [1]: ')));
      const idx = (Number(pick) >= 1 && Number(pick) <= models.length) ? Number(pick) - 1 : 0;
      const chosen = models[idx];
      console.log(c(DIM, '  Using: ' + chosen.provider + ' \u00b7 ' + chosen.model));
      await run('node', ['src/cli.js', 'ask', q, '--provider', chosen.provider, '--model', chosen.model]);
      break;
    }
    case 'ask_log': await run('node', ['src/cli.js', 'ask:log']); break;
    case 'ask_corrections': await run('node', ['src/cli.js', 'ask:corrections']); break;
    case 'ask_test_corrections': await run('node', ['src/cli.js', 'ask:test:corrections']); break;
    case 'ask_test_threads': await run('node', ['src/cli.js', 'ask:test:threads']); break;
    case 'ask_eval': await run('node', ['src/cli.js', 'ask:eval']); break;
    case 'ask_sql': {
      const sql = clean(await ask(c(DIM, '\n  Read-only SQL (SELECT only): ')));
      if (sql) { await run('node', ['src/cli.js', 'ask:sql', sql]); }
      break;
    }
    case 'ask_demo': {
      try {
        const { CATALOG } = require('./metrics/ask/db');
        console.log(c(DIM, '\n  Tables you may query (read-only allowlist):'));
        CATALOG.forEach(function (t) { console.log(c(DIM, '    \u2022 ' + t.name + (t.grain ? '  (' + t.grain + ')' : ''))); });
      } catch (e) { /* ignore */ }
      const sql = clean(await ask(c(DIM, '\n  SQL to test (blank = run examples): ')));
      await run('node', sql ? ['metrics/ask/demo_guard.js', '--no-header', sql] : ['metrics/ask/demo_guard.js', '--no-header']);
      break;
    }
    case 'test_ask': { console.log(c(DIM, '\n  running AI ask guard/catalog tests\u2026\n')); const code = await run('node', ['--test', 'tests/ask_db.test.js', 'tests/ask_guard.test.js']); console.log(code === 0 ? c(GREEN, '\n  \u2713 ask tests passed') : c(YELLOW, '\n  \u2717 ask tests failed')); break; }
    case 'test_normalize': await run_test('tests/normalize.test.js', 'value-normalization tests'); break;
    case 'test_match': await run_test('tests/match.test.js', 'column-matching tests'); break;
    case 'test_display': await run_test('tests/display.test.js', 'display-format tests'); break;
    case 'test_io': await run_test('tests/io.test.js', 'I/O round-trip tests'); break;
    case 'test_reconcile': await run_test('tests/reconcile.test.js', 'integrity tests'); break;
    case 'test_fixtures': await run_test('tests/fixtures.test.js', 'golden-fixture tests'); break;
    case 'test_lint': await run_test('tests/lint_snake_case.test.js', 'snake_case lint'); break;
    case 'test_config': await run_test('tests/config_wiring.test.js', 'config-wiring checks'); break;
    case 'test_try_me': await run_test('tests/try_me.test.js', 'Try-me UI + is_demo wiring tests'); break;
    case 'test_metrics_report': await run_test('tests/metrics_report.test.js', 'metrics report (last-activity + demo split) tests'); break;
    case 'metrics_demo_split': {
      const sql = "SELECT CASE WHEN is_demo=1 THEN 'Try Me' ELSE 'Real' END kind, " +
        "SUM(event_name='file_uploaded') uploads, SUM(event_name='conversion_completed') conversions, " +
        "SUM(event_name IN ('download','split_download_used')) downloads " +
        "FROM race_results_transform_events GROUP BY kind";
      console.log(c(DIM, '\n  Try Me vs real activity (read-only):'));
      await run('node', ['src/cli.js', 'ask:sql', sql]);
      break;
    }
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
    case 'metrics_purge_test': await run('node', ['src/cli.js', 'metrics:purge-test']); break;
    case 'metrics_purge_all': await run('node', ['src/cli.js', 'metrics:purge-all']); break;
    case 'sf_list': await run('node', ['src/cli.js', 'sf:list', '--today']); break;
    case 'sf_list_recent': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Search term:'));
      console.log(c(DIM, '    [1] precise (default) — only "Race Results Doc" titles. Cleanest + fewest files; may miss oddly-named ones.'));
      console.log(c(DIM, '    [2] broad — OR of "Race Results Doc" / "Race Results" / Race / Results. Also catches race-results files'));
      console.log(c(DIM, '        NOT titled "Race Results Doc", but pulls in more unrelated spreadsheets that mention race or results.'));
      const spick = clean(await ask('  Choose [1]: ')) || '1';
      const search_args = spick === '2' ? ['--search', 'Race Results Doc,Race Results,Race,Results'] : [];
      const n = clean(await ask('  How many (blank = 25): '));
      const args = ['src/cli.js', 'sf:list'].concat(test_args, search_args, ['--limit', n || '25']);
      await run('node', args);
      break;
    }
    case 'sf_list_email': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Status: [1] Is Not Closed  [2] Is Closed  [3] All'));
      const stpick = clean(await ask('  Choose [1]: ')) || '1';
      const status_args = stpick === '2' ? ['--status', 'closed'] : (stpick === '3' ? ['--status', 'all'] : []);
      const n = clean(await ask('  How many (blank = 50): '));
      await run('node', ['src/cli.js', 'sf:list-email'].concat(test_args, status_args, ['--limit', n || '50']));
      break;
    }
    case 'sf_pull_email': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Status: [1] open only  [2] all statuses'));
      const stpick = clean(await ask('  Choose [1]: ')) || '1';
      const status_args = stpick === '2' ? ['--all'] : [];
      const folder = clean(await ask('  Save to folder (blank = ./sf_email_race_result_downloads): '));
      await run('node', ['src/cli.js', 'sf:pull-email'].concat(test_args, status_args, ['-o', folder || 'sf_email_race_result_downloads', '--strategy', 'add_new']));
      break;
    }
    case 'sf_pull': {
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [1]: ')) || '1';
      const date_args = [];
      if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      else if (pick === '4') { /* all */ }
      else date_args.push('--today');
      const folder = clean(await ask('  Save to folder (blank = ./sf_race_result_downloads): '));
      console.log(c(DIM, '  If a file already exists: [1] add new only  [2] overwrite same names  [3] delete all, then add'));
      const sp = clean(await ask('  Choose [1]: ')) || '1';
      const strategy = sp === '2' ? 'replace' : (sp === '3' ? 'wipe_all' : 'add_new');
      const args = ['src/cli.js', 'sf:pull'].concat(date_args, ['-o', folder || 'sf_race_result_downloads', '--strategy', strategy]);
      await run('node', args);
      break;
    }
    case 'slack_probe': {
      const ch = clean(await ask('  Probe a channel too? (id or name, blank = just list channels): '));
      const ch_args = ch ? ['--channel', ch] : [];
      await run('node', ['src/cli.js', 'slack:probe'].concat(ch_args));
      break;
    }
    case 'slack_channels': await run('node', ['src/cli.js', 'slack:channels']); break;
    case 'slack_list': {
      const ch = await slack_pick_channel();
      const ch_args = ch ? ['--channel', ch] : [];
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [4]: ')) || '4';
      const date_args = [];
      if (pick === '1') date_args.push('--today');
      else if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      await run('node', ['src/cli.js', 'slack:list'].concat(ch_args, date_args));
      break;
    }
    case 'slack_pull': {
      const ch = await slack_pick_channel();
      const ch_args = ch ? ['--channel', ch] : [];
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [4]: ')) || '4';
      const date_args = [];
      if (pick === '1') date_args.push('--today');
      else if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      const folder = clean(await ask('  Save to folder (blank = ./slack_race_result_downloads): '));
      await run('node', ['src/cli.js', 'slack:pull'].concat(ch_args, date_args, ['-o', folder || 'slack_race_result_downloads', '--strategy', 'add_new']));
      break;
    }
    case 'slack_tests': { console.log(c(DIM, '\n  running Slack engine + UI tests…\n')); const code = await run('node', ['--test', 'tests/slack_dates.test.js', 'tests/slack_client.test.js', 'tests/slack_ui.test.js']); console.log(code === 0 ? c(GREEN, '\n  ✓ Slack tests passed') : c(YELLOW, '\n  ✗ Slack tests failed')); break; }
    case 'slack_howto': {
      console.log(c(BLUE, '\n  Slack intake — setup & how-to (future self)\n'));
      console.log('  One-time app setup (api.slack.com → your app):');
      console.log(c(DIM, '    1. OAuth & Permissions → Bot Token Scopes: files:read, channels:read, channels:history,'));
      console.log(c(DIM, '       groups:read, groups:history, users:read. Then reinstall the app.'));
      console.log(c(DIM, '    2. Copy the Bot User OAuth Token (xoxb-…) into .env as SLACK_BOT_TOKEN (keep it local).'));
      console.log('\n  Self-service channels (no config, no redeploy):');
      console.log(c(DIM, '    In Slack, run  /invite @your-bot  in any channel → it auto-appears in the picker (↻ Refresh).'));
      console.log(c(DIM, '    The web app shows this instruction + a copy button next to the channel dropdown.'));
      console.log('\n  Point at a different/real channel: just invite the bot there — no env change needed.');
      console.log('\n  Verify: ' + c(DIM, 'node src/cli.js slack:probe') + '  ·  plan: ' + c(DIM, 'plans_and_notes/SLACK_INTAKE_PLAN.md') + '\n');
      break;
    }
    case 'metrics_backfill_source': await run('node', ['src/cli.js', 'metrics:backfill-source']); break;
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
