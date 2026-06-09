'use strict';
// Salesforce intake UI + wiring guard (markup, app.js handlers, the `source` analytics flag, and the
// server routes). Keeps the browser panel, the engine, and the analytics column in lockstep. Pure
// text/require checks — no network, no DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const app_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const metrics_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'metrics.js'), 'utf8');
const cfg = require('../metrics/metrics_config');
const ddl_mod = require('../../queries/create_drop_db_table/query_create_race_results_transform_events_table');

describe('salesforce intake — UI + wiring', () => {
  test('panel markup: From/To dates, Any-date, login (+ show toggle), folder, progress (+ cancel), queue', () => {
    [
      'id="sfCard"', 'id="sfFrom"', 'id="sfTo"', 'id="sfAnyDate"', 'id="sfField"',
      'id="sfListBtn"', 'id="sfResetBtn"', 'id="sfChooseFolder"', 'id="sfDownloadBtn"',
      'id="sfCount"', 'id="sfProgress"', 'id="sfProgressBar"', 'id="sfCancelBtn"',
      'id="sfLogin"', 'id="sfLoginUser"', 'id="sfLoginPass"', 'id="sfLoginShow"', 'id="sfLoginBtn"',
      'id="sfLogoutBtn"', 'id="sfSearch"', 'id="sfLimit"',
      'id="sfQueue"', 'id="filesTab"', 'id="filesView"'
    ].forEach(function (needle) { assert.ok(html.indexOf(needle) >= 0, 'index.html missing ' + needle); });
    assert.ok(html.indexOf('Get Race Results from Salesforce') >= 0, 'panel heading text');
    assert.ok(html.indexOf('data-sort="type"') >= 0, 'list has a sortable Type column');
  });

  test('app.js exposes file type + highlights/guards legacy .xls', () => {
    assert.match(app_js, /function sf_file_ext\b/, 'derives the file extension');
    assert.match(app_js, /function sf_type_cell\b/, 'renders the Type cell');
    assert.match(app_js, /sf-xls-row/, 'highlights .xls rows');
    assert.match(app_js, /function unreadable_message\b/, 'friendly message for unreadable (e.g. .xls) files');
    // optional .xls reading is lazy-loaded (SheetJS drop-in) and routed via read_spreadsheet
    assert.match(app_js, /function load_sheetjs\b/, 'lazy SheetJS loader');
    assert.match(app_js, /function read_spreadsheet\b/, 'xls/xlsx read router');
    assert.match(app_js, /vendor\/xlsx\.full\.min\.js/, 'lazy-loads the vendored SheetJS path');
  });

  test('the Files tab sits to the LEFT of Mapping in the compare bar', () => {
    assert.ok(html.indexOf('data-view="files"') < html.indexOf('data-view="mapping"'), 'Files tab must precede Mapping');
  });

  test('app.js wires the SF handlers + the right endpoints', () => {
    [
      /function wire_sf\b/, /function sf_list\b/, /function sf_download_selected\b/, /function sf_login\b/,
      /function sf_apply_range_limits\b/, /function sf_range_ok\b/, /function sf_restore_folder\b/,
      /function sf_idb_set\b/, /function render_queue\b/, /function open_queue_file\b/, /function sf_download_finish\b/,
      /function sf_visible\b/, /function sf_limit\b/, /function sf_select_newest\b/, /function sf_logout\b/, /function sf_yesterday\b/,
      /function sf_set_authed\b/, /function sf_toggle_auth\b/, /function sf_probe_xls\b/, /function sf_list_status\b/,
      /function sf_reload_file\b/, /function sf_can_reload\b/,
      /\/api\/sf\/files/, /\/api\/sf\/file\//, /\/api\/login/, /\/api\/logout/, /\/api\/sf\/folder-file/
    ].forEach(function (re) { assert.match(app_js, re); });
  });

  test('reload-from-disk: per-row button + the server folder-file route', () => {
    assert.match(app_js, /class="sf-q-reload"/, 'queue rows render a Reload button');
    assert.match(app_js, /SF_STAGE\.UPLOADED/, 'reload drops the row back to Uploaded (clears Downloaded)');
    const sf_routes = fs.readFileSync(path.join(ROOT, 'sf', 'sf_routes.js'), 'utf8');
    assert.match(sf_routes, /app\.get\('\/api\/sf\/folder-file'/, 'fallback read-back endpoint exists');
    assert.match(sf_routes, /path\.basename/, 'folder-file guards against path traversal (basename only)');
  });

  test('limits: default 25, hard max 150, 14-day range, date floor', () => {
    assert.match(app_js, /SF_DEFAULT_FILES\s*=\s*25/, 'default 25 selected');
    assert.match(app_js, /SF_MAX_FILES\s*=\s*150/, 'hard ceiling 150');
    assert.match(app_js, /SF_MAX_RANGE_DAYS\s*=\s*14/, '14-day range cap');
    assert.match(app_js, /SF_MIN_DATE\s*=\s*'2025-01-01'/, 'date floor 2025-01-01');
  });

  test('SF files are tagged source = salesforce', () => {
    assert.match(app_js, /S\.source\s*=\s*'salesforce'/, "open_queue_file must set S.source='salesforce'");
  });

  test('source flag is wired across COLUMNS, client allow-list, and DDL', async () => {
    assert.ok(cfg.COLUMNS.includes('source'), 'metrics_config.COLUMNS must include source');
    assert.match(metrics_js, /'source'/, 'public/js/metrics.js allowList must include source');
    const sql = await ddl_mod.query_create_race_results_transform_events_table('race_results_transform_events');
    assert.match(sql, /source\s+VARCHAR\(16\)/, 'DDL must declare source VARCHAR(16)');
  });

  test('the server exposes /api/login + the /api/sf routes are mounted', () => {
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /app\.post\('\/api\/login'/, 'inline JSON login endpoint');
    assert.match(server, /app\.post\('\/api\/logout'/, 'inline JSON logout endpoint');
    assert.match(server, /mount_sf_routes\(app, require_dash_auth\)/, 'SF routes mounted behind dashboard auth');
    assert.match(server, /\{ name: 'source', ddl: 'source VARCHAR\(16\)'/, 'source ensure_columns migration');
  });
});
