'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const match = require('../src/match');

describe('match', () => {
test('finish time wins over split columns', () => {
  const headers = ['Place', 'USAT Member #', 'Last Name', 'First Name', 'Gender', 'DOB',
    'Email', 'Address', 'City', 'State', 'Zip', 'Leg 1 Time', 'Transition 1 Time',
    'Leg 2 Time', 'Category', 'Final Time'];
  const { mapping } = match.auto_map(headers);
  assert.equal(mapping.recorded_time.source, 'Final Time');
  assert.equal(mapping.member_number.source, 'USAT Member #');
  assert.equal(mapping.last_name.source, 'Last Name');
});

test('Age Group beats Race / Division for Category', () => {
  const headers = ['Bib', 'First Name', 'Last Name', 'Gender', 'Age Group',
    'Race / Division', 'Gun Time', 'Date of Birth', 'State', 'Zip Code'];
  const { mapping } = match.auto_map(headers);
  assert.equal(mapping.category.source, 'Age Group');
  assert.equal(mapping.recorded_time.source, 'Gun Time');
  assert.equal(mapping.dob.source, 'Date of Birth');
  assert.equal(mapping.zip.source, 'Zip Code');
});

test('split/segment columns never map to recorded_time', () => {
  const headers = ['Name', 'Bike Time', 'Swim Time', 'Run Time', 'T1 Time'];
  const { mapping } = match.auto_map(headers);
  assert.equal(mapping.recorded_time.source, null);
});

test('name order independence', () => {
  const a = match.auto_map(['First Name', 'Last Name']).mapping;
  const b = match.auto_map(['Last Name', 'First Name']).mapping;
  assert.equal(a.first_name.source, 'First Name');
  assert.equal(a.last_name.source, 'Last Name');
  assert.equal(b.first_name.source, 'First Name');
  assert.equal(b.last_name.source, 'Last Name');
});

test('a single full-name column splits into First + Last', () => {
  const m = match.auto_map(['Name', 'Gender', 'DOB', 'Category', 'Finish Time']).mapping;
  assert.equal(m.first_name.split, 'first');
  assert.equal(m.last_name.split, 'last');
  assert.equal(m.first_name.source, 'Name');
  assert.equal(m.last_name.source, 'Name');
});

test('dedicated First/Last columns are not treated as a split', () => {
  const m = match.auto_map(['First Name', 'Last Name', 'Gender']).mapping;
  assert.ok(!m.first_name.split);
  assert.ok(!m.last_name.split);
  assert.equal(m.last_name.source, 'Last Name');
});
});
