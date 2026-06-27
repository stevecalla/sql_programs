'use strict';
// refresh_runner — flag mapping, single-run lock, [STEP] progress parsing, and exit handling,
// using a fake spawn (no real child process / no Salesforce).
//   node --test src/salesforce_merge/tests/refresh_runner.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const refresh = require('../store/refresh_runner');

function fake_child() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.pid = 4242;
  c.kill = function () { c.killed = true; };
  return c;
}

beforeEach(() => refresh._reset());

describe('flags_for', () => {
  test('maps env x scope to the four menu modes', () => {
    assert.deepEqual(refresh.flags_for('sandbox', 'sample'), ['--test']);
    assert.deepEqual(refresh.flags_for('sandbox', 'full'), ['--test', '--full']);
    assert.deepEqual(refresh.flags_for('production', 'sample'), ['--prod', '--partial']);
    assert.deepEqual(refresh.flags_for('production', 'full'), ['--prod']);
  });
});

describe('start / status / lock', () => {
  test('spawns with mapped flags, locks out a second run, parses [STEP], records exit', () => {
    let captured = null;
    let child = null;
    const spawn = (cmd, args, opts) => { captured = { cmd, args, opts }; child = fake_child(); return child; };

    const r = refresh.start({ env: 'production', scope: 'full' }, spawn);
    assert.equal(r.ok, true);
    assert.equal(captured.cmd, 'node');
    assert.equal(captured.args[0], refresh.FINDER);
    assert.deepEqual(captured.args.slice(1), ['--prod']);
    assert.equal(refresh.status().running, true);

    // second start is rejected while one is running
    const r2 = refresh.start({ env: 'sandbox', scope: 'sample' }, spawn);
    assert.equal(r2.ok, false);

    // progress parsing
    child.stdout.emit('data', Buffer.from('[STEP] fetch — 130.4s\n[STEP] exact — 18.1s\n'));
    let s = refresh.status();
    assert.equal(s.run.steps.length, 2);
    assert.equal(s.run.steps[0].label, 'fetch');
    assert.equal(s.run.steps[0].duration, '130.4s');

    // completion
    child.emit('close', 0);
    s = refresh.status();
    assert.equal(s.running, false);
    assert.equal(s.run.exit_code, 0);
  });

  test('cancel kills the child when running, errors otherwise', () => {
    assert.equal(refresh.cancel().ok, false);          // nothing running
    let child = null;
    refresh.start({ env: 'sandbox', scope: 'sample' }, () => { child = fake_child(); return child; });
    const c = refresh.cancel();
    assert.equal(c.ok, true);
    assert.equal(child.killed, true);
  });
});
