'use strict';
// Verifies this tool is wired into the repo-root package.json scripts and the
// VS Code .vscode/tasks.json, following the same pattern as the other servers
// (event_analysis is the closest analog). Skips quietly when run outside the
// monorepo (e.g. a standalone clone), like fixtures.test.js does for data.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');           // …/sql_programs
const PKG = path.join(REPO, 'package.json');
const TASKS = path.join(REPO, '.vscode', 'tasks.json');
const SERVER = 'server_race_results_transform_8018.js';
const PM2 = 'usat_race_results_transform';

function in_monorepo() {
  if (!fs.existsSync(PKG)) return false;
  try { return !!JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts.pm2_run_all_servers; }
  catch (e) { return false; }
}

describe('config_wiring', () => {
  test('package.json scripts include the race_results_transform block (event_analysis pattern)', () => {
    if (!in_monorepo()) { console.log('  (not in monorepo — skipped)'); return; }
    const sc = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts;
    assert.equal(sc.race_results_transform_server, 'node ' + SERVER, 'server script');
    const start = sc.pm2_start_race_results_transform || '';
    [SERVER, '--name ' + PM2, '--no-autorestart', '--max-memory-restart 4G', '--expose-gc']
      .forEach(function (frag) { assert.ok(start.indexOf(frag) >= 0, 'pm2_start missing: ' + frag); });
    assert.ok((sc.pm2_logs_race_results_transform || '').indexOf('pm2 logs ' + PM2) >= 0, 'logs');
    assert.ok((sc.stop_race_results_transform || '').indexOf('pm2 stop ' + PM2) >= 0, 'stop');
    assert.ok((sc.delete_race_results_transform || '').indexOf('pm2 delete ' + PM2) >= 0, 'delete');
    assert.ok((sc.show_race_results_transform || '').indexOf('pm2 show ' + PM2) >= 0, 'show');
    assert.ok((sc.restart_race_results_transform || '').indexOf('pm2 restart ' + PM2) >= 0, 'restart');
  });

  test('pm2_run_all_servers starts the server as 17 of 20', () => {
    if (!in_monorepo()) { console.log('  (not in monorepo — skipped)'); return; }
    const run_all = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts.pm2_run_all_servers;
    assert.ok(run_all.indexOf('npm run pm2_start_race_results_transform') >= 0, 'not in run-all chain');
    assert.ok(run_all.indexOf('(17 of 20)') >= 0, 'not labeled 17 of 20');
    assert.ok(run_all.indexOf(' of 19)') < 0 && run_all.indexOf(' of 18)') < 0, 'stale "of 19"/"of 18" counts remain');
  });

  test('.vscode/tasks.json has the RACE RESULTS TRANSFORM tasks (event_analysis pattern)', () => {
    if (!fs.existsSync(TASKS)) { console.log('  (no tasks.json — skipped)'); return; }
    const t = fs.readFileSync(TASKS, 'utf8');
    assert.ok(t.indexOf('"16 RACE RESULTS TRANSFORM (logs)"') >= 0, 'logs task');
    assert.ok(t.indexOf('"16 RACE RESULTS TRANSFORM (shell)"') >= 0, 'shell task');
    assert.ok(t.indexOf('npm run pm2_logs_race_results_transform') >= 0, 'logs command');
    assert.ok(t.indexOf('grp-race-results-transform') >= 0, 'presentation group');
    assert.ok(t.indexOf('READY: RACE RESULTS TRANSFORM') >= 0, 'shell READY banner');
    // compound (split) task defined AND referenced in the aggregate dependsOn lists
    assert.ok(t.split('"Race Results Transform (split)"').length - 1 >= 3, 'split task not defined + referenced in both lists');
  });

  test('tasks.json stays valid JSONC (comments + trailing commas tolerated)', () => {
    if (!fs.existsSync(TASKS)) { console.log('  (no tasks.json — skipped)'); return; }
    const stripped = fs.readFileSync(TASKS, 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,(\s*[\]}])/g, '$1');
    assert.doesNotThrow(function () { JSON.parse(stripped); }, 'tasks.json is not valid JSONC');
  });
});
