'use strict';
// Split-auth guard: /metrics + /admin sit behind a SEPARATE admin login (admin_session ←
// RACE_RESULTS_ADMIN_USER/_PASS, fallback to the metrics creds), while the converter's Salesforce/Slack
// intake keeps the app login (mx_session). Pure text checks against the server + the /admin page — no
// network. Skips cleanly outside the monorepo (the server lives at the repo root).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
const have_server = fs.existsSync(SERVER);
const server = have_server ? fs.readFileSync(SERVER, 'utf8') : '';

describe('admin auth — /metrics + /admin behind a separate admin login', () => {
  test('the server defines a distinct admin session + guard, with metrics-cred fallback', { skip: !have_server }, () => {
    assert.match(server, /const ADMIN_COOKIE = 'admin_session'/, 'separate admin_session cookie');
    assert.match(server, /const require_admin_auth = gate_cap\('admin'/, 'admin guard (capability-based)');
    assert.match(server, /function valid_admin_session\b/, 'admin session validator');
    assert.match(server, /function sign_admin\b/, 'admin session signer (own HMAC key)');
    // admin creds default to the dedicated vars, else fall back to the metrics creds (no lockout)
    assert.match(server, /RACE_RESULTS_ADMIN_USER \|\| process\.env\.RACE_RESULTS_CONVERTER_METRICS_USER/, 'admin user falls back to metrics user');
    assert.match(server, /RACE_RESULTS_ADMIN_PASS \|\| process\.env\.RACE_RESULTS_CONVERTER_METRICS_PASS/, 'admin pass falls back to metrics pass');
  });

  test('/metrics is gated by the metrics cap; /admin by the admin cap', { skip: !have_server }, () => {
    assert.match(server, /app\.get\('\/metrics', require_metrics_auth/, '/metrics needs the metrics cap');
    assert.match(server, /app\.get\('\/api\/metrics-report', require_metrics_auth/, 'metrics-report needs the metrics cap');
    assert.match(server, /app\.post\('\/api\/metrics-purge-test', require_metrics_auth/, 'purge-test needs the metrics cap');
    assert.match(server, /app\.post\('\/api\/metrics-ask', require_metrics_auth/, 'ask needs the metrics cap');
    assert.match(server, /app\.get\('\/admin', require_admin_auth/, '/admin needs the admin cap');
    assert.match(server, /app\.get\('\/api\/admin-status', require_admin_auth/, 'admin-status needs the admin cap');
  });

  test('admin login/logout use the admin cookie; /metrics login moved to admin auth', { skip: !have_server }, () => {
    assert.match(server, /app\.get\('\/admin\/login'/, '/admin/login GET');
    assert.match(server, /app\.post\('\/admin\/login'/, '/admin/login POST');
    assert.match(server, /app\.get\('\/admin\/logout'/, '/admin/logout');
    assert.match(server, /app\.post\('\/metrics\/login', function \(req, res\) \{ admin_signin_post/, '/metrics/login uses the admin sign-in');
    assert.match(server, /app\.get\('\/metrics\/logout'[\s\S]{0,80}clearCookie\(ADMIN_COOKIE/, '/metrics/logout clears the admin cookie');
  });

  test('the converter intake keeps the SEPARATE app login (mx_session) — unchanged', { skip: !have_server }, () => {
    assert.match(server, /mount_sf_routes\(app, require_dash_auth\)/, 'SF intake still on app login');
    assert.match(server, /mount_slack_routes\(app, require_dash_auth\)/, 'Slack intake still on app login');
    assert.match(server, /app\.post\('\/api\/login'[\s\S]{0,500}authenticate\(u, pw\)/, '/api/login authenticates any account in the file');
    assert.match(server, /authed: valid_session\(read_cookie/, '/api/auth-status still reflects the app session');
  });

  test('the /admin page matches / and /metrics: app.css, theme toggle, live footer clock, test-mode link', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    assert.match(admin, /href="\/css\/app\.css"/, 'reuses the converter stylesheet (matching colors/theme)');
    assert.match(admin, /id="themeToggle"/, 'has the light/dark theme toggle');
    assert.match(admin, /rrt_ui_v1/, 'shares the theme pref key with / and /metrics');
    assert.match(admin, /class="app-header"[\s\S]*class="title-row"/, 'uses the same header structure as /');
    assert.match(admin, /id="footerClock"/, 'has the live footer clock');
    assert.match(admin, /America\/Denver[\s\S]*setInterval\(tick, 1000\)/, 'the clock ticks every second in Mountain Time');
    assert.match(admin, /\/\?metrics_test=1/, 'a link opens the converter in test mode');
  });

  test('the /admin status endpoint returns booleans only (never secrets/channel values)', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    assert.match(admin, /\/api\/admin-status/, 'page reads the status endpoint');
    if (have_server) {
      // the STATUS endpoint reports the channel as a boolean flag (the editable CONFIG endpoint may return the
      // actual value — that's admin-gated and intentional — so we don't scan the whole file for the value).
      assert.match(server, /slack_default_channel_set: !!env\.SLACK_CHANNEL_ID/, 'status reports the channel as a boolean flag, not its value');
      assert.ok(server.indexOf('value: env.SLACK_CHANNEL_ID') < 0, 'no endpoint dumps the channel under a generic "value" key');
    }
  });

  test('admin ACTIONS exist (gated) and are wired to buttons on the page', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    ['data-action="test-sf"', 'data-action="test-slack"', 'data-action="backfill"', 'data-action="purge-test"'].forEach(function (n) {
      assert.ok(admin.indexOf(n) >= 0, 'admin.html missing action button ' + n);
    });
    assert.match(admin, /\[data-action\][\s\S]{0,80}addEventListener/, 'page wires the action buttons');
    if (have_server) {
      assert.match(server, /app\.post\('\/api\/admin-test-slack', require_admin_auth/, 'test-slack action gated');
      assert.match(server, /app\.post\('\/api\/admin-test-sf', require_admin_auth/, 'test-sf action gated');
      assert.match(server, /app\.post\('\/api\/admin-backfill-source', require_admin_auth/, 'backfill action gated');
      assert.match(server, /metrics_report\.backfill_source\(metrics_pool/, 'backfill calls the report helper');
    }
  });

  test('the /admin ops console can run menu commands + tail logs (admin-gated)', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    assert.match(admin, /data-pane="operations"/, 'has an Operations panel');
    assert.match(admin, /data-pane="logs"/, 'has a Logs panel');
    assert.match(admin, /\/api\/admin-console\/commands/, 'loads the command registry');
    assert.match(admin, /EventSource\('\/api\/admin-console\/stream\//, 'streams command output live');
    assert.match(admin, /EventSource\('\/api\/admin-logs\/stream'\)/, 'tails the server console live');
    if (have_server) {
      assert.match(server, /app\.post\('\/api\/admin-console\/run', require_admin_auth/, 'run endpoint admin-gated');
      assert.match(server, /app\.get\('\/api\/admin-console\/stream\/:run_id', require_admin_auth/, 'stream endpoint admin-gated');
      assert.match(server, /app\.post\('\/api\/admin-console\/kill\/:run_id', require_admin_auth/, 'kill endpoint admin-gated');
      assert.match(server, /app\.get\('\/api\/admin-logs', require_admin_auth/, 'logs endpoint admin-gated');
      assert.match(server, /app\.get\('\/api\/admin-pm2', require_admin_auth/, 'pm2 endpoint admin-gated');
      // the client sends only an id + params; argv is assembled server-side and spawned with no shell
      assert.match(server, /console_registry\.by_id\(b\.id\)/, 'run looks the command up in the registry by id');
    }
  });

  test('admin login is a superset (reaches the converter intake) + Slack hide-list', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    const routes = fs.readFileSync(path.join(ROOT, 'slack', 'slack_routes.js'), 'utf8');
    // /admin Slack control is a HIDE-list (checked = hidden; new channels visible by default)
    assert.match(admin, /class="cfg-hide"/, 'admin Settings has the hide-channel checkboxes');
    assert.match(admin, /slack_hidden_channels/, 'admin saves the hide-list');
    assert.match(admin, /id="cfgHandle"/, 'admin Settings has the bot-handle field');
    assert.match(admin, /id="cfgUpdated"/, 'Settings shows a last-changed timestamp');
    // operations list is numbered + its section cards collapse
    assert.match(admin, /class="ops-num"/, 'Operations items are numbered');
    assert.match(admin, /classList\.toggle\('collapsed'\)/, 'Operations sections collapse');
    // the end-user channel route HIDES the listed channels (empty = show all)
    assert.match(routes, /SLACK_HIDDEN_CHANNELS/, 'channel route honors the hide-list');
    assert.match(routes, /hidden\.length\) channels = channels\.filter/, 'filters out hidden channels when set');
    assert.match(routes, /SLACK_BOT_HANDLE \|\| identity\.user/, 'channel route returns the configured bot handle');
    if (have_server) {
      assert.match(server, /req_caps\(req\)\.indexOf\('intake'\) >= 0\) return next\(\)/, 'an intake-capable session (incl. admins) passes the intake gate');
      assert.match(server, /SLACK_HIDDEN_CHANNELS = c\.slack_hidden_channels/, 'hide-list applied onto process.env');
      assert.match(server, /overrides\.config_updated_at = new Date\(\)\.toISOString\(\)/, 'config save stamps a change time');
    }
  });

  test('Get-Results login accepts admin creds; ngrok toggle + pm2 restart/stop are wired', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    // ngrok toggle + restart/stop controls on the page
    assert.match(admin, /id="cfgNgrok"/, 'Settings has the ngrok enable toggle');
    assert.match(admin, /id="btnRestart"/, 'Maintenance has a Restart button');
    assert.match(admin, /id="btnStop"/, 'Maintenance has a Stop button');
    assert.match(admin, /\/api\/admin-restart/, 'restart wired');
    // unified bordered frame + collapsed-by-default ops + numbered items still present
    assert.match(admin, /\.admin-shell \{[^}]*border:1px solid var\(--line\)/, 'the console is one bordered frame');
    assert.match(admin, /class="ops-sec collapsed"/, 'Operations sections start collapsed');
    if (have_server) {
      assert.match(server, /const user = authenticate\(u, pw\);/, '/api/login authenticates any account in the file');
      assert.match(server, /set_admin_cookie\(res, user\)/, 'login sets the admin cookie with the username');
      assert.match(server, /app\.post\('\/api\/logout'[\s\S]{0,180}clearCookie\(ADMIN_COOKIE/, '/api/logout clears the admin cookie too (Sign out truly ends it)');
      assert.match(server, /app\.post\('\/api\/admin-restart', require_admin_auth/, 'restart endpoint admin-gated');
      assert.match(server, /app\.post\('\/api\/admin-stop', require_admin_auth/, 'stop endpoint admin-gated');
      assert.match(server, /is_test_ngrok \|\| ngrok_enabled_flag/, 'ngrok is a runtime toggle');
      assert.match(server, /ngrok_url: ngrok_url/, 'admin-status surfaces the public ngrok URL');
    }
    // the /metrics dashboard footer links to /admin + converter with the test param
    const dash = fs.readFileSync(path.join(ROOT, 'metrics', 'metrics_dashboard.html'), 'utf8');
    assert.match(dash, /href="\/admin\?metrics_test=1"/, 'metrics footer links to /admin (test param)');
  });

  test('per-user RBAC: capability checkboxes + per-cap gates (admin / metrics / intake)', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'metrics', 'admin.html'), 'utf8');
    assert.match(admin, /class="newCap" value="admin"/, 'Access form has an Admin-hub capability checkbox');
    assert.match(admin, /class="newCap" value="metrics"/, 'Access form has a Metrics capability checkbox');
    assert.match(admin, /class="newCap" value="intake"/, 'Access form has an Intake capability checkbox');
    assert.match(admin, /\.newCap:checked/, 'add-user posts the selected caps');
    if (have_server) {
      assert.match(server, /function caps_for\(user\)/, 'server resolves per-user capabilities');
      assert.match(server, /const require_admin_auth = gate_cap\('admin'/, 'admin hub needs the admin cap');
      assert.match(server, /const require_metrics_auth = gate_cap\('metrics'/, 'metrics needs the metrics cap');
      assert.match(server, /req_caps\(req\)\.indexOf\('intake'\) >= 0\) return next\(\)/, 'intake gate checks the intake cap');
      assert.match(server, /app\.get\('\/metrics', require_metrics_auth/, '/metrics uses the metrics gate');
      // login GETs redirect to the area ONLY when the user has that cap — otherwise the form shows (no redirect loop)
      assert.match(server, /app\.get\('\/admin\/login'[\s\S]{0,140}req_caps\(req\)\.indexOf\('admin'\) >= 0\) return res\.redirect\('\/admin'\)/, 'admin login avoids the redirect loop');
      assert.match(server, /req_caps\(req\)\.indexOf\('metrics'\) >= 0\) return res\.redirect\('\/metrics'\)/, 'metrics login avoids the redirect loop');
      // one consolidated login panel: identity banner + Sign out / area links + error, all on a single page
      assert.match(server, /function login_ctx\(req\)/, 'login panel resolves the signed-in identity + caps');
      assert.match(server, /Signed in as <b>/, 'login panel shows an identity banner when signed in');
      assert.match(server, /class="chip" href="' \+ logout/, 'login panel offers Sign out + links to accessible areas');
      assert.match(server, /class="chip" href="\/\?metrics_test=1"/, 'login Converter link carries ?metrics_test=1');
      assert.match(server, /admin_store\.ALL_CAPS\.slice\(\)/, '.env admin account always gets all caps (recovery)');
      assert.match(server, /admin_store\.add_user\(overrides, scope, user, pass, caps\)/, 'user-add stores caps');
    }
  });
});
