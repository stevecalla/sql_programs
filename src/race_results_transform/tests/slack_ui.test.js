'use strict';
// Slack intake UI + wiring guard: the Slack Ironman tab markup, the app.js handlers, the source-aware
// endpoints, channel persistence, the file-type extension, and the server routes. Pure text/require
// checks — no network, no DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const app_js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
const slack_client = require('../slack/slack_client');
const slack_config = require('../slack/slack_config');

describe('slack intake — UI + wiring', () => {
  test('the Slack tab markup: channel picker, refresh, invite code + copy chip', () => {
    ['id="sfTabSlack"', 'data-src="slack"', 'id="sfSlackChannel"', 'id="sfSlackRefresh"',
     'id="sfSlackInvite"', 'id="sfSlackInviteCopy"'].forEach(function (needle) {
      assert.ok(html.indexOf(needle) >= 0, 'index.html missing ' + needle);
    });
    assert.ok(html.indexOf('coming soon') < 0, 'the under-construction placeholder copy is gone');
    assert.match(css, /\.sf-slack-note\{/, 'the invite-note is styled');
  });

  test('app.js wires the Slack source: channels, list, download, picker', () => {
    [
      /function sf_load_channels\b/, /function sf_render_invite\b/, /function sf_flash_copied\b/,
      /\/api\/slack\/channels/, /\/api\/slack\/files/, /'\/api\/slack\/file\/'/, /\/api\/slack\/save/,
      /S\.sf_source === 'slack'/, /function sf_set_source\b/
    ].forEach(function (re) { assert.match(app_js, re); });
  });

  test('public/private channel filter: a Show toggle that re-filters the cached channel list', () => {
    assert.ok(html.indexOf('id="sfSlackVis"') >= 0, 'visibility filter present');
    assert.ok(html.indexOf('value="public"') >= 0 && html.indexOf('value="private"') >= 0, 'public/private options');
    assert.match(app_js, /function sf_render_channel_options\b/, 'renders options from the cached list');
    assert.match(app_js, /vis === 'private' \? c\.is_private : !c\.is_private/, 'filters by is_private');
    assert.match(app_js, /rrt_slack_vis/, 'the filter choice persists');
  });

  test('the channel selection persists across sessions (localStorage)', () => {
    assert.match(app_js, /localStorage\.setItem\('rrt_slack_channel'/, 'saves the chosen channel');
    assert.match(app_js, /localStorage\.getItem\('rrt_slack_channel'/, 'restores the chosen channel');
  });

  test('intake-by-tab source values are tagged from the Slack/SF tabs', () => {
    assert.match(app_js, /function sf_queue_source\b/, 'per-tab analytics source helper');
    assert.match(app_js, /'sf_upload_queue'/, 'SF Upload Queue value');
    assert.match(app_js, /'sf_email_queue'/, 'SF Email Queue value');
    assert.match(app_js, /\? 'slack'/, 'Slack value');
  });

  test('Slack accepts spreadsheets + PowerPoint (xls already, plus pptx/ppt)', () => {
    ['xls', 'xlsx', 'csv', 'pptx', 'ppt'].forEach(function (ext) {
      assert.ok(slack_client.DEFAULT_EXTS.indexOf(ext) >= 0, 'DEFAULT_EXTS missing ' + ext);
    });
    const cfg = slack_config.slack_config({});
    assert.ok(cfg.file_types.indexOf('pptx') >= 0 && cfg.file_types.indexOf('ppt') >= 0, 'config default includes PowerPoint');
  });

  test('the server mounts the Slack routes behind dashboard auth', () => {
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /mount_slack_routes\(app, require_dash_auth\)/, 'Slack routes mounted behind mx_session');
    const routes = fs.readFileSync(path.join(ROOT, 'slack', 'slack_routes.js'), 'utf8');
    assert.match(routes, /app\.get\('\/api\/slack\/channels'/, 'channels route');
    assert.match(routes, /app\.get\('\/api\/slack\/files'/, 'files route');
    assert.match(routes, /app\.get\('\/api\/slack\/file\/:id'/, 'file-bytes route');
  });
});
