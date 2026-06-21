'use strict';
// Operations console (admin) — registry shape + the runner's param/argv assembly and confirm guard.
// Pure: assemble_argv and the guard paths don't spawn anything; we never start a real 'run' here.
const test = require('node:test');
const assert = require('node:assert');
const registry = require('../admin/console_registry');
const runner = require('../admin/console_runner');

test('registry ids are sequential 1..N and unique', function () {
  const ids = registry.ALL.map(function (it) { return it.id; });
  for (let i = 0; i < ids.length; i++) assert.strictEqual(ids[i], i + 1, 'id at position ' + i + ' should be ' + (i + 1));
  assert.strictEqual(new Set(ids).size, ids.length, 'ids must be unique');
});

test('every item has the required fields; runnable items declare bin+argv', function () {
  registry.ALL.forEach(function (it) {
    assert.ok(it.action && it.label && it.desc, 'item ' + it.id + ' needs action/label/desc');
    assert.ok(['run', 'form', 'terminal'].indexOf(it.web) >= 0, 'item ' + it.id + ' web must be run|form|terminal');
    if (it.web === 'run' || it.web === 'form') {
      assert.strictEqual(it.bin, 'node', 'runnable item ' + it.id + ' must use bin node');
      assert.ok(Array.isArray(it.argv) && it.argv.length, 'runnable item ' + it.id + ' needs argv');
    }
  });
});

test('by_id + web_sections', function () {
  assert.strictEqual(registry.by_id(1).action, 'test_all');
  assert.strictEqual(registry.by_id(9999), null);
  const secs = registry.web_sections();
  assert.ok(Array.isArray(secs) && secs.length >= 1);
  assert.ok(secs.every(function (s) { return Array.isArray(s.items) && s.items.length; }));
});

test('assemble_argv: enum option args + positional text are appended', function () {
  const ask = registry.ALL.find(function (it) { return it.action === 'metrics_ask'; });
  const r = runner.assemble_argv(ask, { question: 'how many calls?', provider: 'openai' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.argv, ['metrics/metrics_cli.js', 'ask', 'how many calls?', '--provider', 'openai']);
  // default provider ('default') contributes no args
  const r2 = runner.assemble_argv(ask, { question: 'x' });
  assert.deepStrictEqual(r2.argv, ['metrics/metrics_cli.js', 'ask', 'x']);
});

test('assemble_argv: required field missing is rejected', function () {
  const ask = registry.ALL.find(function (it) { return it.action === 'metrics_ask'; });
  const r = runner.assemble_argv(ask, { question: '' });
  assert.strictEqual(r.ok, false);
});

test('valid_path rejects traversal and absolute paths', function () {
  assert.strictEqual(runner.valid_path('sub/dir'), true);
  assert.strictEqual(runner.valid_path('../escape'), false);
  assert.strictEqual(runner.valid_path('/etc/passwd'), false);
  assert.strictEqual(runner.valid_path(''), false);
});

test('start_run guards: unknown id, terminal-only, and destructive without confirm — none spawn', function () {
  assert.strictEqual(runner.start_run(null, {}, undefined).ok, false);
  const terminal_item = registry.ALL.find(function (it) { return it.web === 'terminal'; });
  assert.strictEqual(runner.start_run(terminal_item, {}, undefined).ok, false);
  const destruct = registry.ALL.find(function (it) { return it.klass === 'destruct'; });
  const r = runner.start_run(destruct, {}, undefined);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /confirmation/);
});
