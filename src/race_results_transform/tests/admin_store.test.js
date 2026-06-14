'use strict';
// Admin overrides store — pure unit tests (no network, no DB). scrypt hashing, multi-user logins with the
// .env recovery account, config, and JSON persistence with a stable session secret.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../admin/admin_store');

function temp_file() {
  return path.join(os.tmpdir(), 'rrt_admin_store_' + Date.now() + '_' + Math.floor(Math.random() * 1e9) + '.json');
}

describe('admin_store', () => {
  test('scrypt hashing round-trips and never stores plaintext', () => {
    const h = store.hash_password('s3cret-pw');
    assert.ok(store.verify_password('s3cret-pw', h), 'correct password verifies');
    assert.ok(!store.verify_password('wrong', h), 'wrong password fails');
    assert.ok(h.indexOf('s3cret-pw') < 0 && h.indexOf('scrypt$') === 0, 'stored value is a salted hash, not plaintext');
  });

  test('users: add / list / validate, scoped to admin vs app', () => {
    const o = store.empty_overrides();
    store.add_user(o, 'admin', 'steve', 'pw1');
    assert.deepEqual(store.list_users(o, 'admin'), ['steve']);
    assert.ok(store.valid_login(o, 'admin', 'steve', 'pw1'), 'stored admin logs in');
    assert.ok(!store.valid_login(o, 'admin', 'steve', 'nope'), 'wrong password rejected');
    assert.ok(!store.valid_login(o, 'app', 'steve', 'pw1'), 'admin user is not an app user');
    // updating an existing user replaces the hash (no duplicate)
    store.add_user(o, 'admin', 'steve', 'pw2');
    assert.deepEqual(store.list_users(o, 'admin'), ['steve']);
    assert.ok(store.valid_login(o, 'admin', 'steve', 'pw2') && !store.valid_login(o, 'admin', 'steve', 'pw1'), 'password updated');
  });

  test('the .env recovery account always works and cannot be removed', () => {
    const o = store.empty_overrides();
    assert.ok(store.valid_login(o, 'admin', 'envuser', 'envpass', 'envuser', 'envpass'), 'env creds validate even with no stored users');
    store.add_user(o, 'admin', 'temp', 'x');
    assert.equal(store.remove_user(o, 'admin', 'temp').ok, true, 'a stored user removes');
    assert.equal(store.remove_user(o, 'admin', 'envuser', 'envuser').ok, false, 'the env recovery account is protected');
  });

  test('non-secret config: only known keys, string-coerced', () => {
    const o = store.empty_overrides();
    store.set_config(o, { slack_default_channel: 'C123', bogus: 'ignored' });
    const c = store.get_config(o);
    assert.equal(c.slack_default_channel, 'C123');
    assert.ok(!('bogus' in c), 'unknown keys are not persisted');
  });

  test('persistence: write/read round-trip + a stable session secret', () => {
    const file = temp_file();
    const o = store.load_or_init(file);
    assert.ok(o.session_secret && o.session_secret.length > 20, 'a session secret is generated on first load');
    store.add_user(o, 'app', 'amy', 'pw');
    store.write_overrides(file, o);
    const o2 = store.read_overrides(file);
    assert.deepEqual(store.list_users(o2, 'app'), ['amy'], 'users persist');
    assert.equal(o2.session_secret, o.session_secret, 'the session secret is stable across writes');
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  });

  test('per-user capabilities: stored caps drive access; legacy users default by scope', () => {
    const o = store.empty_overrides();
    store.add_user(o, 'admin', 'amy', 'pw', ['metrics']);           // metrics-only
    store.add_user(o, 'app', 'ivan', 'pw', ['intake']);            // intake-only
    store.add_user(o, 'admin', 'leg', 'pw');                       // no caps passed -> default (admin scope = all)
    assert.deepEqual(store.user_caps(o, 'amy'), ['metrics'], 'stored caps are honored');
    assert.deepEqual(store.user_caps(o, 'ivan'), ['intake']);
    assert.deepEqual(store.user_caps(o, 'leg'), ['admin', 'metrics', 'intake'], 'legacy admin user defaults to all caps');
    assert.equal(store.user_caps(o, 'nobody').length, 0, 'unknown user has no caps');
    const ok = store.valid_user(o, 'amy', 'pw');
    assert.deepEqual(ok && ok.caps, ['metrics'], 'valid_user returns the user + caps');
    assert.equal(store.valid_user(o, 'amy', 'wrong'), null, 'wrong password rejected');
    assert.deepEqual(store.list_users_with_caps(o, 'admin').find(function (u) { return u.user === 'amy'; }).caps, ['metrics']);
  });
});
