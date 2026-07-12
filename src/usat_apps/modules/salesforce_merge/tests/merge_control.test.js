'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ctrl = require('../store/merge_control');

test('request flags a run, is_cancelled reflects it, clear removes it', () => {
  assert.equal(ctrl.is_cancelled('run-A'), false);
  ctrl.request('run-A');
  assert.equal(ctrl.is_cancelled('run-A'), true);
  assert.equal(ctrl.is_cancelled('run-B'), false); // independent per run id
  ctrl.clear('run-A');
  assert.equal(ctrl.is_cancelled('run-A'), false);
});

test('null/undefined ids are inert', () => {
  assert.equal(ctrl.is_cancelled(null), false);
  assert.equal(ctrl.is_cancelled(undefined), false);
  ctrl.request(null); // no throw, nothing flagged
  assert.equal(ctrl.is_cancelled(null), false);
});
