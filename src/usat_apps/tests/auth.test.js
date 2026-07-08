'use strict';
// Platform auth + access tests — no MySQL needed. Run: node --test src/usat_apps/tests/auth.test.js
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the data dir + recovery accounts BEFORE requiring the modules (they resolve file paths at load).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'usat_apps_test_'));
process.env.USATAPPS_DATA_DIR = TMP;
process.env.USATAPPS_ADMIN_USER = 'recovery_admin';
process.env.USATAPPS_ADMIN_PASS = 'secret123';
delete process.env.USATAPPS_USERS_FILE;
delete process.env.USATAPPS_PANEL_ACCESS_FILE;

const store = require('../auth/auth_store');
const session = require('../auth/session');
const panel_access = require('../access/panel_access');

test('password hash round-trips and rejects wrong password', () => {
  const h = store.hash_password('hunter2');
  assert.ok(h.startsWith('scrypt$'));
  assert.strictEqual(store.verify_password('hunter2', h), true);
  assert.strictEqual(store.verify_password('nope', h), false);
});

test('.env recovery account is valid and is admin', () => {
  const v = store.valid_user('recovery_admin', 'secret123');
  assert.ok(v && v.role === 'admin' && v.env === true);
  assert.strictEqual(store.valid_user('recovery_admin', 'wrong'), null);
});

test('stored users: add / validate / remove', () => {
  store.add_user('jane@usat.org', 'pw12345', 'user');
  const v = store.valid_user('jane@usat.org', 'pw12345');
  assert.ok(v && v.role === 'user');
  assert.ok(store.list_users().some((u) => u.user === 'jane@usat.org'));
  assert.strictEqual(store.remove_user('jane@usat.org'), true);
  assert.strictEqual(store.valid_user('jane@usat.org', 'pw12345'), null);
});

test('session sign/verify round-trips; tamper is rejected', () => {
  const secret = store.session_secret();
  const tok = session.sign({ user: 'x', role: 'admin', ts: Date.now() }, secret);
  const p = session.verify(tok, secret);
  assert.ok(p && p.user === 'x' && p.role === 'admin');
  assert.strictEqual(session.verify(tok + 'z', secret), null);
  assert.strictEqual(session.verify(tok, 'other-secret'), null);
});

test('panel catalog includes the reporting module panel + platform panels', () => {
  const keys = panel_access.catalog().map((p) => p.key);
  assert.ok(keys.includes('participation-maps'), 'reporting module panel present');
  assert.ok(keys.includes('metrics'), 'platform metrics panel present');
  assert.ok(keys.includes('admin'), 'platform admin panel present');
});

test('access model: admin sees all; default all excludes admin for users', () => {
  // admins see everything (incl. admin)
  assert.strictEqual(panel_access.is_allowed('anyone', 'admin', 'admin'), true);
  assert.strictEqual(panel_access.is_allowed('anyone', 'admin', 'participation-maps'), true);
  // default is 'all' -> a normal user sees non-admin panels but NOT admin
  assert.strictEqual(panel_access.is_allowed('bob', 'user', 'participation-maps'), true);
  assert.strictEqual(panel_access.is_allowed('bob', 'user', 'admin'), false);
});

test('access model: per-user override narrows panels', () => {
  panel_access.set_default([]);                          // no default access
  assert.strictEqual(panel_access.is_allowed('carol', 'user', 'participation-maps'), false);
  panel_access.set_user('carol', ['participation-maps']); // grant just reporting
  assert.strictEqual(panel_access.is_allowed('carol', 'user', 'participation-maps'), true);
  assert.strictEqual(panel_access.is_allowed('carol', 'user', 'metrics'), false);
  panel_access.clear_user('carol');                       // back to default (none)
  assert.strictEqual(panel_access.is_allowed('carol', 'user', 'participation-maps'), false);
  panel_access.set_default('all');                        // restore
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
