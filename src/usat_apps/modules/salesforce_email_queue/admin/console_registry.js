'use strict';
// console_registry.js — the allow-list of commands the Email Queue admin → Operations panel can run,
// AND the single source of truth the module's CLI menu.js renders from (so the web console and the CLI
// stay aligned by construction). Ported to 100% PARITY with the standalone POC's admin/console_registry.js
// (same 5 sections, same command set, same klass/confirm/web semantics) — the only change is that every
// argv is RE-POINTED at the real usat_apps equivalent, because the POC's tests/*.test.js, src/cli.js,
// verify_sf_access.js and standalone metrics_cli.js paths don't exist in the platform:
//   - Tests    -> the ported node --test files (services + module + platform), each individually + Run ALL.
//   - Salesforce-> check_sf_read.js (prod/--sandbox); list queues/statuses now live in the operator UI (note).
//   - AI assist -> the operator web app IS the guided assistant; corrections/context show in its cards (note).
//   - Metrics  -> metrics/metrics_cli.js (stats|size|purge-test|cleanup|purge-all|ask|guard).
//   - Server/users -> owned by the platform (server_usat_apps_8022.js + Users & access) (note).
// Everything is spawned `node`, shell:false, cwd=repo root (see console_runner). Reached only behind
// require_admin. Item shape:
//   { id, action, label, desc, cli, web:'run'|'form'|'terminal', klass:'test'|'read'|'mutate'|'destruct'|'na',
//     bin, argv:[...], params?:[{name,label,type,required,positional?,flag?,default?,options?}], confirm?, note? }
// ids are unique + sequential 1..N (the console.test.js contract).
const T = 'src/usat_apps';                                   // platform root (cwd = repo root)
const S = T + '/services';                                   // shared services
const M = T + '/modules/salesforce_email_queue';             // this module

// "Run ALL" routes through run_tests.js over the EQ-relevant subtrees (services + module) + two EQ platform
// tests, so the output is per-file section headers + a pass/fail roll-up (matching the POC's Run ALL), not
// a flat node --test dump. run_tests.js now accepts a mix of dirs + files (resolved under src/usat_apps);
// this set excludes the DB-dependent tests/status.test.js. Individual test items below run one file each via
// raw `node --test`.
const RUN_ALL_ARGS = ['src/usat_apps/run_tests.js', 'services', 'modules/salesforce_email_queue', 'tests/auth.test.js', 'tests/lint_snake_case.test.js'];
function one_test(file) { return { web: 'run', klass: 'test', bin: 'node', argv: ['--test', file], cli: 'node --test ' + file }; }

