'use strict';
// Admin ops console — registry shape + the argv-assembly/guard logic that protects the run endpoint.
// Pure unit tests: assemble_argv is side-effect-free, and we only exercise start_run's guard branches that
// return BEFORE spawning (terminal-only, destruct-without-confirm), so nothing actually executes.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../admin/console_registry');
const runner = require('../admin/console_runner');

describe('console_registry', () => {
  test('ids are sequential 1..N with no gaps or duplicates', () => {
    const ids = registry.ALL.map(function (i) { return i.id; });
    ids.forEach(function (v, i) { assert.equal(v, i + 1, 'id at position ' + i); });
    assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  });

  test('every item is well-formed for its web kind', () => {
    const kinds = new Set(['run', 'form', 'terminal', 'menu']);
    registry.ALL.forEach(function (it) {
      assert.ok(kinds.has(it.web), it.action + ' has a valid web kind');
      if (it.web === 'run' || it.web === 'form') {
        assert.ok(it.bin === 'node' || it.bin === 'npm', it.action + ' has a bin');
        assert.ok(Array.isArray(it.argv) && it.argv.length, it.action + ' has argv');
      }
      if (it.web === 'terminal') assert.ok(it.note, it.action + ' (terminal) explains why it is greyed');
      (it.params || []).forEach(function (p) { assert.ok(p.name && p.type, it.action + ' param has name+type'); });
    });
  });

  test('web_sections drops terminal-only menu controls', () => {
    const flat = registry.web_sections().flatMap(function (s) { return s.items; });
    assert.ok(!flat.some(function (i) { return i.web === 'menu'; }), 'no menu-only items on the web');
    assert.ok(flat.some(function (i) { return i.action === 'metrics_stats'; }), 'stats is exposed');
  });
});

describe('console_runner.assemble_argv', () => {
  function argv(action, params) {
    const it = registry.ALL.find(function (x) { return x.action === action; });
    return runner.assemble_argv(it, params || {});
  }

  test('a no-param run command yields its base argv', () => {
    assert.deepEqual(argv('metrics_stats').argv, ['src/cli.js', 'stats']);
  });

  test('enum options append their args; int + flags compose', () => {
    const r = argv('sf_list_recent', { env: 'test', search: 'broad', limit: '30' });
    assert.deepEqual(r.argv, ['src/cli.js', 'sf:list', '--test', '--search', 'Race Results Doc,Race Results,Race,Results', '--limit', '30']);
  });

  test('a positional param is appended as a single element', () => {
    assert.deepEqual(argv('ask_sql', { sql: 'SELECT 1' }).argv, ['src/cli.js', 'ask:sql', 'SELECT 1']);
  });

  test('path traversal is rejected', () => {
    const r = argv('sf_pull', { folder: '../escape' });
    assert.equal(r.ok, false);
    assert.match(r.error, /\.\.|relative/);
  });

  test('a non-numeric int is rejected', () => {
    assert.equal(argv('sf_list_recent', { limit: 'abc' }).ok, false);
  });

  test('a required positional that is blank is rejected', () => {
    assert.equal(argv('ask_sql', { sql: '' }).ok, false);
  });
});

describe('console_runner.start_run guards (no spawn)', () => {
  function item(action) { return registry.ALL.find(function (x) { return x.action === action; }); }

  test('terminal-only commands cannot be run from the web', () => {
    const r = runner.start_run(item('server'), {});
    assert.equal(r.ok, false);
    assert.match(r.error, /terminal/);
  });

  test('destructive commands require a typed confirm equal to the id', () => {
    const purge = item('metrics_purge_all');
    assert.equal(runner.start_run(purge, {}).ok, false, 'no confirm => blocked');
    assert.match(runner.start_run(purge, {}).error, /confirm/i);
    assert.equal(runner.start_run(purge, {}, 'nope').ok, false, 'wrong confirm => blocked');
  });

  test('valid_path helper blocks absolute paths and parent escapes', () => {
    assert.equal(runner.valid_path('downloads'), true);
    assert.equal(runner.valid_path('../x'), false);
    assert.equal(runner.valid_path('/etc/passwd'), false);
    assert.equal(runner.valid_path(''), false);
  });
});
