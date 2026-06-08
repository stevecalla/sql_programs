'use strict';
// "Try me (fake data)" feature + the is_demo analytics flag.
//
// Guards three things that must stay in lockstep or the feature silently breaks:
//   1. the is_demo column is wired end-to-end (DDL -> server whitelist -> client allow-list);
//   2. the Try-me dropdown markup exists in index.html (button + both menu items + sample link);
//   3. app.js wires the demo loader and stamps is_demo on demo events.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = require('../metrics/metrics_config');
const ddl_mod = require('../../queries/create_drop_db_table/query_create_race_results_transform_events_table');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const app_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const metrics_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'metrics.js'), 'utf8');

describe('try_me / is_demo', () => {
  test('is_demo is in the server column whitelist', () => {
    assert.ok(cfg.COLUMNS.includes('is_demo'), 'metrics_config.COLUMNS must include is_demo');
  });

  test('is_demo is in the browser client allow-list', () => {
    assert.match(metrics_js, /'is_demo'/, 'public/js/metrics.js allowList must include is_demo');
  });

  test('the events-table DDL declares the is_demo column', async () => {
    const sql = await ddl_mod.query_create_race_results_transform_events_table('race_results_transform_events');
    assert.match(sql, /is_demo\s+TINYINT\(1\)/, 'DDL must declare is_demo TINYINT(1)');
  });

  test('the Try-me sample file ships as a static asset under public/', () => {
    // Served at /sample/sample_race_results_FAKE.xlsx by express.static (and in any static deploy
    // of public/). If this file is missing, the "Try me" load/download 404s in production.
    const f = path.join(ROOT, 'public', 'sample', 'sample_race_results_FAKE.xlsx');
    assert.ok(fs.existsSync(f), 'public/sample/sample_race_results_FAKE.xlsx is missing — regenerate via examples/sample/build_sample.js');
    assert.ok(fs.readFileSync(f).length > 0, 'the served sample file is empty');
  });

  test('index.html has the Try-me dropdown (button + both menu items)', () => {
    assert.match(html, /id="tryMeBtn"/, 'missing Try-me button');
    assert.match(html, /id="tryMeMenu"/, 'missing Try-me menu');
    assert.match(html, /id="tryMeLoad"/, 'missing "load sample" menu item');
    assert.match(html, /id="tryMeGet"/, 'missing "download sample" menu item');
    assert.match(html, /href="\/sample\/sample_race_results_FAKE\.xlsx"/, 'download item must point at the served sample file');
    assert.match(html, /id="demoBadge"/, 'missing the "sample data" badge');
  });

  test('app.js wires the demo loader and stamps is_demo on demo events', () => {
    assert.match(app_js, /function load_demo\b/, 'app.js must define load_demo()');
    assert.match(app_js, /function wire_try_me\b/, 'app.js must define wire_try_me()');
    assert.match(app_js, /function is_demo_filename\b/, 'app.js must detect re-uploaded sample files');
    assert.match(app_js, /\/sample\/sample_race_results_FAKE\.xlsx/, 'app.js must fetch the served sample file');
    assert.match(app_js, /if \(S\.is_demo\) props\.is_demo = 1/, 'track() must stamp is_demo on demo events');
  });
});
