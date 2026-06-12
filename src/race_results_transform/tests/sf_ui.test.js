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
    assert.ok(html.indexOf('data-sort="sanction"') >= 0, 'list has a sortable Sanction column');
    assert.ok(html.indexOf('id="sfBroaden" checked') >= 0, 'panel has the Broaden search toggle, default ON');
  });

  test('broaden toggle widens the search (app.js param + server passes search_terms)', () => {
    assert.match(app_js, /\$\('sfBroaden'\)/, 'app.js reads the Broaden checkbox');
    assert.match(app_js, /Race Results Doc,Race Results,Race,Results/, 'broad sends the OR-term list as search');
    const sf_routes = fs.readFileSync(path.join(ROOT, 'sf', 'sf_routes.js'), 'utf8');
    assert.match(sf_routes, /req\.query\.search/, '/api/sf/files reads the search param');
    assert.match(sf_routes, /search_terms: search_terms/, 'passes search_terms into the engine');
  });

  test('sanction id is surfaced + pre-fills the download filename builder + shows in the summary bar', () => {
    assert.match(app_js, /sanction: s\.f\.sanction_id/, 'sf_build_queue carries the file sanction id into the queue');
    assert.match(app_js, /\{ id: it\.sanction \|\| '' \}/, 'opening a file sets the builder Sanction ID from that file (SF) or blanks it');
    assert.match(app_js, /key === 'sanction'/, 'SF list is sortable by sanction');
    assert.match(app_js, /S\.active_sanction = it\.sanction/, 'open_queue_file records the active sanction for the readout');
    assert.match(app_js, /class="chip sanctionchip"/, 'summary bar renders a visible Sanction readout chip');
    assert.match(app_js, /S\.source === 'salesforce' && S\.active_sanction/, 'readout only shows for Salesforce files with a sanction');
  });

  test('sanction id stays SF-only: blanked for manual upload, folder open, and Start over', () => {
    // manual upload (handle_file) clears the builder Sanction ID
    assert.match(app_js, /S\.dl_fields = Object\.assign\(\{\}, S\.dl_fields, \{ id: '' \}\);\s*\/\/ so the download builder/, 'handle_file blanks the Sanction ID');
    // opening a queue file sets id from that file (SF) or blanks it (folder has no sanction)
    assert.match(app_js, /\{ id: it\.sanction \|\| '' \}/, 'open_queue_file sets/clears id from the file, never carries over');
    // Start over clears it too
    assert.match(app_js, /sanction is SF-only/, 'clear_all blanks the Sanction ID');
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
      /\/api\/sf\/files/, /\/api\/sf\/file\//, /\/api\/login/, /\/api\/logout/, /\/api\/sf\/folder-file/,
      /\/api\/auth-status/
    ].forEach(function (re) { assert.match(app_js, re); });
  });

  test('refresh keeps the Sign in/out label correct: load-time auth probe + server route', () => {
    assert.match(app_js, /\/api\/auth-status[\s\S]*?sf_set_authed/, 'wire_sf probes auth status on load and sets the button');
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /app\.get\('\/api\/auth-status'/, 'server exposes the (ungated) auth-status probe');
    assert.match(server, /authed: valid_session\(read_cookie/, 'auth-status reports the real session state');
  });

  test('reload-from-disk: per-row button + the server folder-file route', () => {
    assert.match(app_js, /class="sf-q-reload"/, 'queue rows render a Reload button');
    assert.match(app_js, /SF_STAGE\.UPLOADED/, 'reload drops the row back to Uploaded (clears Downloaded)');
    const sf_routes = fs.readFileSync(path.join(ROOT, 'sf', 'sf_routes.js'), 'utf8');
    assert.match(sf_routes, /app\.get\('\/api\/sf\/folder-file'/, 'fallback read-back endpoint exists');
    assert.match(sf_routes, /path\.basename/, 'folder-file guards against path traversal (basename only)');
  });

  test('limits: default 50, hard max 150, 14-day range, date floor', () => {
    assert.match(app_js, /SF_DEFAULT_FILES\s*=\s*50/, 'default 50 selected');
    assert.match(app_js, /SF_MAX_FILES\s*=\s*150/, 'hard ceiling 150');
    assert.match(app_js, /SF_MAX_RANGE_DAYS\s*=\s*14/, '14-day range cap');
    assert.match(app_js, /SF_MIN_DATE\s*=\s*'2025-01-01'/, 'date floor 2025-01-01');
  });

  test('list UX: highlights missing program/sanction rows, flags more-available, resizable box', () => {
    assert.match(app_js, /sf-missing-meta/, 'rows missing program or sanction get a highlight class');
    assert.match(app_js, /!f\.program_name \|\| !f\.sanction_id/, 'highlight condition = missing program or sanction');
    assert.match(app_js, /class="sf-more"/, 'count flags when more files are available than selected');
    assert.match(app_js, /sf-limit-hot/, 'Max-files field is highlighted when the cap is below the number available');
    assert.match(app_js, /total > lim && lim < SF_MAX_FILES/, 'highlight only when raising the cap can include more');
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
    assert.match(css, /\.sf-table-wrap\{[^}]*resize:\s*vertical/, 'results box is vertically resizable');
    assert.match(css, /\.sf-missing-meta td\{/, 'missing-meta highlight style exists');
    assert.match(css, /\.sf-limit-hot\{/, 'Max-files highlight style exists');
  });

  test('SF files are tagged source = salesforce', () => {
    // open_queue_file now takes the item's source; sf_build_queue tags SF items 'salesforce'
    assert.match(app_js, /source: 'salesforce'/, "sf_build_queue must tag SF items source='salesforce'");
    assert.match(app_js, /S\.source = it\.source \|\| S\.queue_source/, 'open_queue_file takes the item source');
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

describe('local-folder intake — UI + wiring', () => {
  test('panel markup: choose folder, webkitdirectory input, file list, load button', () => {
    [
      'id="folderCard"', 'id="folderChooseBtn"', 'id="folderInput"', 'webkitdirectory',
      'id="folderTable"', 'id="folderCheckAll"', 'id="folderSearch"', 'id="folderCount"', 'id="folderLoadBtn"'
    ].forEach(function (needle) { assert.ok(html.indexOf(needle) >= 0, 'index.html missing ' + needle); });
    assert.ok(html.indexOf('Convert files from a folder') >= 0, 'panel heading text');
  });

  test('app.js wires the folder picker + the generic queue', () => {
    [
      /function wire_folder\b/, /function folder_choose\b/, /function folder_from_input\b/, /function folder_load\b/,
      /function folder_render\b/, /function folder_reset\b/, /function build_queue\b/,
      /showDirectoryPicker/, /webkitdirectory|webkitRelativePath/
    ].forEach(function (re) { assert.match(app_js, re); });
    assert.match(app_js, /source: 'folder'/, "folder_load must build_queue with source 'folder'");
    assert.match(app_js, /S\.queue_source === 'folder'/, 'render_queue adapts columns for the folder source');
    assert.match(app_js, /wire_folder\(\)/, 'wire_folder is called from init');
  });

  test('the queue is source-agnostic (sf_build_queue delegates to build_queue)', () => {
    assert.match(app_js, /function build_queue\b/, 'generic build_queue exists');
    assert.match(app_js, /build_queue\(saved\.map/, 'sf_build_queue delegates to build_queue');
    assert.match(app_js, /S\.source = it\.source \|\| S\.queue_source/, 'open_queue_file takes the item source');
  });
});
