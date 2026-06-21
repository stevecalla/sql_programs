'use strict';
/**
 * console_registry.js — the catalog of operations the /admin "Operations" panel can run.
 *
 * Modeled on src/race_results_transform/admin/console_registry.js. The transform shares this list with
 * its menu.js; in this POC menu.js predates the registry and keeps its own interactive prompts, so this
 * file is the source of truth for the WEB console specifically. It mirrors the same commands menu.js
 * exposes (tests, read-only Salesforce checks, AI assistant views, metrics/analytics, user management),
 * marking interactive/terminal-only ones so the browser greys them out instead of hanging on a prompt.
 *
 * Per item:
 *   id            sequential 1..N (guarded by tests/console.test.js)
 *   action        a stable key (matches menu.js action where applicable)
 *   label, desc   shown in the panel
 *   cli           the "$ ..." line shown under an item (display only)
 *   web           'run' (no input; spawn + stream) | 'form' (render `params`, then spawn) |
 *                 'terminal' (show but GREY OUT — interactive/needs a desktop; see `note`)
 *   klass         'read' | 'mutate' | 'destruct' | 'test' | 'na'  (web badge + confirm policy)
 *   bin           'node'  (the server always spawns with shell:false)
 *   argv          base args; validated params are appended server-side (see console_runner.assemble_argv)
 *   params        [ { name, label, type, ... } ] for web:'form'
 *   confirm       true => web requires a typed-confirm before running (destructive)
 *   note          why a 'terminal' item is greyed on the web
 *
 * Paths are relative to the POC root (console_runner runs with cwd = .../salesforce_email_queue_proof_of_concept).
 * Read-only except the explicit metrics purge/cleanup items. NO Salesforce writes anywhere.
 */

