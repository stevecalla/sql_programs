'use strict';
// Auth unit tests (no server, no DB).  node --test src/salesforce_merge/tests/auth.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

process.env.MERGE_SESSION_SECRET = 'test-secret'; // avoid the generated-secret file in tests

const session = require('../auth/session');
const store = require('../auth/auth_store');

describe('session', () => {
  test('sign + verify round-trips a payload', () => {
    const t = session.sign({ user: 'a', role: 'admin', ts: Date.now() }, 'secret');
    const p = session.verify(t, 'secret');
    assert.equal(p.user, 'a');
    assert.equal(p.role, 'admin');
  });

  test('verify rejects wrong secret, tampered, and garbage tokens', () => {
    const t = session.sign({ user: 'a', ts: Date.now() }, 'secret');
    assert.equal(session.verify(t, 'other-secret'), null);
    assert.equal(session.verify(t + 'x', 'secret'), null);
    assert.equal(session.verify('garbage', 'secret'), null);
    assert.equal(session.verify('', 'secret'), null);
  });

  test('verify rejects an expired token', () => {
    const old = Date.now() - (13 * 60 * 60 * 1000); // older than MAX_AGE_MS (12h)
    const t = session.sign({ user: 'a', ts: old }, 'secret');
    assert.equal(session.verify(t, 'secret'), null);
  });

  test('parse_cookies finds the session cookie', () => {
    const c = session.parse_cookies('foo=1; merge_session=xyz; bar=2');
    assert.equal(c.merge_session, 'xyz');
  });
});

describe('auth_store.valid_user', () => {
  test('matches the .env admin and rejects everything else', () => {
    process.env.MERGE_ADMIN_USER = 'admin';
    process.env.MERGE_ADMIN_PASS = 'pw';
    assert.deepEqual(store.valid_user('admin', 'pw'), { user: 'admin', role: 'admin' });
    assert.equal(store.valid_user('admin', 'wrong'), null);
    assert.equal(store.valid_user('nobody', 'pw'), null);
    assert.equal(store.valid_user('', ''), null);
    assert.equal(store.login_configured(), true);
  });
});
