'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../src/parse');
const pipe = require('../src/pipeline');

function ir_from(headers, rows) { return { sheet_name: 'S', rows: [headers].concat(rows) }; }

test('row count ties out and dividers are skipped', () => {
  const headers = ['USAT Member #', 'Last Name', 'First Name', 'Gender', 'DOB', 'Email', 'State', 'Zip', 'Category', 'Final Time'];
  const data = [
    ['Open Division'], // divider (1 non-empty)
    ['100', 'Smith', 'Al', 'M', '1990-01-01', 'a@b.com', 'California', '90001', 'Open', '01:00:00'],
    ['', 'Jones', 'Bo', 'f', '1985-05-05', 'c@d.com', 'TX', '70001', 'Open', '01:10:00']
  ];
  const { parsed, report } = pipe.convert(ir_from(headers, data), {});
  assert.equal(parsed.skipped.length, 1);
  assert.equal(parsed.skipped[0].reason, 'section-divider');
  assert.equal(report.rows.in, 2);
  assert.equal(report.rows.out, 2);
});

test('column ledger accounts for every source column', () => {
  const headers = ['Place', 'USAT Member #', 'Last Name', 'First Name', 'Gender', 'DOB', 'Email', 'State', 'Zip', 'Leg 1 Time', 'Category', 'Final Time'];
  const data = [['1.', '100', 'Smith', 'Al', 'M', '1990-01-01', 'a@b.com', 'CA', '90001', '00:10:00', 'Open', '01:00:00']];
  const { report } = pipe.convert(ir_from(headers, data), {});
  assert.equal(report.ledger.length, headers.length);
  const place = report.ledger.find((l) => l.header === 'Place');
  const leg = report.ledger.find((l) => l.header === 'Leg 1 Time');
  assert.equal(place.disposition, 'dropped-not-template');
  assert.equal(leg.disposition, 'dropped-split');
});

test('pass-through values are preserved', () => {
  const headers = ['Last Name', 'First Name', 'Email', 'Zip', 'Gender', 'DOB', 'State', 'Category', 'Final Time'];
  const data = [
    ['Smith', 'Al', 'a@b.com', '90001', 'M', '1990-01-01', 'CA', 'Open', '01:00:00'],
    ['Jones', 'Bo', 'c@d.com', '70001', 'F', '1985-05-05', 'TX', 'Open', '01:10:00']
  ];
  const { report } = pipe.convert(ir_from(headers, data), {});
  const email = report.preservation.find((p) => p.key === 'email');
  assert.equal(email.ok, true);
  assert.equal(email.missing, 0);
});

test('schema-complete output even when columns are missing', () => {
  const headers = ['Last Name', 'First Name', 'Final Time'];
  const data = [['Smith', 'Al', '01:00:00']];
  const { result } = pipe.convert(ir_from(headers, data), {});
  assert.equal(result.headers.length, 12);
  assert.equal(result.rows[0].length, 12);
  // member defaults to 1-day when no source
  assert.equal(result.rows[0][0], '1-day');
});
