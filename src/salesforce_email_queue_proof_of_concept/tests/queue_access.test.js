'use strict';
// Queue allow-list store: general default + per-user overrides + admin bypass. Pure (temp JSON file).
const os = require('os'); const path = require('path');
process.env.EQ_QUEUE_ACCESS_FILE = path.join(os.tmpdir(), 'eq_qa_' + Date.now() + '.json');
const test = require('node:test');
const assert = require('node:assert');
const qa = require('../store/queue_access');

function reset() { qa._reset(); try { require('fs').unlinkSync(process.env.EQ_QUEUE_ACCESS_FILE); } catch (e) {} qa._reset(); }
const QS = [{ id: '00Ga' }, { id: '00Gb' }, { id: '00Gc' }];

test('default is "all" — everyone sees every queue', function () {
  reset();
  assert.strictEqual(qa.allowed_for('jane', 'user'), 'all');
  assert.strictEqual(qa.filter_queues(QS, 'jane', 'user').length, 3);
  assert.ok(qa.is_allowed('jane', 'user', '00Gb'));
});

test('global default subset restricts non-admins', function () {
  reset();
  qa.set_default(['00Ga', '00Gb']);
  const seen = qa.filter_queues(QS, 'jane', 'user').map(function (q) { return q.id; });
  assert.deepStrictEqual(seen, ['00Ga', '00Gb']);
  assert.ok(!qa.is_allowed('jane', 'user', '00Gc'));
});

test('admins always bypass the allow-list', function () {
  reset();
  qa.set_default(['00Ga']);
  assert.strictEqual(qa.allowed_for('boss', 'admin'), 'all');
  assert.strictEqual(qa.filter_queues(QS, 'boss', 'admin').length, 3);
  assert.ok(qa.is_allowed('boss', 'admin', '00Gc'));
});

test('per-user override wins over the default', function () {
  reset();
  qa.set_default(['00Ga']);
  qa.set_user('jane', ['00Gb', '00Gc']);
  assert.deepStrictEqual(qa.allowed_for('jane', 'user'), ['00Gb', '00Gc']);
  assert.ok(qa.is_allowed('jane', 'user', '00Gc'));
  // a different user still gets the default
  assert.deepStrictEqual(qa.allowed_for('bob', 'user'), ['00Ga']);
});

test('per-user "all" re-opens everything; clear_user reverts to default', function () {
  reset();
  qa.set_default(['00Ga']);
  qa.set_user('jane', 'all');
  assert.strictEqual(qa.allowed_for('jane', 'user'), 'all');
  qa.clear_user('jane');
  assert.deepStrictEqual(qa.allowed_for('jane', 'user'), ['00Ga']);
});

test('persists across reload (new module state)', function () {
  reset();
  qa.set_default(['00Gb']);
  qa.set_user('jane', ['00Gc']);
  qa._reset(); // force reload from disk
  assert.deepStrictEqual(qa.allowed_for('jane', 'user'), ['00Gc']);
  assert.deepStrictEqual(qa.allowed_for('bob', 'user'), ['00Gb']);
});
