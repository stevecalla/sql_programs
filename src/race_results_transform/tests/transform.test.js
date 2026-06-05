'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pipe = require('../src/pipeline');

function ir(headers, rows) { return { sheet_name: 'S', rows: [headers].concat(rows) }; }
const HEAD = ['Last Name', 'First Name', 'Gender', 'DOB', 'Email', 'City', 'State', 'Zip', 'Category', 'Final Time', 'USAT membership'];

test('value override changes output and clears that cell flag', () => {
  const rows = [['Smith', 'Al', 'M', '1990-01-01', 'a@b.com', 'Reno', 'NV', '89501', 'Alpha Sprint', '01:00:00', 'Valid']];
  const base = pipe.convert(ir(HEAD, rows), {});
  const ci = base.result.headers.indexOf('Category');
  assert.equal(base.result.rows[0][ci], 'Age Group');
  assert.ok(base.result.flags.some((f) => f.key === 'category' && f.code === 'category-assumed'));
  const ov = pipe.convert(ir(HEAD, rows), { value_overrides: { category: { 'alpha sprint': 'Relay' } } });
  assert.equal(ov.result.rows[0][ci], 'Relay');
  assert.ok(!ov.result.flags.some((f) => f.key === 'category'));
});

test('member distinct exposes non-numeric values; override sets a real number', () => {
  const rows = [
    ['Smith', 'Al', 'M', '1990-01-01', 'a@b.com', 'Reno', 'NV', '89501', '30-34 Male', '01:00:00', 'Valid'],
    ['Jones', 'Bo', 'F', '1985-05-05', 'c@d.com', 'Reno', 'NV', '89501', '30-34 Female', '01:10:00', 'Bronze']
  ];
  const base = pipe.convert(ir(HEAD, rows), {});
  const d = base.result.distinct.member_number;
  assert.equal(d['valid'].sample, 'Valid');
  assert.equal(d['valid'].bucket, '1-day');
  const ov = pipe.convert(ir(HEAD, rows), { value_overrides: { member_number: { 'valid': '12345' } } });
  const mi = ov.result.headers.indexOf('Member Number');
  assert.equal(ov.result.rows[0][mi], '12345');
});