const SECTIONS = [
  { label: 'Tests (node, no browser)', color: 'MAGENTA', items: [
    { id: 1, action: 'test_all', label: 'Run ALL tests', desc: 'Runs every node --test suite (dependency-free, no browser), then a pass/fail summary.', cli: 'node --test tests/*.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/text_clean.test.js', 'tests/sf_threads.test.js', 'tests/extract.test.js', 'tests/ai.test.js', 'tests/faq_corrections.test.js', 'tests/auth.test.js', 'tests/metrics.test.js', 'tests/queue_access.test.js', 'tests/analytics.test.js', 'tests/ask.test.js', 'tests/admin_users.test.js', 'tests/lint_snake_case.test.js', 'tests/spam.test.js', 'tests/routes.test.js', 'tests/triage.test.js', 'tests/console.test.js'] },
    { id: 2, action: 'test_text', label: 'Text cleaning', desc: 'html_to_text + quoted-history stripping.', cli: 'node --test tests/text_clean.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/text_clean.test.js'] },
    { id: 3, action: 'test_threads', label: 'Thread reader', desc: 'get_thread ordering, automated flag, attachments (mock conn).', cli: 'node --test tests/sf_threads.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/sf_threads.test.js'] },
    { id: 4, action: 'test_extract', label: 'Attachment extraction', desc: 'text/csv/html + graceful binary fallback.', cli: 'node --test tests/extract.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/extract.test.js'] },
    { id: 5, action: 'test_ai', label: 'AI layer', desc: 'context assembly + verdict parsing (mock provider).', cli: 'node --test tests/ai.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/ai.test.js'] },
    { id: 6, action: 'test_faq', label: 'FAQ + corrections', desc: 'faq loader + corrections store/grounding.', cli: 'node --test tests/faq_corrections.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/faq_corrections.test.js'] },
    { id: 7, action: 'test_auth', label: 'Auth', desc: 'scrypt hashing + signed-cookie sessions.', cli: 'node --test tests/auth.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/auth.test.js'] },
    { id: 8, action: 'test_metrics', label: 'Metrics config + DDL', desc: 'metrics_config + events-table DDL contract.', cli: 'node --test tests/metrics.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/metrics.test.js'] },
    { id: 9, action: 'test_qa', label: 'Queue access', desc: 'allow-list default + per-user overrides + admin bypass.', cli: 'node --test tests/queue_access.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/queue_access.test.js'] },
    { id: 10, action: 'test_analytics', label: 'Analytics', desc: 'ingest whitelist/stamp + metrics report contract (fake pool).', cli: 'node --test tests/analytics.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/analytics.test.js'] },
    { id: 11, action: 'test_ask', label: 'Ask-your-data', desc: 'SQL guard (read-only) + ask() brain with injected provider/pool.', cli: 'node --test tests/ask.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/ask.test.js'] },
    { id: 12, action: 'test_admin_users', label: 'Admin users', desc: 'auth_store roles + .env recovery accounts (Access pane).', cli: 'node --test tests/admin_users.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/admin_users.test.js'] },
    { id: 13, action: 'test_lint', label: 'Lint — snake_case', desc: 'Fail if any of our identifiers are camelCase (DOM/library names + element ids allowed).', cli: 'node --test tests/lint_snake_case.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/lint_snake_case.test.js'] },
    { id: 14, action: 'test_spam', label: 'Spam heuristic', desc: 'Conservative local spam signals + classify_local wiring.', cli: 'node --test tests/spam.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/spam.test.js'] },
    { id: 15, action: 'test_routes', label: 'Routes (API)', desc: 'JSON API contract incl. /api/me, admin config, ai/models (in-memory).', cli: 'node --test tests/routes.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/routes.test.js'] },
    { id: 16, action: 'e2e', label: 'Web E2E (Playwright)', desc: 'Browser tests of the web UI (stubs the API). One-time: npx playwright install chromium.', cli: 'npx playwright test -c e2e/playwright.config.js', web: 'terminal', klass: 'test', note: 'Opens a real browser — run it from a terminal with a desktop session, not from /admin.' }
  ] },
  { label: 'Salesforce (read-only)', color: 'CYAN', items: [
    { id: 17, action: 'verify_prod', label: 'Verify SF access — PRODUCTION', desc: 'Connectivity + field access + Coaching queue preview (SF_PROD_*). Read-only.', cli: 'node verify_sf_access.js prod', web: 'run', klass: 'read', bin: 'node', argv: ['verify_sf_access.js', 'prod'] },
    { id: 18, action: 'verify_sandbox', label: 'Verify SF access — SANDBOX', desc: 'Same checks against the dev org (SF_DEV_*, test.salesforce.com). Read-only.', cli: 'node verify_sf_access.js sandbox', web: 'run', klass: 'read', bin: 'node', argv: ['verify_sf_access.js', 'sandbox'] },
    { id: 19, action: 'list_queues', label: 'List queues', desc: 'All Salesforce queues + open-case counts.', cli: 'node src/cli.js queues', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'queues'] },
    { id: 20, action: 'list_statuses', label: 'List case statuses', desc: 'The real Case Status picklist values in this org.', cli: 'node src/cli.js statuses', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'statuses'] }
  ] },
  { label: 'AI assistant (read-only)', color: 'GREEN', items: [
    { id: 21, action: 'assist', label: 'Browse & assist (guided)', desc: 'Interactive: queue → status → email → draft/ask/correct. Nothing is sent.', cli: 'node src/cli.js assist', web: 'terminal', klass: 'na', note: 'Interactive (guided prompts) — run it from a terminal: node src/cli.js assist.' },
    { id: 22, action: 'view_corrections', label: 'View corrections', desc: 'Operator corrections currently grounding the AI.', cli: 'node src/cli.js corrections', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'corrections'] },
    { id: 23, action: 'view_context', label: 'View context files', desc: 'Reference files the AI reads from data/context/ (md, csv, pdf, docx, xlsx).', cli: 'node src/cli.js context', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'context'] }
  ] },
  { label: 'Metrics & analytics', color: 'CYAN', items: [
    { id: 24, action: 'metrics_stats', label: 'Usage stats (last 7 days)', desc: 'Text usage report (AI calls, providers, verdicts, queues, spend).', cli: 'node metrics/metrics_cli.js stats', web: 'run', klass: 'read', bin: 'node', argv: ['metrics/metrics_cli.js', 'stats'] },
    { id: 25, action: 'metrics_size', label: 'Usage data — size', desc: 'Row count + size + by-year breakdown of the events table.', cli: 'node metrics/metrics_cli.js size', web: 'run', klass: 'read', bin: 'node', argv: ['metrics/metrics_cli.js', 'size'] },
    { id: 26, action: 'metrics_purge_test', label: 'Purge TEST rows ($0 only, is_test=1)', desc: 'Delete deliberate $0 test-run rows. KEEPS test AI calls that cost money; real + demo untouched.', cli: 'node metrics/metrics_cli.js purge-test', web: 'run', klass: 'mutate', bin: 'node', argv: ['metrics/metrics_cli.js', 'purge-test', '--yes'] },
    { id: 27, action: 'metrics_cleanup', label: 'Cleanup — purge old years', desc: 'Keep current + prior calendar year; delete older rows.', cli: 'node metrics/metrics_cli.js cleanup', web: 'run', klass: 'destruct', bin: 'node', argv: ['metrics/metrics_cli.js', 'cleanup', '--yes'], confirm: true },
    { id: 28, action: 'metrics_purge_all', label: 'PURGE ALL (danger)', desc: 'Delete every analytics row regardless of date.', cli: 'node metrics/metrics_cli.js purge-all', web: 'run', klass: 'destruct', bin: 'node', argv: ['metrics/metrics_cli.js', 'purge-all', '--yes'], confirm: true },
    { id: 29, action: 'metrics_ask', label: 'AI ask — ask a question (read-only)', desc: 'Ask the usage data in plain English; prints the answer + the SQL it ran. Read-only guarded.', cli: 'node metrics/metrics_cli.js ask "<question>" [--provider openai|claude]', web: 'form', klass: 'read', bin: 'node', argv: ['metrics/metrics_cli.js', 'ask'], params: [{ name: 'question', label: 'Your question', type: 'text', required: true, positional: true, default: 'How many AI calls in the last 7 days?' }, { name: 'provider', label: 'Model', type: 'enum', required: false, default: 'default', options: [{ value: 'default', label: 'Default', args: [] }, { value: 'openai', label: 'OpenAI', args: ['--provider', 'openai'] }, { value: 'claude', label: 'Claude', args: ['--provider', 'claude'] }] }] },
    { id: 30, action: 'metrics_guard', label: 'AI ask — guard demo', desc: 'See the read-only SQL guard ACCEPT/REJECT example queries (no DB needed).', cli: 'node metrics/metrics_cli.js guard', web: 'run', klass: 'read', bin: 'node', argv: ['metrics/metrics_cli.js', 'guard'] }
  ] },
  { label: 'Server & users', color: 'BLUE', items: [
    { id: 31, action: 'server', label: 'Start the web app server (port 8019)', desc: 'Express server + SPA + /metrics + /admin. Ctrl-C to stop.', cli: 'node ../../server_salesforce_email_queue_8019.js', web: 'terminal', klass: 'na', note: 'This IS the running server you are talking to — start/stop it from the box (or via pm2).' },
    { id: 32, action: 'open_app', label: 'Open the web app in a browser', desc: 'Open http://localhost:8019 (start the server first).', cli: 'open http://localhost:8019', web: 'terminal', klass: 'na', note: 'Opens a browser on the server desktop — not meaningful from a remote /admin session.' },
    { id: 33, action: 'add_user', label: 'Add / update a user', desc: 'Create a web app login (username + password).', cli: 'node src/admin.js add', web: 'terminal', klass: 'na', note: 'Interactive (prompts for username + password) — use the Access pane above, or run node src/admin.js add.' },
    { id: 34, action: 'list_users', label: 'List users', desc: 'Show web app logins (no secrets).', cli: 'node src/admin.js list', web: 'run', klass: 'read', bin: 'node', argv: ['src/admin.js', 'list'] },
    { id: 35, action: 'reset_pw', label: 'Reset a user password', desc: 'Set a new password for an existing login.', cli: 'node src/admin.js passwd', web: 'terminal', klass: 'na', note: 'Interactive — use the Access pane (reset pw), or run node src/admin.js passwd.' },
    { id: 36, action: 'remove_user', label: 'Remove a user', desc: 'Delete a web app login.', cli: 'node src/admin.js remove', web: 'terminal', klass: 'na', note: 'Interactive — use the Access pane (remove), or run node src/admin.js remove.' }
  ] }
];

const ALL = SECTIONS.reduce(function (acc, s) { return acc.concat(s.items); }, []);
function by_id(id) { return ALL.find(function (it) { return String(it.id) === String(id); }) || null; }

// Web-console sections (everything here is web-eligible; terminal items are shown greyed by the panel).
function web_sections() {
  return SECTIONS
    .map(function (s) { return { label: s.label, items: s.items.slice() }; })
    .filter(function (s) { return s.items.length; });
}

module.exports = { SECTIONS: SECTIONS, ALL: ALL, by_id: by_id, web_sections: web_sections };