const SECTIONS = [
  { label: 'Tests (node, no browser)', color: 'MAGENTA', items: [
    { id: 1, action: 'test_all', label: 'Run ALL tests', desc: 'Every ported suite (services + module + EQ platform tests) via run_tests.js — per-file section headers + a pass/fail roll-up. No DB.', web: 'run', klass: 'test', bin: 'node', argv: RUN_ALL_ARGS, cli: 'node ' + RUN_ALL_ARGS.join(' ') },
    Object.assign({ id: 2, action: 'test_text', label: 'Text cleaning', desc: 'html_to_text + quoted-history stripping.' }, one_test(S + '/text_clean.test.js')),
    Object.assign({ id: 3, action: 'test_threads', label: 'Thread reader', desc: 'get_thread ordering, automated flag, attachments (mock conn).' }, one_test(M + '/tests/sf_threads.test.js')),
    Object.assign({ id: 4, action: 'test_extract', label: 'Attachment extraction', desc: 'text/csv/html + graceful binary fallback.' }, one_test(S + '/ai/tests/extract.test.js')),
    Object.assign({ id: 5, action: 'test_ai', label: 'AI layer (respond / ask)', desc: 'context assembly + verdict parsing (injected transport).' }, one_test(S + '/ai/tests/respond_ask.test.js')),
    Object.assign({ id: 6, action: 'test_providers', label: 'AI providers (vision / complete)', desc: 'image-embed content builders + complete() usage capture (stub transport).' }, one_test(S + '/ai/tests/providers.test.js')),
    Object.assign({ id: 7, action: 'test_models', label: 'AI models & pricing', desc: 'registry one-default, price_for / cost_for, resolve precedence, admin override.' }, one_test(S + '/ai/tests/models.test.js')),
    Object.assign({ id: 8, action: 'test_faq', label: 'Knowledge + corrections', desc: 'scoped knowledge loader + corrections store/grounding.', web: 'run', klass: 'test', bin: 'node', argv: ['--test', S + '/knowledge/tests/knowledge.test.js', S + '/corrections/tests/corrections.test.js'], cli: 'node --test ' + S + '/knowledge/tests/knowledge.test.js ' + S + '/corrections/tests/corrections.test.js' }),
    Object.assign({ id: 9, action: 'test_auth', label: 'Auth + env accounts', desc: 'scrypt hashing + signed-cookie sessions + .env recovery accounts (Access).' }, one_test(T + '/tests/auth.test.js')),
    Object.assign({ id: 10, action: 'test_metrics', label: 'Metrics config + DDL', desc: 'metrics_config whitelist + events-table DDL contract.' }, one_test(M + '/tests/metrics_config.test.js')),
    Object.assign({ id: 11, action: 'test_qa', label: 'Queue access', desc: 'allow-list default + per-user overrides + admin bypass.' }, one_test(M + '/tests/queue_access.test.js')),
    Object.assign({ id: 12, action: 'test_analytics', label: 'Analytics', desc: 'ingest whitelist/stamp + metrics report contract (fake pool).' }, one_test(M + '/tests/analytics.test.js')),
    Object.assign({ id: 13, action: 'test_ask', label: 'Ask-your-data guard', desc: 'read-only SQL guard (SELECT-only, LIMIT clamp, one table) + NO_AI_KEY gate.' }, one_test(M + '/tests/metrics_ask.test.js')),
    Object.assign({ id: 14, action: 'test_lint', label: 'Lint — snake_case', desc: 'Fail if any of our identifiers are camelCase (DOM/library names allowed).' }, one_test(T + '/tests/lint_snake_case.test.js')),
    Object.assign({ id: 15, action: 'test_spam', label: 'Spam heuristic', desc: 'conservative local spam signals + classify_local wiring.' }, one_test(S + '/ai/tests/spam.test.js')),
    Object.assign({ id: 16, action: 'test_routes', label: 'Routes (API)', desc: 'JSON API contract: panel gate, ai/models, admin config round-trip, console + pm2 (in-memory).' }, one_test(M + '/tests/api.test.js')),
    Object.assign({ id: 17, action: 'test_triage', label: 'Triage', desc: 'parse_triage + classify_local + triage_case over a data-in thread.' }, one_test(S + '/ai/tests/triage.test.js')),
    Object.assign({ id: 18, action: 'test_console', label: 'Operations console', desc: 'this registry shape + the runner argv-assembly + confirm guard.' }, one_test(M + '/tests/console.test.js')),
    { id: 19, action: 'e2e', label: 'Web E2E (Playwright)', desc: 'Browser smoke of the operator UI (stubs the API). One-time: npx playwright install chromium.', cli: 'npm run salesforce_email_queue_e2e', web: 'terminal', klass: 'test', bin: 'npm', argv: ['run', 'salesforce_email_queue_e2e'], note: 'Opens a real browser — run it from a terminal (or the module CLI menu), not from /admin. CLI: npm run salesforce_email_queue_e2e' },
  ] },
  { label: 'Salesforce (read-only)', color: 'CYAN', items: [
    { id: 20, action: 'verify_prod', label: 'Verify SF read — PRODUCTION', desc: 'Connect (read role) + list queues via services/salesforce (SF_PROD_*). Read-only.', cli: 'node ' + M + '/check_sf_read.js', web: 'run', klass: 'read', bin: 'node', argv: [M + '/check_sf_read.js'] },
    { id: 21, action: 'verify_sandbox', label: 'Verify SF read — SANDBOX', desc: 'Same checks against the dev org (SF_DEV_*, test.salesforce.com). Read-only.', cli: 'node ' + M + '/check_sf_read.js --sandbox', web: 'run', klass: 'read', bin: 'node', argv: [M + '/check_sf_read.js', '--sandbox'] },
    { id: 22, action: 'list_queues', label: 'List queues', desc: 'All Salesforce queues + open-case counts.', cli: '(see Verify SF read — it lists queues)', web: 'terminal', klass: 'na', note: 'Verify SF read — PRODUCTION (above) lists every queue + open-case counts; the operator app’s queue picker also shows them live.' },
    { id: 23, action: 'list_statuses', label: 'List case statuses', desc: 'The Case Status picklist values in this org.', cli: '(operator app status filter)', web: 'terminal', klass: 'na', note: 'Case Status picklist values are shown in the operator app’s status filter — there is no separate CLI in the platform.' },
  ] },
  { label: 'AI assistant (read-only)', color: 'GREEN', items: [
    { id: 24, action: 'assist', label: 'Browse & assist (guided)', desc: 'Interactive: queue → status → email → draft / ask / correct. Nothing is sent.', cli: 'open /salesforce/email-queue', web: 'terminal', klass: 'na', note: 'The operator app IS the guided assistant — open http://localhost:8022/salesforce/email-queue (queue → email → draft / ask / correct).' },
    { id: 25, action: 'view_corrections', label: 'View corrections', desc: 'Operator corrections currently grounding the AI.', cli: '(operator app · Corrections)', web: 'terminal', klass: 'na', note: 'Corrections show in the operator app (Corrections) + the metrics Ask; stored in the DB table knowledge_corrections.' },
    { id: 26, action: 'view_context', label: 'View context files', desc: 'Reference files the AI reads (md, csv, pdf, docx, xlsx).', cli: '(operator app · Context)', web: 'terminal', klass: 'na', note: 'Reference/context files show in the operator app’s Context card (md, csv, pdf, docx, xlsx).' },
  ] },
  { label: 'Metrics & analytics', color: 'CYAN', items: [
    { id: 27, action: 'metrics_stats', label: 'Usage stats (last 7 days)', desc: 'Text usage report over salesforce_email_queue_events (AI calls, providers, verdicts, queues, spend).', cli: 'node ' + M + '/metrics/metrics_cli.js stats', web: 'run', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'stats'] },
    { id: 28, action: 'metrics_size', label: 'Usage data — size', desc: 'Row count + table size of the events table.', cli: 'node ' + M + '/metrics/metrics_cli.js size', web: 'run', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'size'] },
    { id: 29, action: 'metrics_purge_test', label: 'Purge TEST rows ($0 only, is_test=1)', desc: 'Delete deliberate $0 test-run rows. KEEPS test AI calls that cost money; real data untouched.', cli: 'node ' + M + '/metrics/metrics_cli.js purge-test --yes', web: 'run', klass: 'mutate', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'purge-test', '--yes'] },
    { id: 30, action: 'metrics_cleanup', label: 'Cleanup — purge old years', desc: 'Keep current + prior calendar year; delete older rows.', cli: 'node ' + M + '/metrics/metrics_cli.js cleanup --yes', web: 'run', klass: 'destruct', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'cleanup', '--yes'], confirm: true },
    { id: 31, action: 'metrics_purge_all', label: 'PURGE ALL (danger)', desc: 'Delete every analytics row for this app regardless of date.', cli: 'node ' + M + '/metrics/metrics_cli.js purge-all --yes', web: 'run', klass: 'destruct', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'purge-all', '--yes'], confirm: true },
    { id: 32, action: 'metrics_ask', label: 'AI ask — ask a question (read-only)', desc: 'Ask the usage data in plain English; prints the answer + the SQL it ran. Read-only guarded. Needs an AI key + DB.', cli: 'node ' + M + '/metrics/metrics_cli.js ask "<question>" [--model <id>]', web: 'form', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'ask'], params: [
      { name: 'question', label: 'Your question', type: 'text', required: true, positional: true, default: 'How many AI calls in the last 7 days?' },
      { name: 'model', label: 'Model id (blank = default)', type: 'text', required: false, flag: '--model' },
    ] },
    { id: 33, action: 'metrics_guard', label: 'AI ask — guard demo', desc: 'See the read-only SQL guard ACCEPT/REJECT example queries (no DB / no key needed).', cli: 'node ' + M + '/metrics/metrics_cli.js guard', web: 'run', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'guard'] },
  ] },
  { label: 'Server & users', color: 'BLUE', items: [
    { id: 34, action: 'server', label: 'Web app server', desc: 'The Email Queue UI + API are served by the platform, not a standalone 8019 server.', cli: 'node server_usat_apps_8022.js', web: 'terminal', klass: 'na', note: 'Served by the platform — server_usat_apps_8022.js (pm2 “usat_apps”). Start/stop it from the platform menu / pm2, not here.' },
    { id: 35, action: 'open_app', label: 'Open the web app', desc: 'Open the Email Queue operator page.', cli: 'open http://localhost:8022/salesforce/email-queue', web: 'terminal', klass: 'na', note: 'Open http://localhost:8022/salesforce/email-queue (or via the :8000 proxy).' },
    { id: 36, action: 'users', label: 'Users (add / list / reset / remove)', desc: 'Web app logins.', cli: '(platform Users & access · /admin/users)', web: 'terminal', klass: 'na', note: 'User accounts live in the platform Users & access panel (/admin/users) — add / list / reset password / remove there. The platform owns auth.' },
  ] },
];

const ALL = SECTIONS.reduce(function (a, s) { return a.concat(s.items); }, []);
function web_sections() { return SECTIONS; }

module.exports = { SECTIONS: SECTIONS, ALL: ALL, web_sections: web_sections };
