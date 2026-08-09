#!/usr/bin/env node
'use strict';
/**
 * menu.js — event_coi module operations (Event / Race Certificate Request builder).
 *
 *   node src/usat_apps/modules/event_coi/menu.js
 *
 * The React UI is served by usat_apps (:8022). THIS module's backend — the event_coi API — runs on the
 * dedicated server_event_coi_8023.js. Launched from the platform menu (src/usat_apps/menu.js), or directly.
 *
 * DATA-ONLY: rendering, numbering (by position), the CLI toggle, spawn, HTTP, and quit handling all come
 * from the shared kit. See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const { runMenu } = require('../../../../utilities/menu/menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const API_PORT = 8023;                       // THIS module's dedicated backend (event_coi API)
const WEB_PORT = 8022;                       // usat_apps serves the React UI + proxies /api/event-coi -> :8023
const PAGE = '/events/insurance-coi';        // this module's route on the web tier
const COI_HINT = `COI backend not reachable on :${API_PORT} — is it running? (start item 2)`;

const SECTIONS = [
  { label: 'RUN — COI backend (:8023)', color: 'YELLOW', items: [
    { label: 'COI backend — dev (hot reload, :8023)', desc: 'nodemon server_event_coi_8023.js — the event_coi API. Restarts on edits. This is what this module owns; the UI (:8022) is started from the usat_apps menu.', bin: 'npm', args: ['run', 'event_coi_dev'], cli: 'npm run event_coi_dev' },
    { label: 'COI backend — start (:8023)', desc: 'node server_event_coi_8023.js — run the COI backend once (no auto-restart).', bin: 'npm', args: ['run', 'event_coi_server'], cli: 'npm run event_coi_server' },
    { label: 'Deploy COI backend (pm2 :8023)', desc: 'npm run event_coi_deploy — (re)start the pm2 usat_event_coi process + reload the proxy. Use after pulling on the server.', bin: 'npm', args: ['run', 'event_coi_deploy'], cli: 'npm run event_coi_deploy' },
    { label: 'Web UI — Vite dev (:5175, serves the page)', desc: 'npm run usat_apps_web — the React page lives on the web tier and proxies /api/event-coi -> :8023. Run this AND the dev backend to use the page locally. (Full web build/serve lives in the usat_apps menu.)', bin: 'npm', args: ['run', 'usat_apps_web'], cli: 'npm run usat_apps_web' },
  ]},
  { label: 'OPEN / STATUS', color: 'CYAN', items: [
    { label: 'Open the Event COI page', desc: `Opens http://127.0.0.1:${WEB_PORT}${PAGE} (web tier; needs the :8023 backend up too)`, open: `http://127.0.0.1:${WEB_PORT}${PAGE}` },
    { label: 'COI backend health (:8023)', desc: 'GET /api/event-coi/health on :8023 — public; reports the concurrency snapshot. Confirms the dedicated backend is up.', hit: { port: API_PORT, pathname: '/api/event-coi/health', hint: COI_HINT } },
    { label: 'Module ping (:8023, needs sign-in)', desc: 'GET /api/event-coi/ping on :8023 — confirms the module is mounted + your panel access.', hit: { port: API_PORT, pathname: '/api/event-coi/ping', hint: COI_HINT } },
  ]},
  { label: 'TESTS', color: 'CYAN', items: [
    { label: 'Run module tests', desc: 'node src/usat_apps/run_tests.js modules/event_coi (holder_parse + validate_request)', bin: 'node', args: ['src/usat_apps/run_tests.js', 'modules/event_coi'], cli: 'node src/usat_apps/run_tests.js modules/event_coi' },
  ]},
  { label: 'RUNNER — Playwright (Phase 3)', color: 'RED', items: [
    { label: 'Portal dry run (login + fill, NO submit)', desc: 'Headless. Logs in, opens the form, fills one test holder, screenshots each stage to dry_run_screens/ — nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/run_dry.js'], cli: 'node src/usat_apps/modules/event_coi/run_dry.js' },
    { label: 'Portal dry run — WATCH (visible browser)', desc: 'Same as the headless dry run but HEADED: opens a visible Chromium so you can watch login → open form → fill happen live. Still NO submit. Leaves the browser open at the end for you to inspect.', bin: 'node', args: ['src/usat_apps/modules/event_coi/run_dry.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/run_dry.js' },
  ]},
  { label: 'STRESS — concurrency (NO submit)', color: 'RED', items: [
    { label: 'Concurrency stress test (headless)', desc: 'Spins up N real Playwright runs at once (login → open form → fill → screenshot), skipping the Submit click. Prompts for count + holders. Reports per-run timing, peak concurrent browsers, and total wall time. Cap = EVENT_COI_MAX_CONCURRENT.', bin: 'node', args: ['src/usat_apps/modules/event_coi/stress_test.js'], cli: 'node src/usat_apps/modules/event_coi/stress_test.js' },
    { label: 'Concurrency stress test — WATCH', desc: 'Same as the headless stress test but HEADED: opens N visible Chromium windows so you can watch them run in parallel. Still NO submit. Use a small count.', bin: 'node', args: ['src/usat_apps/modules/event_coi/stress_test.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/stress_test.js' },
  ]},
  { label: 'SUBMIT CHECK - verify the submit button (NO submit)', color: 'RED', items: [
    { label: 'Submit-button check - WATCH', desc: 'Headed: logs in, fills the form, and INSPECTS the Submit button + form + anti-forgery token WITHOUT clicking Submit. Confirms the runner targets the real button and the form is POST-ready. Nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/submit_check.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/submit_check.js' },
    { label: 'Submit-button check - headless', desc: 'Same as the WATCH submit-button check but headless; prints the report to the console. Nothing is submitted.', bin: 'node', args: ['src/usat_apps/modules/event_coi/submit_check.js'], cli: 'node src/usat_apps/modules/event_coi/submit_check.js' },
    { label: 'Pending Requests check - WATCH', desc: 'Headed, read-only: logs in and opens the portal Pending Requests queue, screenshots it, and lists the rows. Never opens the certificate form or submits.', bin: 'node', args: ['src/usat_apps/modules/event_coi/pending_check.js'], env: { HEADLESS: '0' }, cli: 'HEADLESS=0 node src/usat_apps/modules/event_coi/pending_check.js' },
  ]},
  { label: 'HISTORY', color: 'CYAN', items: [
    { label: 'Recent jobs (last 10 + counts by status)', desc: 'Reads event_coi_submission_history: the 10 most recent submission runs (running ones flagged), a counts-by-status breakdown with grand total, and the SQL for both (copy into MySQL Workbench). Uses the local DB; no server needed. Non-PII — no holder data.', bin: 'node', args: ['src/usat_apps/modules/event_coi/history_recent.js'], cli: 'node src/usat_apps/modules/event_coi/history_recent.js' },
    { label: 'Seed 2 sample test runs (shows the SQL)', desc: "Inserts 2 sample rows (ran_by='test') into event_coi_submission_history so you can try the history view without the portal, and prints the equivalent INSERT for MySQL Workbench. Local DB; no server needed.", bin: 'node', args: ['src/usat_apps/modules/event_coi/history_test_rows.js', 'seed'], cli: 'node src/usat_apps/modules/event_coi/history_test_rows.js seed' },
    { label: 'Clear sample test runs (shows the SQL)', desc: "Deletes the sample rows (ran_by='test') and prints the equivalent DELETE for MySQL Workbench. Local DB; no server needed.", bin: 'node', args: ['src/usat_apps/modules/event_coi/history_test_rows.js', 'clear'], cli: 'node src/usat_apps/modules/event_coi/history_test_rows.js clear' },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'Event COI — module menu',
    subtitle: '(Event / Race Certificate Request builder)',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };
