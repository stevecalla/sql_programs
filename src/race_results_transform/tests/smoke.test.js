'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', 'src');
const MODS = ['schema', 'normalize', 'display', 'parse', 'match', 'transform', 'reconcile', 'mapping', 'pipeline', 'io'];

test('every engine file parses as valid JS', () => {
  MODS.forEach((m) => {
    const src = fs.readFileSync(path.join(ENGINE, m + '.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: m + '.js' }), m + ' should parse');
  });
});

test('every engine module loads and exports an object', () => {
  MODS.forEach((m) => {
    const mod = require(path.join(ENGINE, m));
    assert.equal(typeof mod, 'object', m + ' exports object');
  });
});

test('schema has all 12 template columns in order', () => {
  const schema = require(path.join(ENGINE, 'schema'));
  assert.equal(schema.TEMPLATE_SCHEMA.length, 12);
  assert.deepEqual(schema.TARGET_HEADERS, [
    'Member Number', 'Last Name', 'First Name', 'Gender', 'DOB', 'Email',
    'Address', 'City', 'State', 'Zip', 'Category', 'Recorded Time'
  ]);
  // exactly one finish-time column
  assert.equal(schema.TEMPLATE_SCHEMA.filter((c) => c.is_time_total).length, 1);
});
