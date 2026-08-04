'use strict';
// console_registry.js — the allow-list of commands the Email Queue admin → Operations panel can run.
// Ported in spirit from the standalone app's admin/console_registry.js, but the argv are RE-POINTED at
// the real usat_apps equivalents (the module's own test suites via run_tests.js, the SF-read + corrections
// smoke checks, and a small module metrics CLI) — the POC's tests/*.test.js, src/cli.js and metrics_cli.js
// paths don't exist in the platform. Everything is spawned `node`, shell:false, cwd=repo root (see runner).
//
// Item shape: { id, action, label, desc, cli, web:'run'|'form'|'terminal', klass:'read'|'mutate'|'destruct'|'test'|'na',
//               bin:'node', argv:[...], params?:[...], confirm?:true, note? }.  ids are unique + sequential.
const M = 'src/usat_apps/modules/salesforce_email_queue';

const SECTIONS = [
  { label: 'Tests (node, no browser)', color: 'magenta', items: [
    { id: 1, action: 'test_all', label: 'Run ALL tests', desc: 'The full usat_apps suite (services + every module).', cli: 'node src/usat_apps/run_tests.js', web: 'run', klass: 'test', bin: 'node', argv: ['src/usat_apps/run_tests.js'] },
    { id: 2, action: 'test_services', label: 'Shared services tests', desc: 'services/{ai,text_clean,knowledge,corrections,salesforce} — the shared brain.', cli: 'node src/usat_apps/run_tests.js services', web: 'run', klass: 'test', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'services'] },
    { id: 3, action: 'test_module', label: 'Module tests (sf + api gate)', desc: 'The salesforce_email_queue module suite — sf_threads + panel-gate contract.', cli: 'node src/usat_apps/run_tests.js modules/salesforce_email_queue', web: 'run', klass: 'test', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'modules/salesforce_email_queue'] },
  ] },
  { label: 'Salesforce (read-only)', color: 'cyan', items: [
    { id: 4, action: 'verify_prod', label: 'Verify SF read — Production', desc: 'Connect (read role) + list queues via services/salesforce. Needs SF_PROD_* + network.', cli: 'node ' + M + '/check_sf_read.js', web: 'run', klass: 'read', bin: 'node', argv: [M + '/check_sf_read.js'] },
    { id: 5, action: 'verify_sandbox', label: 'Verify SF read — Sandbox', desc: 'Same, against the dev org (SF_DEV_* + test.salesforce.com).', cli: 'node ' + M + '/check_sf_read.js --sandbox', web: 'run', klass: 'read', bin: 'node', argv: [M + '/check_sf_read.js', '--sandbox'] },
  ] },
  { label: 'Database', color: 'yellow', items: [
    { id: 6, action: 'corr_db', label: 'Corrections DB smoke', desc: 'Ensure salesforce_email_queue_corrections, insert a test row, read it back. Needs DB creds.', cli: 'node ' + M + '/check_corrections_db.js', web: 'run', klass: 'test', bin: 'node', argv: [M + '/check_corrections_db.js'] },
  ] },
  { label: 'Metrics & analytics', color: 'cyan', items: [
    { id: 7, action: 'metrics_stats', label: 'Usage stats (last 7 days)', desc: 'The metrics report as text, over salesforce_email_queue_events.', cli: 'node ' + M + '/metrics/metrics_cli.js stats', web: 'run', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'stats'] },
    { id: 8, action: 'metrics_size', label: 'Usage data — size', desc: 'Row count + table size (MB) of the events table.', cli: 'node ' + M + '/metrics/metrics_cli.js size', web: 'run', klass: 'read', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'size'] },
    { id: 9, action: 'metrics_purge_test', label: 'Purge TEST rows ($0 only, is_test=1)', desc: 'Deletes $0 test rows; KEEPS cost-bearing test runs so the bill reconciles.', cli: 'node ' + M + '/metrics/metrics_cli.js purge-test --yes', web: 'run', klass: 'mutate', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'purge-test', '--yes'] },
    { id: 10, action: 'metrics_cleanup', label: 'Cleanup — purge old years', desc: 'Retention: drop rows older than the keep window (current + prior calendar year).', cli: 'node ' + M + '/metrics/metrics_cli.js cleanup --yes', web: 'run', klass: 'destruct', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'cleanup', '--yes'], confirm: true },
    { id: 11, action: 'metrics_purge_all', label: 'PURGE ALL (danger)', desc: 'Deletes EVERY analytics row for this app. Irreversible.', cli: 'node ' + M + '/metrics/metrics_cli.js purge-all --yes', web: 'run', klass: 'destruct', bin: 'node', argv: [M + '/metrics/metrics_cli.js', 'purge-all', '--yes'], confirm: true },
  ] },
];

const ALL = SECTIONS.reduce(function (a, s) { return a.concat(s.items); }, []);
function web_sections() { return SECTIONS; }

module.exports = { SECTIONS: SECTIONS, ALL: ALL, web_sections: web_sections };
