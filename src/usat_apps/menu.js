#!/usr/bin/env node
'use strict';
/**
 * menu.js — interactive launcher for the USAT Apps platform.
 *
 *   node src/usat_apps/menu.js
 *
 * DATA-ONLY: rendering, numbering (by position), the [t] CLI toggle, spawn (incl. launching the module
 * sub-menus — the kit closes/reopens readline so a child menu owns stdin), HTTP probes, and quit handling
 * all come from the shared kit. See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const { runMenu } = require('../../utilities/menu/menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8022;

const SECTIONS = [
  { label: 'RUN', color: 'YELLOW', items: [
    { label: 'Dev — API + web (hot reload)', desc: 'Backend + Vite together (concurrently); edits show live', bin: 'npm', args: ['run', 'usat_apps_dev_all'], cli: 'npm run usat_apps_dev_all' },
    { label: 'Dev — backend only (nodemon)', desc: 'Express API on :8022, auto-restarts on change', bin: 'npm', args: ['run', 'usat_apps_dev'], cli: 'npm run usat_apps_dev' },
    { label: 'Dev — web only (Vite)', desc: 'React UI on :5175, proxies /api to :8022', bin: 'npm', args: ['run', 'usat_apps_web'], cli: 'npm run usat_apps_web' },
    { label: 'Build the web app', desc: 'npm install + compile React to web/dist (served at :8022)', bin: 'npm', args: ['run', 'usat_apps_build'], cli: 'npm run usat_apps_build' },
    { label: 'Build for proxy (root base)', desc: 'Build with Vite base / for the :8000 proxy (served at usat-app root)', bin: 'npm', args: ['run', 'usat_apps_build_proxy'], cli: 'npm run usat_apps_build_proxy' },
    { label: 'Start built server (:8022)', desc: 'Express serves the built UI + API on one port', bin: 'npm', args: ['run', 'usat_apps_server'], cli: 'npm run usat_apps_server' },
    { label: 'Start proxy (:8000)', desc: 'Reverse proxy; serves the app at :8000/ (usat-app host)', bin: 'npm', args: ['run', 'proxy_server'], cli: 'npm run proxy_server' },
  ]},
  { label: 'TESTS — unit & scenario (fast, no DB)', color: 'CYAN', items: [
    { label: 'Run all tests', desc: 'Platform (auth, metrics, status) + all module suites — no DB', bin: 'npm', args: ['run', 'usat_apps_test'], cli: 'npm run usat_apps_test' },
    { label: 'Participation maps tests', desc: 'Just the participation_maps module (agg, unique) — no DB', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/participation_maps'], cli: 'node src/usat_apps/run_tests.js modules/participation_maps' },
    { label: 'Salesforce merge — all unit tests', desc: 'Every salesforce_merge suite (api, queue/worker, execute, restore, drift, UAT scenarios) — no DB. Superset of the Tier-1 run.', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/salesforce_merge'], cli: 'node src/usat_apps/run_tests.js modules/salesforce_merge' },
    { label: 'Salesforce merge — UAT scenarios (Tier 1)', desc: 'The UAT workbook tabs as backend scenario tests — survivorship, drift gate, selective restore, bulk, plus parallel fan-out, job-history aggregation, and the API/Apex caps + batch limits', bin: 'npm', args: ['run', 'salesforce_merge_uat'], cli: 'npm run salesforce_merge_uat' },
    { label: 'Salesforce merge — UAT + fill workbook', desc: 'Runs the Tier-1 scenarios AND stamps PASS/FAIL into a copy of the UAT workbook (all mapped tabs) in the data folder (usat_salesforce_merge_uat/)', bin: 'npm', args: ['run', 'salesforce_merge_uat_fill'], cli: 'npm run salesforce_merge_uat_fill' },
  ]},
  { label: 'TESTS — integration & browser (needs DB / worker / chromium)', color: 'CYAN', items: [
    { label: 'Salesforce merge — worker smoke test', desc: 'enqueue → claim → run → done → result parity. No UI / Salesforce / writes (~5s). Needs the DB.', bin: 'npm', args: ['run', 'salesforce_merge_worker_smoke'], cli: 'npm run salesforce_merge_worker_smoke' },
    { label: 'Salesforce merge — worker-down test', desc: 'Proves a merge stays QUEUED when :8021 is down and DRAINS when it returns. Stop the pm2 worker first (Salesforce merge sub-menu).', bin: 'npm', args: ['run', 'salesforce_merge_worker_down_test'], cli: 'npm run salesforce_merge_worker_down_test' },
    { label: 'E2E — platform UI (Playwright)', desc: 'Browser suite: platform shell + participation map. Isolated build/port/creds — never touches the real dist. One-time: npx playwright install chromium', bin: 'npm', args: ['run', 'usat_apps_e2e'], cli: 'npm run usat_apps_e2e' },
    { label: 'E2E — merge UAT UI (Playwright)', desc: 'Renders the Select / Process / Restore surfaces with stubbed APIs (needs: npx playwright install chromium)', bin: 'npm', args: ['run', 'salesforce_merge_e2e'], cli: 'npm run salesforce_merge_e2e' },
    { label: 'E2E — interactive runner', desc: 'The platform browser suite in Playwright --ui (watch, step through, time-travel).', bin: 'npm', args: ['run', 'usat_apps_e2e_ui'], cli: 'npm run usat_apps_e2e_ui' },
  ]},
  { label: 'USERS & ACCESS', color: 'CYAN', items: [
    { label: 'Add / update a user', desc: 'Create a web-app login (username/email, password, role)', bin: 'node', args: ['src/usat_apps/admin.js', 'add'], cli: 'node src/usat_apps/admin.js add' },
    { label: 'List users', desc: 'Show .env recovery + stored web-app logins', bin: 'node', args: ['src/usat_apps/admin.js', 'list'], cli: 'node src/usat_apps/admin.js list' },
    { label: 'Reset a user password', desc: 'Set a new password for an existing stored login', bin: 'node', args: ['src/usat_apps/admin.js', 'passwd'], cli: 'node src/usat_apps/admin.js passwd' },
    { label: 'Remove a user', desc: 'Delete a stored login (prompts + confirm)', bin: 'node', args: ['src/usat_apps/admin.js', 'remove'], cli: 'node src/usat_apps/admin.js remove' },
    { label: 'Show panel access', desc: 'Print the default + per-user panel allow-list + catalog', bin: 'node', args: ['src/usat_apps/admin.js', 'access'], cli: 'node src/usat_apps/admin.js access' },
  ]},
  { label: 'OPEN', color: 'GREEN', items: [
    { label: 'Open built UI', desc: 'Production-style single-port app at :8022', open: `http://localhost:${PORT}`, cli: `open http://localhost:${PORT}` },
    { label: 'Open dev UI', desc: 'Vite dev server (hot reload) at :5175', open: 'http://localhost:5175', cli: 'open http://localhost:5175' },
    { label: 'Open via proxy (/)', desc: 'The app through the proxy at :8000/', open: 'http://localhost:8000/', cli: 'open http://localhost:8000/' },
    { label: 'Check API status', desc: 'GET /api/status — backend health (public)', hit: { port: PORT, pathname: '/api/status' }, cli: `curl http://localhost:${PORT}/api/status` },
    { label: 'Check login / whoami', desc: 'GET /api/me — current user + role + panels. 401 here is normal — this tool has no browser session cookie; sign in at the UI first.', hit: { port: PORT, pathname: '/api/me' }, cli: `curl http://localhost:${PORT}/api/me` },
    { label: 'Show your modules', desc: 'GET /api/modules — the module catalog the nav is built from. 401 here is normal — needs a signed-in browser session.', hit: { port: PORT, pathname: '/api/modules' }, cli: `curl http://localhost:${PORT}/api/modules` },
  ]},
  { label: 'PM2 (production)', color: 'RED', items: [
    { label: 'pm2 start', desc: 'Run the server under pm2 (production)', bin: 'npm', args: ['run', 'pm2_start_usat_apps'], cli: 'npm run pm2_start_usat_apps' },
    { label: 'pm2 restart', desc: 'Restart the pm2 process', bin: 'npm', args: ['run', 'restart_usat_apps'], cli: 'npm run restart_usat_apps' },
    { label: 'pm2 stop', desc: 'Stop the pm2 process', bin: 'npm', args: ['run', 'stop_usat_apps'], cli: 'npm run stop_usat_apps' },
    { label: 'pm2 logs', desc: 'Tail the pm2 logs', bin: 'npm', args: ['run', 'pm2_logs_usat_apps'], cli: 'npm run pm2_logs_usat_apps' },
  ]},
  { label: 'MODULES', color: 'CYAN', items: [
    { label: 'Participation maps — data pipeline & ops →', desc: 'Rebuild region/zip/census/summary data, BigQuery load, build scope (opens the module menu)', bin: 'node', args: ['src/usat_apps/modules/participation_maps/menu.js'], cli: 'node src/usat_apps/modules/participation_maps/menu.js' },
    { label: 'Salesforce merge — worker & ops →', desc: 'Start/stop the :8021 write worker, DB migrations, status/opens (the merge tests all live on the main menu above)', bin: 'node', args: ['src/usat_apps/modules/salesforce_merge/menu.js'], cli: 'node src/usat_apps/modules/salesforce_merge/menu.js' },
    { label: 'Event COI — Race Certificate Request builder →', desc: 'Dev/build/open the Event COI page, run the module tests, and the Playwright dry run (login → fill, no submit). event_coi tests also run in "Run all tests" above.', bin: 'node', args: ['src/usat_apps/modules/event_coi/menu.js'], cli: 'node src/usat_apps/modules/event_coi/menu.js' },
    { label: 'Email Queue - dev & ops →', desc: 'Module/services tests, verify SF read, corrections DB smoke (folded into :8022)', bin: 'node', args: ['src/usat_apps/modules/salesforce_email_queue/menu.js'], cli: 'node src/usat_apps/modules/salesforce_email_queue/menu.js' },
    { label: 'AI Chat Bot - dev, tests & public widget probes →', desc: 'Shared-brain tests + live probes of the public widget endpoints (widget HTML, widget.js loader, POST /ask) on :5175 and :8022, plus the dedicated :8024 server.', bin: 'node', args: ['src/usat_apps/modules/chatbot/menu.js'], cli: 'node src/usat_apps/modules/chatbot/menu.js' },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'USAT Apps',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };
