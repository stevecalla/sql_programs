'use strict';
// menu.js - interactive launcher for salesforce_email_queue_proof_of_concept.
//
// DATA-ONLY shell: rendering, numbering (by position), the [t] toggle, spawn (with Ctrl-C handoff), and
// quit come from the shared kit (utilities/menu/menu_kit.js). This file keeps its ACTIONS map + titled
// banner + Run-ALL test harness; the kit calls onSelect for each item and delegates to ACTIONS[action].
// See plans_and_notes/MENU_CONVENTIONS.md.
//
// Usage:  node menu.js          (interactive)
//         node menu.js test     (run all tests headless, e.g. for CI)

const path = require('path');
const { spawn } = require('child_process');
const { runMenu } = require('../../utilities/menu/menu_kit');

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
  console.log(c(CYAN, line));
  console.log('');
}
function subhead(title) { console.log(''); console.log(c(BOLD, c(MAGENTA, '-------- ' + title + ' --------'))); }
function clean(s) { return String(s || '').trim().replace(/^["']|["']$/g, ''); }

// The kit's context for the item currently running (set in onSelect). Lets the shared ACTIONS/run() reach
// the kit's readline + spawn. In headless `test` mode _ctx stays null and run() falls back to a plain spawn.
let _ctx = null;
function run(cmd, args) {
  if (_ctx) return _ctx.runCmd(cmd, args, cmd + ' ' + args.join(' '));
  return new Promise((resolve) => {
    const need_shell = process.platform === 'win32' && cmd !== 'node';
    const p = spawn(cmd, args, { cwd: DIR, stdio: 'inherit', shell: need_shell });
    p.on('close', resolve);
  });
}
function ask(q) { return _ctx ? _ctx.ask(q) : Promise.resolve(''); }

const ALL_TESTS = ['tests/text_clean.test.js', 'tests/sf_threads.test.js', 'tests/extract.test.js', 'tests/ai.test.js', 'tests/faq_corrections.test.js', 'tests/auth.test.js', 'tests/metrics.test.js', 'tests/queue_access.test.js', 'tests/analytics.test.js', 'tests/ask.test.js', 'tests/admin_users.test.js', 'tests/console.test.js'];

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
  { label: 'Tests', color: 'MAGENTA', items: [
    { label: 'Run ALL tests', desc: 'Each suite with its own header, then a pass/fail summary.', cli: 'node --test tests/*.test.js', action: 'test_all' },
    { label: 'Text cleaning tests', desc: 'html_to_text + quoted-history stripping.', cli: 'node --test tests/text_clean.test.js', action: 'test_text' },
    { label: 'Thread reader tests', desc: 'get_thread ordering, automated flag, attachments (mock conn).', cli: 'node --test tests/sf_threads.test.js', action: 'test_threads' },
    { label: 'Attachment extraction tests', desc: 'text/csv/html + graceful binary fallback.', cli: 'node --test tests/extract.test.js', action: 'test_extract' },
    { label: 'AI layer tests', desc: 'context assembly + verdict parsing (mock provider).', cli: 'node --test tests/ai.test.js', action: 'test_ai' },
    { label: 'FAQ + corrections tests', desc: 'faq loader + corrections store/grounding.', cli: 'node --test tests/faq_corrections.test.js', action: 'test_faq' },
    { label: 'Auth tests', desc: 'scrypt hashing + signed-cookie sessions.', cli: 'node --test tests/auth.test.js', action: 'test_auth' },
    { label: 'Metrics config + DDL tests', desc: 'metrics_config + events-table DDL contract.', cli: 'node --test tests/metrics.test.js', action: 'test_metrics' },
    { label: 'Queue access tests', desc: 'allow-list default + per-user overrides + admin bypass.', cli: 'node --test tests/queue_access.test.js', action: 'test_qa' },
    { label: 'Analytics tests', desc: 'ingest whitelist/stamp + metrics report contract (fake pool).', cli: 'node --test tests/analytics.test.js', action: 'test_analytics' },
    { label: 'Ask-your-data tests', desc: 'SQL guard (read-only) + ask() brain with injected provider/pool.', cli: 'node --test tests/ask.test.js', action: 'test_ask' },
    { label: 'Admin users tests', desc: 'auth_store roles + .env recovery accounts (Access pane).', cli: 'node --test tests/admin_users.test.js', action: 'test_admin_users' },
    { label: 'Web E2E (Playwright)', desc: 'Browser tests of the web UI (stubs the API). One-time: npx playwright install chromium.', cli: 'npx playwright test -c e2e/playwright.config.js', action: 'e2e' }
  ] },
  { label: 'Salesforce (read-only)', color: 'CYAN', items: [
    { label: 'Verify SF access - PRODUCTION', desc: 'Connectivity + field access + Coaching queue preview.', cli: 'node verify_sf_access.js prod', action: 'verify_prod' },
    { label: 'Verify SF access - SANDBOX', desc: 'Same checks against the dev org (SF_DEV_*).', cli: 'node verify_sf_access.js sandbox', action: 'verify_sandbox' },
    { label: 'List queues', desc: 'All Salesforce queues + open-case counts.', cli: 'node src/cli.js queues', action: 'list_queues' },
    { label: 'List case statuses', desc: 'The real Case Status picklist values in this org.', cli: 'node src/cli.js statuses', action: 'list_statuses' }
  ] },
  { label: 'AI assistant (read-only - needs an AI API key)', color: 'GREEN', items: [
    { label: 'Browse & assist (pick queue -> email -> draft/ask)', desc: 'Guided: queue -> status -> email -> draft a reply, ask a question, or add a correction. No IDs needed. Nothing is sent.', cli: 'node src/cli.js assist', action: 'assist' },
    { label: 'View corrections', desc: 'Operator corrections currently grounding the AI.', cli: 'node src/cli.js corrections', action: 'view_corrections' },
    { label: 'View context files', desc: 'Reference files the AI reads from data/context/ (md, csv, pdf, docx, xlsx).', cli: 'node src/cli.js context', action: 'view_context' }
  ] },
  { label: 'Metrics & analytics (needs the local analytics DB)', color: 'YELLOW', items: [
    { label: 'Metrics stats (last 7 days)', desc: 'Text usage report from the analytics table (AI calls, providers, verdicts, queues).', cli: 'node metrics/metrics_cli.js stats', action: 'metrics_stats' },
    { label: 'Metrics table size', desc: 'Row count + size + by-year breakdown of the events table.', cli: 'node metrics/metrics_cli.js size', action: 'metrics_size' },
    { label: 'Purge TEST rows (is_test=1, $0 only)', desc: 'Delete deliberate $0 test-run rows (browser opened with ?metrics_test=1). KEEPS test AI calls that cost money (spend record preserved); real + demo data untouched.', cli: 'node metrics/metrics_cli.js purge-test', action: 'metrics_purge_test' },
    { label: 'Cleanup — purge old years', desc: 'Keep current + prior calendar year; delete older rows.', cli: 'node metrics/metrics_cli.js cleanup', action: 'metrics_cleanup' },
    { label: 'PURGE ALL (danger)', desc: 'Delete every analytics row regardless of date.', cli: 'node metrics/metrics_cli.js purge-all', action: 'metrics_purge_all' },
    { label: 'AI ask — ask a question (read-only)', desc: 'Ask the usage data in plain English; prints the answer + the SQL it ran. Read-only guarded.', cli: 'node metrics/metrics_cli.js ask "<question>"', action: 'metrics_ask' },
    { label: 'AI ask — guard demo', desc: 'See the read-only SQL guard ACCEPT/REJECT example queries (no DB needed).', cli: 'node metrics/metrics_cli.js guard', action: 'metrics_guard' }
  ] },
  { label: 'Server & users', color: 'BLUE', items: [
    { label: 'Start web app (port 8019)', desc: 'Express server + SPA + /metrics dashboard + /admin hub. Ctrl-C to stop.', cli: 'node ../../server_salesforce_email_queue_8019.js', action: 'server' },
    { label: 'Open the web app in a browser', desc: 'Open http://localhost:8019 (start the server first). /metrics + /admin are linked in the header for admins.', cli: 'open http://localhost:8019', action: 'open_app' },
    { label: 'Add / update a user', desc: 'Create a web app login (username + password).', cli: 'node src/admin.js add', action: 'add_user' },
    { label: 'List users', desc: 'Show web app logins.', cli: 'node src/admin.js list', action: 'list_users' },
    { label: 'Reset a user password', desc: 'Set a new password for an existing login (passwords are hashed, never shown).', cli: 'node src/admin.js passwd', action: 'reset_pw' },
    { label: 'Remove a user', desc: 'Delete a web app login (prompts for the username + confirm).', cli: 'node src/admin.js remove', action: 'remove_user' }
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
  test_metrics: function () { return run('node', ['--test', 'tests/metrics.test.js']); },
  test_qa: function () { return run('node', ['--test', 'tests/queue_access.test.js']); },
  test_analytics: function () { return run('node', ['--test', 'tests/analytics.test.js']); },
  test_ask: function () { return run('node', ['--test', 'tests/ask.test.js']); },
  test_admin_users: function () { return run('node', ['--test', 'tests/admin_users.test.js']); },
  e2e: function () { return run('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.js']); },
  metrics_stats: function () { return run('node', ['metrics/metrics_cli.js', 'stats']); },
  metrics_size: function () { return run('node', ['metrics/metrics_cli.js', 'size']); },
  metrics_purge_test: function () { return run('node', ['metrics/metrics_cli.js', 'purge-test']); },
  metrics_cleanup: function () { return run('node', ['metrics/metrics_cli.js', 'cleanup']); },
  metrics_purge_all: function () { return run('node', ['metrics/metrics_cli.js', 'purge-all']); },
  metrics_ask: async function () { const q = clean(await ask('  Question: ')); if (!q) return; return run('node', ['metrics/metrics_cli.js', 'ask', q]); },
  metrics_guard: function () { return run('node', ['metrics/metrics_cli.js', 'guard']); },
  open_app: function () { const url = 'http://localhost:8019'; const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open'); const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]; return run(cmd, args); },
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
  reset_pw: function () { return run('node', ['src/admin.js', 'passwd']); },
  remove_user: function () { return run('node', ['src/admin.js', 'remove']); }
};

const ALL = SECTIONS.flatMap((s) => s.items);

// onSelect: set the active kit context, print the titled banner, then run the item's ACTION (unchanged).
async function onSelect(item, ctx) {
  _ctx = ctx;
  banner(item.label);
  const fn = ACTIONS[item.action];
  if (fn) await fn();
  else console.log(c(YEL, '  Unknown action: ' + item.action));
}

if (require.main === module) {
  if (process.argv[2] === 'test') {                 // headless CI path — no menu, no readline
    banner('Run ALL tests');
    run_all_tests().then((code) => process.exit(code || 0)).catch((e) => { console.error(e); process.exit(1); });
  } else {
    runMenu({
      title: APP + ' - menu',
      subtitle: 'Read-only proof of concept. Nothing is sent to Salesforce.\n(' + DIR + ')',
      color: 'CYAN',
      sections: SECTIONS,
      cwd: DIR,
      prefsFile: PREFS_FILE,
      onSelect: onSelect,
    }).catch((e) => { console.error(e); process.exit(1); });
  }
}

module.exports = { SECTIONS, ALL, ACTIONS };
