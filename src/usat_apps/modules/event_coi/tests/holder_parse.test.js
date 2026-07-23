'use strict';
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { mapRows, parseCsvText, parseWorkbookBuffer, normHeader } = require('../store/holder_parse');

test('mapRows maps canonical headers', () => {
  const rows = [
    ['Name', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Zip', 'Email'],
    ['Jane Testerson', '100 Sample St', '', 'Testville', 'CO', '80000', 'jane@example.com'],
  ];
  assert.deepStrictEqual(mapRows(rows), [
    { name: 'Jane Testerson', address: '100 Sample St', city: 'Testville', state: 'CO', zip: '80000', email: 'jane@example.com' },
  ]);
});

test('fuzzy headers: ST -> state, Postal Code -> zip, Holder Name -> name, Email Address -> email', () => {
  const rows = [
    ['Holder Name', 'Address', 'City', 'ST', 'Postal Code', 'Email Address'],
    ['Acme LLC', '200 Placeholder Rd', 'Faketown', 'CO', '80001', 'a@b.com'],
  ];
  const h = mapRows(rows)[0];
  assert.strictEqual(h.name, 'Acme LLC');
  assert.strictEqual(h.state, 'CO');
  assert.strictEqual(h.zip, '80001');
  assert.strictEqual(h.email, 'a@b.com');
});

test('Address Line 1 + Line 2 combine into one Address', () => {
  const rows = [['Name', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Zip'], ['X', '100 Main', 'Suite 4', 'Town', 'CO', '80000']];
  assert.strictEqual(mapRows(rows)[0].address, '100 Main Suite 4');
});

test('blank rows dropped; missing columns tolerated', () => {
  const rows = [['Name', 'City'], ['', ''], ['Bob', 'Denver']];
  const out = mapRows(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Bob');
  assert.strictEqual(out[0].email, '');
});

test('unknown columns ignored', () => {
  const rows = [['Name', 'Random', 'Email'], ['Bob', 'junk', 'b@x.com']];
  const h = mapRows(rows)[0];
  assert.strictEqual(h.name, 'Bob');
  assert.strictEqual(h.email, 'b@x.com');
});

test('normHeader strips punctuation/case/space', () => {
  assert.strictEqual(normHeader('  Zip Code '), 'zipcode');
  assert.strictEqual(normHeader('Holder Name *'), 'holdername');
});

test('parseCsvText handles quoted commas', () => {
  const csv = 'Name,Address,City,State,Zip,Email\n"Doe, John","1 A St, Apt 2",Town,CO,80000,j@x.com';
  const h = parseCsvText(csv)[0];
  assert.strictEqual(h.name, 'Doe, John');
  assert.strictEqual(h.address, '1 A St, Apt 2');
});

test('parseWorkbookBuffer reads the MASTER sheet', () => {
  const wb = XLSX.utils.book_new();
  const other = XLSX.utils.aoa_to_sheet([['x'], ['y']]);
  XLSX.utils.book_append_sheet(wb, other, 'KEY CONTACTS');
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'City', 'State', 'Zip', 'Email'], ['Jane', 'Town', 'CO', '80000', 'j@x.com']]);
  XLSX.utils.book_append_sheet(wb, ws, 'MASTER');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const { sheet, holders } = parseWorkbookBuffer(buf);
  assert.strictEqual(sheet, 'MASTER');
  assert.strictEqual(holders.length, 1);
  assert.strictEqual(holders[0].name, 'Jane');
  assert.strictEqual(holders[0].zip, '80000');
});
