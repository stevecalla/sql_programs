'use strict';
// Auth unit tests (no server, no DB).  node --test src/salesforce_merge/tests/auth.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Random per-run signing keys — never hardcoded, so no secret is committed (keeps GitGuardian and
// similar scanners happy). Generated fresh on every run.
const SECRET = crypto.randomBytes(24).toString('hex');
const WRONG = crypto.randomBytes(24).toString('hex');
process.env.MERGE_SESSION_SECRET = SECRET; // avoid the generated-secret file in tests

// Point the file-backed stores at throwaway temp files so tests never touch the real auth.json /
// panel_access.json. These must be set BEFORE requiring the modules (the path is resolved at load).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-auth-'));
process.env.MERGE_USERS_FILE = path.join(TMP, 'auth.json');
process.env.MERGE_PANEL_ACCESS_FILE = path.join(TMP, 'panel_access.json');

const session = require('../auth/session');
const store = require('../auth/auth_store');
const panel_access = require('../auth/panel_access');

describe('session', () => {
  test('sign + verify round-trips a payload', () => {
    const t = session.sign({ user: 'a', role: 'admin', ts: Date.now() }, SECRET);
    const p = session.verify(t, SECRET);
    assert.equal(p.user, 'a');
    assert.equal(p.role, 'admin');
  });

  test('verify rejects wrong secret, tampered, and garbage tokens', () => {
    const t = session.sign({ user: 'a', ts: Date.now() }, SECRET);
    assert.equal(session.verify(t, WRONG), null);
    assert.equal(session.verify(t + 'x', SECRET), null);
    assert.equal(session.verify('garbage', SECRET), null);
    assert.equal(session.verify('', SECRET), null);
  });

  test('verify rejects an expired token', () => {
    const old = Date.now() - (13 * 60 * 60 * 1000); // older than MAX_AGE_MS (12h)
    const t = session.sign({ user: 'a', ts: old }, SECRET);
    assert.equal(session.verify(t, SECRET), null);
  });

  test('parse_cookies finds the session cookie', () => {
    const c = session.parse_cookies('foo=1; merge_session=xyz; bar=2');
    assert.equal(c.merge_session, 'xyz');
  });
});

describe('auth_store.valid_user', () => {
  test('matches the .env recovery accounts (both admin) and rejects everything else', () => {
    const pass = crypto.randomBytes(12).toString('hex');
    const tpass = crypto.randomBytes(12).toString('hex');
    process.env.MERGE_ADMIN_USER = 'admin';
    process.env.MERGE_ADMIN_PASS = pass;
    process.env.MERGE_TEST_USER = 'tester';
    process.env.MERGE_TEST_PASS = tpass;
    assert.deepEqual(store.valid_user('admin', pass), { user: 'admin', env: true, role: 'admin' });
    assert.deepEqual(store.valid_user('tester', tpass), { user: 'tester', env: true, role: 'admin' });
    assert.equal(store.valid_user('admin', 'wrong'), null);
    assert.equal(store.valid_user('nobody', pass), null);
    assert.equal(store.valid_user('', ''), null);
    assert.equal(store.login_configured(), true);
    assert.equal(store.env_accounts().length, 2);
  });
});

describe('auth_store stored users (scrypt, file-backed)', () => {
  test('add, list, role update, valid_user, remove', () => {
    const r = store.add_user('alice', 'alicepw', 'user');
    assert.equal(r.role, 'user');
    assert.ok(store.list_users().some((u) => u.user === 'alice'));
    assert.equal(store.valid_user('alice', 'alicepw').role, 'user');
    assert.equal(store.valid_user('alice', 'nope'), null);
    store.add_user('alice', 'newpw', 'admin');               // update role + password
    assert.equal(store.valid_user('alice', 'newpw').role, 'admin');
    assert.equal(store.remove_user('alice'), true);
    assert.equal(store.valid_user('alice', 'newpw'), null);
  });

  test('password hashes are scrypt and never stored in plaintext', () => {
    store.add_user('bob', 'plaintextpw', 'user');
    const raw = fs.readFileSync(process.env.MERGE_USERS_FILE, 'utf8');
    assert.ok(!raw.includes('plaintextpw'));
    assert.ok(raw.includes('scrypt$'));
    store.remove_user('bob');
  });
});

describe('panel_access', () => {
  test('admin bypasses everything, non-admin default is all-except-metrics, admin panel is role-gated', () => {
    panel_access._reset();
    // admin
    assert.equal(panel_access.is_allowed('boss', 'admin', 'admin'), true);
    assert.equal(panel_access.is_allowed('boss', 'admin', 'metrics'), true);
    assert.ok(panel_access.effective_panels('boss', 'admin').includes('admin'));
    // non-admin default
    assert.equal(panel_access.is_allowed('u', 'user', 'duplicates'), true);
    assert.equal(panel_access.is_allowed('u', 'user', 'metrics'), false);  // excluded by default
    assert.equal(panel_access.is_allowed('u', 'user', 'admin'), false);    // never for non-admin
    const eff = panel_access.effective_panels('u', 'user');
    assert.ok(eff.includes('duplicates') && !eff.includes('metrics') && !eff.includes('admin'));
  });

  test('per-user override: restrict, grant-all, and clear back to default', () => {
    panel_access._reset();
    panel_access.set_user('carol', ['', 'duplicates']);      // restrict
    assert.equal(panel_access.is_allowed('carol', 'user', 'duplicates'), true);
    assert.equal(panel_access.is_allowed('carol', 'user', 'accounts'), false);
    assert.equal(panel_access.effective_panels('carol', 'user').length, 2);
    panel_access.set_user('dave', 'all');                    // grant everything (incl. metrics, not admin)
    assert.equal(panel_access.is_allowed('dave', 'user', 'metrics'), true);
    assert.equal(panel_access.is_allowed('dave', 'user', 'admin'), false);
    panel_access.clear_user('carol');                        // back to default
    assert.equal(panel_access.is_allowed('carol', 'user', 'accounts'), true);
  });

  test('set_default changes the non-admin baseline', () => {
    panel_access._reset();
    panel_access.set_default(['', 'reference']);
    assert.equal(panel_access.is_allowed('e', 'user', 'reference'), true);
    assert.equal(panel_access.is_allowed('e', 'user', 'duplicates'), false);
    panel_access.set_default('all');
    assert.equal(panel_access.is_allowed('e', 'user', 'duplicates'), true);
  });
});
