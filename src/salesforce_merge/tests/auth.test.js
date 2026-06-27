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

const session = require('../auth/session');
const store = require('../auth/auth_store');

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
  test('matches the .env admin and rejects everything else', () => {
    const pass = crypto.randomBytes(12).toString('hex');
    process.env.MERGE_ADMIN_USER = 'admin';
    process.env.MERGE_ADMIN_PASS = pass;
    assert.deepEqual(store.valid_user('admin', pass), { user: 'admin', role: 'admin' });
    assert.equal(store.valid_user('admin', 'wrong'), null);
    assert.equal(store.valid_user('nobody', pass), null);
    assert.equal(store.valid_user('', ''), null);
    assert.equal(store.login_configured(), true);
  });
});
