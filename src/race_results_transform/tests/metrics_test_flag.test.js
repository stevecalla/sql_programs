'use strict';
// The deliberate "test run" flag (is_test) + its purge path. Guards that the flag is wired
// end-to-end so a production test session can be tagged and later deleted WITHOUT touching real
// or demo data:
//   1. ?metrics_test=1 is detected client-side and tags EVERY event via the client's baseProps;
//   2. is_test is whitelisted (DDL -> server column whitelist -> browser allow-list) + migrated;
//   3. retention.purge_test / metrics.purge_test delete only is_test = 1 rows;
//   4. the CLI (metrics:purge-test) and the menu expose it.
// Pure text/require checks — no DB, no network.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = require('../metrics/metrics_config');
const ddl_mod = require('../../queries/create_drop_db_table/query_create_race_results_transform_events_table');
const metrics_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'metrics.js'), 'utf8');
const client_js = fs.readFileSync(path.join(ROOT, '..', '..', 'utilities', 'analytics', 'metrics_client.js'), 'utf8');
const cli_js = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
const menu_js = fs.readFileSync(path.join(ROOT, 'menu.js'), 'utf8');

describe('metrics is_test flag + purge-test', () => {
  test('is_test is whitelisted server-side + client-side and declared in the DDL', async () => {
    assert.ok(cfg.COLUMNS.includes('is_test'), 'metrics_config.COLUMNS must include is_test');
    assert.match(metrics_js, /'is_test'/, 'public/js/metrics.js allowList must include is_test');
    const sql = await ddl_mod.query_create_race_results_transform_events_table('race_results_transform_events');
    assert.match(sql, /is_test\s+TINYINT\(1\)/, 'DDL must declare is_test TINYINT(1)');
  });

  test('the client tags every event when ?metrics_test=1 (sticky per tab) via baseProps', () => {
    assert.match(metrics_js, /metrics_test=1/, 'metrics.js must detect the ?metrics_test=1 flag');
    assert.match(metrics_js, /sessionStorage/, 'flag should stick for the tab session');
    assert.match(metrics_js, /baseProps:\s*test_mode\(\)\s*\?\s*\{\s*is_test:\s*1\s*\}/, 'init must pass is_test via baseProps when on');
    // the shared client must merge baseProps into EVERY event (so page_view is tagged too)
    assert.match(client_js, /cfg\.baseProps\s*=\s*opts\.baseProps/, 'client must accept baseProps');
    assert.match(client_js, /for \(k in cfg\.baseProps\)/, 'client must merge baseProps into each event');
  });

  test('the server migrates is_test onto existing tables', () => {
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /\{ name: 'is_test', ddl: 'is_test TINYINT\(1\)'/, 'is_test ensure_columns migration');
  });

  test('the purge-test path is exposed via the CLI and the menu', () => {
    assert.match(cli_js, /cmd === 'metrics:purge-test'/, 'cli.js must handle metrics:purge-test');
    assert.match(cli_js, /WHERE is_test = 1/, 'cli.js purge-test counts only is_test rows');
    assert.match(menu_js, /metrics:purge-test/, 'menu.js must offer the purge-test command');
    assert.match(menu_js, /action: 'metrics_purge_test'/, 'menu.js must wire the purge-test action');
  });

  test('the dashboard exposes a Test rows count + a Purge test button backed by an auth-gated route', () => {
    const dash = fs.readFileSync(path.join(ROOT, 'metrics', 'metrics_dashboard.html'), 'utf8');
    assert.match(dash, /id="purgeTest"/, 'dashboard has the Purge test button');
    assert.match(dash, />Purge test</, 'button label is just "Purge test"');
    assert.match(dash, /card\('Test rows', tr/, 'Test rows count is a KPI card in the stats row');
    assert.match(dash, /\/api\/metrics-purge-test/, 'button POSTs the purge route');
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /app\.post\('\/api\/metrics-purge-test', require_dash_auth/, 'purge route is auth-gated');
    assert.match(server, /metrics_report\.purge_test\(metrics_pool\)/, 'route calls purge_test');
  });
});
