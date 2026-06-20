'use strict';
// auth_store role support + .env recovery accounts (backs the /admin Access pane). Temp file, no DB.
const os = require('os'); const path = require('path');
process.env.EQ_USERS_FILE = path.join(os.tmpdir(), 'eq_users_' + Date.now() + '.json');
process.env.SF_EMAIL_QUEUE_ADMIN_USER = 'envadmin'; process.env.SF_EMAIL_QUEUE_ADMIN_PASS = 'fake-admin-pw';
process.env.SF_EMAIL_QUEUE_USER = 'envuser'; process.env.SF_EMAIL_QUEUE_PASS = 'fake-user-pw';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../auth/auth_store');

test('add_user stores a role; list_users returns it', function () {
  store.add_user('alice', 'secret1', null, 'admin');
  store.add_user('bob', 'secret2');                 // defaults to user
  const map = {}; store.list_users().forEach(function (u) { map[u.user] = u.role; });
  assert.strictEqual(map.alice, 'admin');
  assert.strictEqual(map.bob, 'user');
});
test('valid_user returns the stored role', function () {
  assert.strictEqual((store.valid_user('alice', 'secret1') || {}).role, 'admin');
  assert.strictEqual((store.valid_user('bob', 'secret2') || {}).role, 'user');
  assert.strictEqual(store.valid_user('alice', 'wrong'), null);
});
test('env_accounts surfaces the .env recovery accounts with roles', function () {
  const env = store.env_accounts();
  const byUser = {}; env.forEach(function (u) { byUser[u.user] = u; });
  assert.strictEqual(byUser.envadmin.role, 'admin');
  assert.strictEqual(byUser.envadmin.source, 'env');
  assert.strictEqual(byUser.envuser.role, 'user');
});
test('.env admin account still authenticates with role admin', function () {
  assert.strictEqual((store.valid_user('envadmin', 'fake-admin-pw') || {}).role, 'admin');
});
