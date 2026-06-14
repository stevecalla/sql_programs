'use strict';
/**
 * console_registry.js — the single source of truth for the operations catalog.
 *
 * Both menu.js (the terminal launcher) and the /admin "Operations" panel read this list, so a command
 * added here shows up in BOTH and they can never drift. menu.js keeps its own rich interactive prompts
 * (handle()); this registry supplies the catalog (ids/sections/labels/descriptions/the shown "$ ..." line)
 * AND a declarative description of how the web console runs each one.
 *
 * Per item:
 *   id            sequential 1..N (guarded by tests/menu_ids.test.js)
 *   action        the menu.js handler key (terminal behavior)
 *   label, desc   shown in both surfaces
 *   cli           the "$ ..." line shown under an item (display only)
 *   web           how /admin treats it:
 *                   'run'      — no input; spawn + stream
 *                   'form'     — render `params` as inputs, then spawn
 *                   'terminal' — show but GREY OUT on web (see `note`); can't/shouldn't run in a browser
 *                   'menu'     — terminal-only control (not shown on web at all)
 *   klass         'read' | 'mutate' | 'destruct' | 'test' | 'na'  (web badge + confirm policy)
 *   bin           'node' | 'npm'  (executable; the server always spawns with shell:false)
 *   argv          base args; validated params are appended to this server-side
 *   params        [ { name, label, type, ... } ] for web:'form' (see assemble_argv below)
 *   expand        server-side argv expansion hint (e.g. 'tests' => append the sorted tests/*.test.js list)
 *   confirm       true => web requires a typed-confirm before running (destructive)
 *   note          why a 'terminal' item is greyed on the web
 *
 * Param shapes (for web:'form'):
 *   { name, label, type:'enum', required?, default?, options:[ { value, label, args:[...] } ] }
 *      -> appends the chosen option's `args` (so prod => [], sandbox => ['--test'])
 *   { name, label, type:'text'|'int'|'date'|'sql'|'path', required?, default?, flag?, positional? }
 *      -> positional:true appends just the value; else appends [flag, value] when a value is given
 *
 * snake_case everywhere (this file isn't auto-linted, but the project convention still applies).
 */

