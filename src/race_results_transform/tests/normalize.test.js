'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/normalize');

test('gender normalizes case and words', () => {
  assert.equal(N.n_gender('m').value, 'M');
  assert.equal(N.n_gender('Female').value, 'F');
  assert.equal(N.n_gender('NB').value, 'NB');
  assert.equal(N.n_gender('non-binary').value, 'NB');
  assert.equal(N.n_gender('').flag, 'gender-missing');
  assert.equal(N.n_gender('a').flag, 'gender-unknown');
});

test('DOB renders mm/dd/yyyy from Date, ISO, and 2-digit-year', () => {
  assert.equal(N.n_dob(new Date(Date.UTC(1992, 8, 1))).value, '09/01/1992');
  assert.equal(N.n_dob('1992-09-01').value, '09/01/1992');
  assert.equal(N.n_dob('4/21/98').value, '04/21/1998');
  assert.equal(N.n_dob('').flag, 'dob-missing');
});

test('time renders hh:mm:ss.000 from Date, string, mm:ss, and fraction', () => {
  assert.equal(N.n_time(new Date(Date.UTC(1899, 11, 30, 1, 41, 53, 240))).value, '01:41:53.240');
  assert.equal(N.n_time('01:04:28').value, '01:04:28.000');
  assert.equal(N.n_time('49:29.3').value, '00:49:29.300');
  assert.equal(N.n_time(0.5).value, '12:00:00.000');
  assert.equal(N.n_time('').flag, 'time-missing');
  assert.equal(N.n_time('DNS').value, 'DNS');
  assert.equal(N.n_time('dnf').value, 'DNF');
  assert.equal(N.n_time('DNS').flag, 'time-status');
});

test('state maps full names and flags foreign', () => {
  assert.equal(N.n_state('California').value, 'CA');
  assert.equal(N.n_state('ca').value, 'CA');
  assert.equal(N.n_state('New York').value, 'NY');
  assert.equal(N.n_state('BCN').flag, 'state-review');
  assert.equal(N.n_state('ON').flag, 'state-review'); // Ontario, not a US state
});

test('member keeps numeric id, else 1-day', () => {
  assert.equal(N.n_member('2100013891').value, '2100013891');
  assert.equal(N.n_member('').value, '1-day');
  assert.equal(N.n_member('').flag, 'member-default');
  assert.equal(N.n_member('Valid').value, '1-day');
  assert.equal(N.n_member('Valid').flag, 'member-nonnumeric');
});

test('category buckets into the four allowed values', () => {
  assert.equal(N.n_category('30-34 Male').value, 'Age Group');
  assert.equal(N.n_category('Elite').value, 'Elite');
  assert.equal(N.n_category('Pro').value, 'Elite');
  assert.equal(N.n_category('Para').value, 'Para');
  assert.equal(N.n_category('Relay').value, 'Relay');
  const assumed = N.n_category('Alpha Sprint');
  assert.equal(assumed.value, 'Age Group');
  assert.equal(assumed.flag, 'category-assumed');
});
