'use strict';
// Phase 3 — pm2 scale control: the pure bounds/command builders (the exec itself isn't unit-tested).
const test = require('node:test');
const assert = require('node:assert');
const pm2 = require('../store/pm2_control');

test('clamp_n bounds the instance count to 1..8', () => {
  assert.equal(pm2.clamp_n(4), 4);
  assert.equal(pm2.clamp_n(0), 1);      // floor
  assert.equal(pm2.clamp_n(99), 8);     // ceil
  assert.equal(pm2.clamp_n('3'), 3);    // numeric string
  assert.equal(pm2.clamp_n('x'), null); // not a number
  assert.equal(pm2.clamp_n(null), null);
});

test('scale_command always uses a clamped value + the configured process name', () => {
  assert.equal(pm2.scale_command(4), 'npx pm2 scale ' + pm2.PROC + ' 4');
  assert.equal(pm2.scale_command(99), 'npx pm2 scale ' + pm2.PROC + ' 8'); // clamped, never unbounded
  assert.equal(pm2.scale_command('bad'), null);
});