const SECTIONS = [
  { label: 'Convert', color: 'CYAN', items: [
    { id: 1, action: 'convert', label: 'Convert a file', desc: 'Reformat one .xlsx or .csv to the USAT template; prints a scorecard.', cli: 'node src/cli.js convert <file> [-o out.xlsx]', web: 'terminal', klass: 'na', note: 'Needs a local file path — use the converter at / to upload and convert in the browser.' },
    { id: 2, action: 'batch', label: 'Batch-convert a folder', desc: 'Reformat every .xlsx/.csv in a folder.', cli: 'node src/cli.js batch <folder> [-o outdir]', web: 'terminal', klass: 'na', note: 'Needs a local folder path — use the From Folder intake tab at /.' },
    { id: 3, action: 'examples', label: 'Convert everything in data/inputs', desc: 'Reformat every file in your (gitignored) data/inputs folder into data/outputs.', cli: 'node src/cli.js batch data/inputs -o data/outputs', web: 'terminal', klass: 'na', note: 'Operates on the local (gitignored) data/inputs folder on the server box.' }
  ] },
  { label: 'Inspect', color: 'BLUE', items: [
    { id: 4, action: 'inspect', label: 'Inspect headers + auto-mapping', desc: 'Show detected headers and how each maps to the template; no file written.', cli: 'node src/cli.js inspect <file>', web: 'terminal', klass: 'na', note: 'Needs a local file path — use the converter at /.' }
  ] },
  { label: 'Tests — engine & UI (node, no browser)', color: 'MAGENTA', items: [
    { id: 5, action: 'test_all', label: 'Run ALL engine/UI tests', desc: 'Runs every node --test suite (dependency-free, no browser). Browser tests are in the next section.', cli: 'node --test tests/*.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test'], expand: 'tests' },
    { id: 6, action: 'test_config', label: 'Config wiring (package + tasks)', desc: 'repo-root package.json scripts + .vscode/tasks.json register this tool (step 16/16) like the other servers.', cli: 'node --test tests/config_wiring.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/config_wiring.test.js'] },
    { id: 7, action: 'test_display', label: 'Table display format', desc: 'Excel times render as times (not dates) · DOB as mm/dd/yyyy · long member #s intact — on real files.', cli: 'node --test tests/display.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/display.test.js'] },
    { id: 8, action: 'test_fixtures', label: 'Golden fixtures (real files)', desc: 'Convert the 2 xlsx + 2 csv examples and compare to the checked-in expected snapshots.', cli: 'node --test tests/fixtures.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/fixtures.test.js'] },
    { id: 9, action: 'test_io', label: 'Excel / CSV I/O round-trip', desc: 'Write an .xlsx and read it back; member numbers stay text (no scientific notation).', cli: 'node --test tests/io.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/io.test.js'] },
    { id: 10, action: 'test_lint', label: 'Lint — snake_case', desc: 'Fail if any of our identifiers are camelCase (DOM/library names + UPPER_SNAKE constants + element ids are allowed).', cli: 'node --test tests/lint_snake_case.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/lint_snake_case.test.js'] },
    { id: 11, action: 'test_match', label: 'Column matching', desc: 'Finish time beats splits · "Age Group" beats "Race / Division" · name-order independence.', cli: 'node --test tests/match.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/match.test.js'] },
    { id: 12, action: 'test_normalize', label: 'Value normalization', desc: 'Gender→M/F/NB · DOB→mm/dd/yyyy · times incl. DNS/DNF · state abbrev · member→1-day · category buckets.', cli: 'node --test tests/normalize.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/normalize.test.js'] },
    { id: 13, action: 'test_reconcile', label: 'Integrity & reconciliation', desc: 'Row counts tie out · dividers skipped · column ledger · Name/Email/Zip preserved · always 12-col output.', cli: 'node --test tests/reconcile.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/reconcile.test.js'] },
    { id: 14, action: 'test_smoke', label: 'Smoke — modules load', desc: 'Each engine module parses + exports; schema has all 12 columns in order.', cli: 'node --test tests/smoke.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/smoke.test.js'] }
  ] },
  { label: 'Tests — browser (Playwright)', color: 'MAGENTA', items: [
    { id: 15, action: 'e2e_install', label: 'Install browser E2E (one-time)', desc: 'Dev: npm run e2e:install (axe-core + chromium/firefox/webkit). Linux server: npm run e2e:install:server (adds --with-deps; root).', cli: 'npm run e2e:install', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'e2e:install'] },
    { id: 16, action: 'e2e_run', label: 'Run ALL browser tests', desc: 'Real-browser convert/download/split/combine + UI/a11y/visual/mobile across chromium/firefox/webkit. Run the Install item once first.', cli: 'npm run e2e', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'e2e'] },
    { id: 17, action: 'e2e_chromium', label: 'Browser E2E — chromium only (fast)', desc: 'Runs the suite on just chromium, skipping firefox/webkit/mobile projects.', cli: 'npm run e2e:chromium', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'e2e:chromium'] },
    { id: 18, action: 'e2e_db', label: 'Browser E2E — analytics DB round-trip (chromium)', desc: 'Drives the app, then checks MySQL received the events and the table schema exists. Skips if no DB.', cli: 'npm run e2e:db', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'e2e:db'] },
    { id: 19, action: 'e2e_headed', label: 'Browser E2E — watch in Chrome (headed)', desc: 'Same tests in a visible, slowed Chrome window so you can watch. Desktop only (not the headless server).', cli: 'npm run e2e:headed', web: 'terminal', klass: 'test', note: 'Opens a visible Chrome window — needs a desktop session on the box, so it can only run from the terminal.' },
    { id: 20, action: 'e2e_step', label: 'Browser E2E — step through (pause each step)', desc: 'Headed Chrome that PAUSES on every step via the Playwright Inspector; click Resume to advance one step at a time. Desktop only.', cli: 'npm run e2e:step', web: 'terminal', klass: 'test', note: 'Opens the Playwright Inspector window — needs a desktop session, terminal-only.' },
    { id: 21, action: 'e2e_snap', label: 'Refresh visual snapshot baselines', desc: 'Regenerate the committed screenshot baselines (e2e/visual.spec.js-snapshots). Run after intended UI changes.', cli: 'npm run e2e:snap', web: 'run', klass: 'test', bin: 'npm', argv: ['run', 'e2e:snap'] }
  ] },
  { label: 'Server & app', color: 'GREEN', items: [
    { id: 22, action: 'server', label: 'Start the web app server (port 8018)', desc: 'Serve public/ at http://localhost:8018; also opens a public ngrok URL if NGROK_AUTHTOKEN is set (otherwise it just notes that and keeps running). Ctrl-C to stop.', cli: 'node ../../server_race_results_transform_8018.js', web: 'terminal', klass: 'na', note: 'This IS the running server you are talking to — start/stop it from the box (or via pm2).' },
    { id: 23, action: 'open', label: 'Open the web app in a browser', desc: 'Open http://localhost:8018 (start the server first).', cli: 'open http://localhost:8018', web: 'terminal', klass: 'na', note: 'Opens a browser on the server desktop — not meaningful from a remote /admin session.' }
  ] },
  { label: 'Usage analytics', color: 'CYAN', items: [
    { id: 24, action: 'metrics_stats', label: 'Usage stats (last 7 days)', desc: 'Print the usage summary (same as the Slack digest): visits, new/repeat, uploads, conversions, downloads by mode, completion, auto-map accuracy, top files.', cli: 'node src/cli.js stats', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'stats'] },
    { id: 25, action: 'metrics_size', label: 'Usage data — size', desc: 'Events table size (MB), row count, date range, and rows per year.', cli: 'node src/cli.js metrics:size', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'metrics:size'] },
    { id: 26, action: 'metrics_cleanup', label: 'Usage data — cleanup (purge old years)', desc: 'Keep current + prior calendar year; preview, confirm, then purge older rows.', cli: 'node src/cli.js metrics:cleanup', web: 'run', klass: 'destruct', bin: 'node', argv: ['src/cli.js', 'metrics:cleanup', '--yes'], confirm: true },
    { id: 27, action: 'metrics_purge_test', label: 'Usage data — purge TEST rows only (is_test=1)', desc: 'Delete only deliberate test-run rows (browser opened with ?metrics_test=1). Real + demo data is untouched.', cli: 'node src/cli.js metrics:purge-test', web: 'run', klass: 'mutate', bin: 'node', argv: ['src/cli.js', 'metrics:purge-test', '--yes'] },
    { id: 28, action: 'metrics_purge_all', label: 'Usage data — PURGE ALL (danger)', desc: 'Delete every analytics row regardless of date (asks to confirm). For clearing test data.', cli: 'node src/cli.js metrics:purge-all', web: 'form', klass: 'destruct', bin: 'node', argv: ['src/cli.js', 'metrics:purge-all', '--yes'], confirm: true }
  ] },
  { label: 'AI — ask your data', color: 'CYAN', items: [
    { id: 29, action: 'ask_question', label: 'AI ask — ask a question (read-only)', desc: 'Ask the usage data in plain English; choose OpenAI or Claude. Read-only; prints the answer + the SQL it ran.', cli: 'node src/cli.js ask "<question>" [--provider openai|claude]', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask'], params: [{ name: 'question', label: 'Your question', type: 'text', required: true, positional: true, default: 'How many people used the converter last week?' }, { name: 'provider', label: 'Model', type: 'enum', required: false, default: 'openai', options: [{ value: 'openai', label: 'OpenAI', args: ['--provider', 'openai'] }, { value: 'claude', label: 'Claude', args: ['--provider', 'claude'] }] }] },
    { id: 30, action: 'ask_demo', label: 'AI ask — guard demo (try a query)', desc: 'See the read-only guard ACCEPT/REJECT example queries or your own SQL, with the enforced LIMIT.', cli: 'node metrics/ask/demo_guard.js ["<sql>"]', web: 'form', klass: 'read', bin: 'node', argv: ['metrics/ask/demo_guard.js', '--no-header'], params: [{ name: 'sql', label: 'SQL to test (blank = run examples)', type: 'sql', required: false, positional: true }] },
    { id: 31, action: 'test_ask', label: 'AI ask — guard & catalog tests', desc: 'Read-only SQL guard + ask catalog tests. Also runs inside Run ALL.', cli: 'node --test tests/ask_db.test.js tests/ask_guard.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/ask_db.test.js', 'tests/ask_guard.test.js'] },
    { id: 32, action: 'ask_log', label: 'AI ask — view question log', desc: 'Recent AI questions + answers (audit log; no PII).', cli: 'node src/cli.js ask:log [--n 20]', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:log'] },
    { id: 33, action: 'ask_sql', label: 'AI ask — run SQL directly (read-only)', desc: 'Run a read-only SELECT yourself (guarded: SELECT-only, allowlisted table, enforced LIMIT). No AI involved.', cli: 'node src/cli.js ask:sql "<SELECT ...>"', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:sql'], params: [{ name: 'sql', label: 'Read-only SQL (SELECT only)', type: 'sql', required: true, positional: true }] },
    { id: 34, action: 'ask_corrections', label: 'AI ask — view/manage corrections', desc: 'Operator clarifications the AI uses as grounding (G2). Deactivate with: node src/cli.js ask:uncorrect <id>.', cli: 'node src/cli.js ask:corrections [--n 20] [--all]', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:corrections'] },
    { id: 35, action: 'ask_test_corrections', label: 'AI ask — test corrections (guided)', desc: 'Step-by-step process to confirm a saved correction is incorporated into the next answer (G2).', cli: 'node src/cli.js ask:test:corrections', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:test:corrections'] },
    { id: 36, action: 'ask_test_threads', label: 'AI ask — test follow-up thread (guided)', desc: 'Step-by-step process to confirm follow-up questions keep conversational context (B1).', cli: 'node src/cli.js ask:test:threads', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:test:threads'] },
    { id: 37, action: 'ask_eval', label: 'AI ask — run eval scenarios (records report)', desc: 'Runs the review scenarios against the live model (needs API key + DB) and writes a recorded report.', cli: 'node src/cli.js ask:eval', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:eval'] }
  ] },
  { label: 'Try Me (sample data)', color: 'GREEN', items: [
    { id: 38, action: 'test_try_me', label: 'Try Me — UI + is_demo wiring tests', desc: 'node test: the Try-me dropdown markup + the is_demo column wired across DDL, server whitelist, and browser allow-list.', cli: 'node --test tests/try_me.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/try_me.test.js'] },
    { id: 39, action: 'test_metrics_report', label: 'Try Me — metrics report tests (demo split)', desc: 'node test: the is_demo split query + demo_split shape, plus Last-User-Activity MTN / dashboard_view exclusion.', cli: 'node --test tests/metrics_report.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/metrics_report.test.js'] },
    { id: 40, action: 'metrics_demo_split', label: 'Try Me vs real — counts (read-only SQL)', desc: 'Show demo (Try Me) vs real uploads/conversions/downloads straight from the events table.', cli: 'node src/cli.js ask:sql "SELECT … GROUP BY kind"', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'ask:sql', "SELECT CASE WHEN is_demo=1 THEN 'Try Me' ELSE 'Real' END kind, SUM(event_name='file_uploaded') uploads, SUM(event_name='conversion_completed') conversions, SUM(event_name IN ('download','split_download_used')) downloads FROM race_results_transform_events GROUP BY kind"] }
  ] },
  { label: 'Salesforce (pull race-results files)', color: 'BLUE', items: [
    { id: 41, action: 'sf_list', label: 'Salesforce — list files (today, MT)', desc: 'List Race Results Doc files modified today (Mountain Time). Needs SF_* env vars in .env.', cli: 'node src/cli.js sf:list --today', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'sf:list', '--today'] },
    { id: 42, action: 'sf_list_recent', label: 'Salesforce — list recent files (precise or broad, prod or test)', desc: 'List recent files newest-first. Prompts: environment (prod/sandbox), search (precise term or broadened OR terms), and how many — so you can compare recall.', cli: 'node src/cli.js sf:list [--test] [--search "..."] --limit N', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'sf:list'], params: [{ name: 'env', label: 'Environment', type: 'enum', default: 'prod', options: [{ value: 'prod', label: 'Production', args: [] }, { value: 'test', label: 'Test sandbox', args: ['--test'] }] }, { name: 'search', label: 'Search', type: 'enum', default: 'precise', options: [{ value: 'precise', label: 'Precise (Race Results Doc)', args: [] }, { value: 'broad', label: 'Broad (OR terms)', args: ['--search', 'Race Results Doc,Race Results,Race,Results'] }] }, { name: 'limit', label: 'How many', type: 'int', default: '25', flag: '--limit' }] },
    { id: 43, action: 'sf_pull', label: 'Salesforce — pull files to a folder', desc: 'Download Race Results Doc files (snake_case names) into a folder. Prompts for date + folder + strategy.', cli: 'node src/cli.js sf:pull <opts> -o <dir>', web: 'form', klass: 'mutate', bin: 'node', argv: ['src/cli.js', 'sf:pull'], params: [{ name: 'env', label: 'Environment', type: 'enum', default: 'prod', options: [{ value: 'prod', label: 'Production', args: [] }, { value: 'test', label: 'Test sandbox', args: ['--test'] }] }, { name: 'when', label: 'Date', type: 'enum', default: 'today', options: [{ value: 'today', label: 'Today', args: ['--today'] }, { value: 'any', label: 'Any (latest)', args: [] }] }, { name: 'folder', label: 'Save to folder (server)', type: 'path', default: 'sf_race_result_downloads', flag: '-o' }, { name: 'strategy', label: 'If a file exists', type: 'enum', default: 'add_new', options: [{ value: 'add_new', label: 'Add new only', args: ['--strategy', 'add_new'] }, { value: 'replace', label: 'Overwrite same names', args: ['--strategy', 'replace'] }, { value: 'wipe_all', label: 'Delete all, then add', args: ['--strategy', 'wipe_all'] }] }] },
    { id: 44, action: 'sf_list_email', label: 'Salesforce — list EMAIL-queue files (prod or test)', desc: 'List Rankings email-queue race-results attachments. Prompts for environment, open-only/all status, and count.', cli: 'node src/cli.js sf:list-email [--all] [--test]', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'sf:list-email'], params: [{ name: 'env', label: 'Environment', type: 'enum', default: 'prod', options: [{ value: 'prod', label: 'Production', args: [] }, { value: 'test', label: 'Test sandbox', args: ['--test'] }] }, { name: 'status', label: 'Status', type: 'enum', default: 'not_closed', options: [{ value: 'not_closed', label: 'Is Not Closed', args: [] }, { value: 'closed', label: 'Is Closed', args: ['--status', 'closed'] }, { value: 'all', label: 'All', args: ['--status', 'all'] }] }, { name: 'limit', label: 'How many', type: 'int', default: '50', flag: '--limit' }] },
    { id: 45, action: 'sf_pull_email', label: 'Salesforce — pull EMAIL-queue files to a folder', desc: 'Download Rankings email-queue attachments (snake_case names). Prompts for environment, status, and folder.', cli: 'node src/cli.js sf:pull-email <opts> -o <dir>', web: 'form', klass: 'mutate', bin: 'node', argv: ['src/cli.js', 'sf:pull-email', '--strategy', 'add_new'], params: [{ name: 'env', label: 'Environment', type: 'enum', default: 'prod', options: [{ value: 'prod', label: 'Production', args: [] }, { value: 'test', label: 'Test sandbox', args: ['--test'] }] }, { name: 'status', label: 'Status', type: 'enum', default: 'open', options: [{ value: 'open', label: 'Open only', args: [] }, { value: 'all', label: 'All statuses', args: ['--all'] }] }, { name: 'folder', label: 'Save to folder (server)', type: 'path', default: 'sf_email_race_result_downloads', flag: '-o' }] }
  ] },
  { label: 'Slack (pull race-results files)', color: 'BLUE', items: [
    { id: 46, action: 'slack_probe', label: 'Slack — check connection (probe)', desc: 'Read-only: confirm SLACK_BOT_TOKEN works, show the bot identity, and list the channels it is in. Optionally probe one channel for files.', cli: 'node src/cli.js slack:probe [--channel <id|name>]', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'slack:probe'], params: [{ name: 'channel', label: 'Probe a channel (id or name; blank = just list)', type: 'text', required: false, flag: '--channel' }] },
    { id: 47, action: 'slack_channels', label: 'Slack — list the bot’s channels', desc: 'List the channels the bot is a member of (+ ids). Invite the bot to a channel in Slack and it shows up here.', cli: 'node src/cli.js slack:channels', web: 'run', klass: 'read', bin: 'node', argv: ['src/cli.js', 'slack:channels'] },
    { id: 48, action: 'slack_list', label: 'Slack — list files (date range)', desc: 'List spreadsheet attachments in a channel for a date range. Prompts for channel + date.', cli: 'node src/cli.js slack:list --channel <id|name> [date opts]', web: 'form', klass: 'read', bin: 'node', argv: ['src/cli.js', 'slack:list'], params: [{ name: 'channel', label: 'Channel (id or name; blank = default)', type: 'text', required: false, flag: '--channel' }, { name: 'when', label: 'Date', type: 'enum', default: 'any', options: [{ value: 'any', label: 'Any (latest)', args: [] }, { value: 'today', label: 'Today', args: ['--today'] }] }] },
    { id: 49, action: 'slack_pull', label: 'Slack — pull files to a folder', desc: 'Download a channel’s spreadsheet attachments (snake_case names) into a folder. Prompts for channel + date + folder + strategy.', cli: 'node src/cli.js slack:pull <opts> -o <dir>', web: 'form', klass: 'mutate', bin: 'node', argv: ['src/cli.js', 'slack:pull', '--strategy', 'add_new'], params: [{ name: 'channel', label: 'Channel (id or name)', type: 'text', required: false, flag: '--channel' }, { name: 'when', label: 'Date', type: 'enum', default: 'any', options: [{ value: 'any', label: 'Any (latest)', args: [] }, { value: 'today', label: 'Today', args: ['--today'] }] }, { name: 'folder', label: 'Save to folder (server)', type: 'path', default: 'slack_race_result_downloads', flag: '-o' }] },
    { id: 50, action: 'slack_tests', label: 'Slack — run Slack tests', desc: 'Run the Slack engine + UI unit tests (mock client, no network).', cli: 'node --test tests/slack_*.test.js', web: 'run', klass: 'test', bin: 'node', argv: ['--test', 'tests/slack_dates.test.js', 'tests/slack_client.test.js', 'tests/slack_ui.test.js'] },
    { id: 51, action: 'slack_howto', label: 'Slack — setup & how-to (future self)', desc: 'Print the runbook: app scopes, getting the bot token into .env, and the self-service /invite channel flow.', cli: '(printed in the menu)', web: 'terminal', klass: 'na', note: 'Reference text only — see the Reference panel (it carries the same Slack setup runbook).' }
  ] },
  { label: 'Usage analytics — maintenance', color: 'CYAN', items: [
    { id: 52, action: 'metrics_backfill_source', label: 'Backfill source: salesforce → sf_upload_queue', desc: 'One-time, idempotent relabel of legacy source=salesforce rows (the SF Email Queue is new, so all prior salesforce activity was the upload queue). Dry-run → confirm.', cli: 'node src/cli.js metrics:backfill-source', web: 'run', klass: 'mutate', bin: 'node', argv: ['src/cli.js', 'metrics:backfill-source', '--yes'] }
  ] },
  { label: 'Settings', color: 'GRAY', items: [
    { id: 53, action: 'toggle', label: 'Show/hide CLI commands', desc: 'Toggle a dimmed "$ ..." line under each item. Persists in .menu_prefs.json.', cli: '', web: 'menu', klass: 'na' },
    { id: 54, action: 'quit', label: 'Quit', desc: 'Exit the menu.', cli: '', web: 'menu', klass: 'na' }
  ] }
];

const ALL = SECTIONS.flatMap(function (s) { return s.items; });
function by_id(id) { return ALL.find(function (it) { return String(it.id) === String(id); }) || null; }

// Web-console items only (exclude terminal-only 'menu' controls). Used by /admin.
function web_sections() {
  return SECTIONS
    .map(function (s) { return { label: s.label, items: s.items.filter(function (it) { return it.web !== 'menu'; }) }; })
    .filter(function (s) { return s.items.length; });
}

module.exports = { SECTIONS, ALL, by_id, web_sections };
