'use strict';
// menu.js - interactive launcher for salesforce_email_queue_proof_of_concept.
// Mirrors src/race_results_transform/menu.js: numbered color-coded sections that auto-renumber, a
// .menu_prefs.json toggle to show/hide the underlying CLI command, a titled banner before each run
// (and a per-suite header in Run ALL tests), and a spawn-based run harness where Ctrl-C stops the
// child and returns you to the menu. Built on Node's readline - no dependencies.
//
// Usage:  node menu.js          (interactive)
//         node menu.js test     (run all tests headless, e.g. for CI)

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

const APP = 'Salesforce Email Queue POC';
const DIR = __dirname;
const PREFS_FILE = path.join(DIR, '.menu_prefs.json');

const R = '\x1b[0m', BOLD = '\x1b[1m', GRAY = '\x1b[90m';
const CYAN = '\x1b[36m', MAGENTA = '\x1b[35m', GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', BLU = '\x1b[34m';
function c(col, s) { return col + s + R; }

function banner(title) {
  const text = APP + '  |  ' + title;
  const line = '='.repeat(Math.max(30, text.length + 4));
  console.log('');
  console.log(c(CYAN, line));
  console.log(c(BOLD, '  ' + text));
  console.log(c(GRAY, '  ' + new Date().toLocaleString()));
  console.log(c(CYAN, line));
  console.log('');
}
function subhead(title) { console.log(''); console.log(c(BOLD, c(MAGENTA, '-------- ' + title + ' --------'))); }

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) {} }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) {} }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(function (res) { rl.question(q, res); }); }
function clean(s) { return String(s || '').trim().replace(/^["']|["']$/g, ''); }

function run(cmd, args) {
  return new Promise(function (resolve) {
    rl.pause();
    // `node` is directly executable; do NOT wrap it in a shell on Windows - a cmd.exe wrapper
    // intercepts Ctrl-C and the child (e.g. the server) never receives SIGINT, so it can't shut
    // down cleanly. Only npm/open and similar need a shell on Windows.
    const need_shell = process.platform === 'win32' && cmd !== 'node';
    // While the child owns the terminal, let IT handle Ctrl-C (the server's own SIGINT cleanup
    // exits it); the menu ignores SIGINT meanwhile and just returns when the child closes.
    const ignore = function () {};
    process.on('SIGINT', ignore);
    const p = spawn(cmd, args, { cwd: DIR, stdio: 'inherit', shell: need_shell });
    p.on('close', function (code) { process.removeListener('SIGINT', ignore); rl.resume(); resolve(code); });
  });
}

const ALL_TESTS = ['tests/text_clean.test.js', 'tests/sf_threads.test.js', 'tests/extract.test.js', 'tests/ai.test.js', 'tests/faq_corrections.test.js', 'tests/auth.test.js'];

async function run_all_tests() {
  const failed = [];
  for (let i = 0; i < ALL_TESTS.length; i++) {
    subhead(ALL_TESTS[i]);
    const code = await run('node', ['--test', ALL_TESTS[i]]);
    if (code) failed.push(ALL_TESTS[i]);
  }
  console.log('');
  if (failed.length) console.log(c(RED, 'FAILED suites: ' + failed.join(', ')));
  else console.log(c(GREEN, 'ALL ' + ALL_TESTS.length + ' SUITES PASSED'));
  return failed.length ? 1 : 0;
}

const SECTIONS = [
  { label: 'Tests', color: MAGENTA, items: [
    { label: 'Run ALL tests', desc: 'Each suite with its own header, then a pass/fail summary.', cli: 'node --test tests/*.test.js', action: 'test_all' },
    { label: 'Text cleaning tests', desc: 'html_to_text + quoted-history stripping.', cli: 'node --test tests/text_clean.test.js', action: 'test_text' },
    { label: 'Thread reader tests', desc: 'get_thread ordering, automated flag, attachments (mock conn).', cli: 'node --test tests/sf_threads.test.js', action: 'test_threads' },
    { label: 'Attachment extraction tests', desc: 'text/csv/html + graceful binary fallback.', cli: 'node --test tests/extract.test.js', action: 'test_extract' },
    { label: 'AI layer tests', desc: 'context assembly + verdict parsing (mock provider).', cli: 'node --test tests/ai.test.js', action: 'test_ai' },
    { label: 'FAQ + corrections tests', desc: 'faq loader + corrections store/grounding.', cli: 'node --test tests/faq_corrections.test.js', action: 'test_faq' },
    { label: 'Auth tests', desc: 'scrypt hashing + signed-cookie sessions.', cli: 'node --test tests/auth.test.js', action: 'test_auth' },
    { label: 'Web E2E (Playwright)', desc: 'Browser tests of the web UI (stubs the API). One-time: npx playwright install chromium.', cli: 'npx playwright test -c e2e/playwright.config.js', action: 'e2e' }
  ] },
  { label: 'Salesforce (read-only)', color: CYAN, items: [
    { label: 'Verify SF access - PRODUCTION', desc: 'Connectivity + field access + Coaching queue preview.', cli: 'node verify_sf_access.js prod', action: 'verify_prod' },
    { label: 'Verify SF access - SANDBOX', desc: 'Same checks against the dev org (SF_DEV_*).', cli: 'node verify_sf_access.js sandbox', action: 'verify_sandbox' },
    { label: 'List queues', desc: 'All Salesforce queues + open-case counts.', cli: 'node src/cli.js queues', action: 'list_queues' },
    { label: 'List case statuses', desc: 'The real Case Status picklist values in this org.', cli: 'node src/cli.js statuses', action: 'list_statuses' }
  ] },
  { label: 'AI assistant (read-only - needs an AI API key)', color: GREEN, items: [
    { label: 'Browse & assist (pick queue -> email -> draft/ask)', desc: 'Guided: queue -> status -> email -> draft a reply, ask a question, or add a correction. No IDs needed. Nothing is sent.', cli: 'node src/cli.js assist', action: 'assist' },
    { label: 'View corrections', desc: 'Operator corrections currently grounding the AI.', cli: 'node src/cli.js corrections', action: 'view_corrections' },
    { label: 'View context files', desc: 'Reference files the AI reads from data/context/ (md, csv, pdf, docx, xlsx).', cli: 'node src/cli.js context', action: 'view_context' }
  ] },
  { label: 'Server & users', color: BLU, items: [
    { label: 'Start web app (port 8019)', desc: 'Express server + single-page UI for reviewers. Ctrl-C to stop.', cli: 'node ../../server_salesforce_email_queue_8019.js', action: 'server' },
    { label: 'Add / update a user', desc: 'Create a web app login (username + password).', cli: 'node src/admin.js add', action: 'add_user' },
    { label: 'List users', desc: 'Show web app logins.', cli: 'node src/admin.js list', action: 'list_users' },
    { label: 'Reset a user password', desc: 'Set a new password for an existing login (passwords are hashed, never shown).', cli: 'node src/admin.js passwd', action: 'reset_pw' }
  ] }
];

const ACTIONS = {
  test_all: function () { return run_all_tests(); },
  test_text: function () { return run('node', ['--test', 'tests/text_clean.test.js']); },
  test_threads: function () { return run('node', ['--test', 'tests/sf_threads.test.js']); },
  test_extract: function () { return run('node', ['--test', 'tests/extract.test.js']); },
  test_ai: function () { return run('node', ['--test', 'tests/ai.test.js']); },
  test_faq: function () { return run('node', ['--test', 'tests/faq_corrections.test.js']); },
  test_auth: function () { return run('node', ['--test', 'tests/auth.test.js']); },
  e2e: function () { return run('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.js']); },
  verify_prod: function () { return run('node', ['verify_sf_access.js', 'prod']); },
  verify_sandbox: function () { return run('node', ['verify_sf_access.js', 'sandbox']); },
  list_queues: function () { return run('node', ['src/cli.js', 'queues']); },
  list_statuses: function () { return run('node', ['src/cli.js', 'statuses']); },
  assist: function () { return run('node', ['src/cli.js', 'assist']); },
  view_corrections: function () { return run('node', ['src/cli.js', 'corrections']); },
  view_context: function () { return run('node', ['src/cli.js', 'context']); },
  server: function () { return run('node', ['../../server_salesforce_email_queue_8019.js']); },
  add_user: function () { return run('node', ['src/admin.js', 'add']); },
  list_users: function () { return run('node', ['src/admin.js', 'list']); },
  reset_pw: function () { return run('node', ['src/admin.js', 'passwd']); }
};

function render() {
  console.clear();
  const rule = '='.repeat(64);
  console.log(c(CYAN, rule));
  console.log(c(CYAN, c(BOLD, '  ' + APP + ' - menu')) + c(GRAY, '   (' + DIR + ')'));
  console.log(c(GRAY, '  Read-only proof of concept. Nothing is sent to Salesforce.'));
  console.log(c(CYAN, rule));
  let n = 0; const map = {};
  SECTIONS.forEach(function (sec) {
    console.log('');
    console.log(c(sec.color, c(BOLD, '  ' + sec.label)));
    console.log(c(sec.color, '  ' + '-'.repeat(sec.label.length)));
    sec.items.forEach(function (it) {
      n += 1; map[n] = it;
      console.log('   ' + c(sec.color, c(BOLD, '[' + n + ']')) + ' ' + c(BOLD, it.label));
      console.log('       ' + c(GRAY, it.desc));
      if (_show_cli && it.cli) console.log('       ' + c(GRAY, '$ ' + it.cli));
    });
  });
  console.log('');
  console.log('  ' + c(BOLD, c(YEL, '[t]')) + c(GRAY, ' toggle CLI commands (' + (_show_cli ? 'on' : 'off') + ')    ') + c(BOLD, c(YEL, '[q]')) + c(GRAY, ' quit'));
  return map;
}

async function main() {
  load_prefs();
  if (process.argv[2] === 'test') { banner('Run ALL tests'); const code = await ACTIONS.test_all(); rl.close(); process.exit(code || 0); }
  for (;;) {
    const map = render();
    const ans = clean(await ask('\nChoose: ')).toLowerCase();
    if (ans === 'q' || ans === 'quit') break;
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = map[Number(ans)];
    if (!it) continue;
    banner(it.label);
    await ACTIONS[it.action]();
    await ask(c(GRAY, '\n(done - press Enter to return to the menu)'));
  }
  rl.close();
}

main();
