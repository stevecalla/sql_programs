'use strict';
process.env.EQ_USERS_FILE = require('os').tmpdir() + '/eq_users_' + Date.now() + '.json';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../auth/auth_store');
const session = require('../auth/session');

test('password hash + verify (timing-safe)', function () {
  const h = store.hash_password('s3cret!');
  assert.ok(store.verify_password('s3cret!', h));
  assert.ok(!store.verify_password('wrong', h));
});
test('add_user then valid_user', function () {
  store.add_user('carlie', 'pw12345', 'carlie@usatriathlon.org');
  assert.ok(store.valid_user('carlie', 'pw12345'));
  assert.strictEqual(store.valid_user('carlie', 'nope'), null);
});
test('signed cookie round-trips and rejects tampering', function () {
  const secret = 'test-secret';
  const t = session.sign({ user: 'x', ts: Date.now() }, secret);
  assert.ok(session.verify(t, secret));
  assert.strictEqual(session.verify(t + 'x', secret), null);
  assert.strictEqual(session.verify(t, 'other-secret'), null);
});
test('expired cookie rejected', function () {
  const secret = 'test-secret';
  const t = session.sign({ user: 'x', ts: Date.now() - (24 * 60 * 60 * 1000) }, secret);
  assert.strictEqual(session.verify(t, secret), null);
});
