'use strict';
// csv_sniff.js — delimiter detection + "CSV of a CSV" unwrap, and the io.csv_to_ir integration that uses it.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sniff = require('../src/csv_sniff');
const io = require('../src/io');

describe('csv_sniff.sniff_delimiter', () => {
  test('detects comma / semicolon / tab / pipe', () => {
    assert.equal(sniff.sniff_delimiter('a,b,c\n1,2,3'), ',');
    assert.equal(sniff.sniff_delimiter('a;b;c\n1;2;3'), ';');
    assert.equal(sniff.sniff_delimiter('a\tb\tc\n1\t2\t3'), '\t');
    assert.equal(sniff.sniff_delimiter('a|b|c\n1|2|3'), '|');
  });
  test('a single-column file falls back to comma (never disturbed)', () => {
    assert.equal(sniff.sniff_delimiter('one\ntwo\nthree'), ',');
  });
  test('a delimiter inside quotes is not counted', () => {
    assert.equal(sniff.sniff_delimiter('"a;b",c\n"x;y",z'), ',');   // the ; is inside quotes → comma wins
  });
});

describe('csv_sniff.looks_double_encoded', () => {
  test('single-column rows with a consistent inner delimiter -> that delimiter', () => {
    const rows = [['USAT Member #;"Last Name";"First Name"'], ['101;"Lee";"Amy"'], ['202;"Kim";"Bob"']];
    assert.equal(sniff.looks_double_encoded(rows), ';');
  });
  test('a genuine single-column list is NOT flagged', () => {
    assert.equal(sniff.looks_double_encoded([['a@x.com'], ['b@y.com'], ['c@z.com']]), null);
  });
  test('already-multi-column rows are not flagged', () => {
    assert.equal(sniff.looks_double_encoded([['a', 'b', 'c'], ['1', '2', '3']]), null);
  });
});

describe('io.csv_to_ir (smart CSV read)', () => {
  test('a normal comma CSV parses unchanged, no note', () => {
    const ir = io.csv_to_ir('Member Number,First Name\n101,Amy\n');
    assert.deepEqual(ir.rows, [['Member Number', 'First Name'], ['101', 'Amy']]);
    assert.equal(ir.csv_note, undefined);
  });
  test('a semicolon-delimited CSV splits into columns + notes it', () => {
    const ir = io.csv_to_ir('Member Number;First Name\n101;Amy\n');
    assert.deepEqual(ir.rows, [['Member Number', 'First Name'], ['101', 'Amy']]);
    assert.match(ir.csv_note, /semicolon/);
  });
  test('a pipe-delimited CSV splits into columns', () => {
    const ir = io.csv_to_ir('Member Number|First Name\n101|Amy\n');
    assert.deepEqual(ir.rows, [['Member Number', 'First Name'], ['101', 'Amy']]);
    assert.match(ir.csv_note, /pipe/);
  });
  test('the double-encoded (Aquabike) shape is unwrapped into columns + noted', () => {
    const de = '"USAT Member #;""Last Name"";""First Name"""\n' +
               '"2100382197;""Stevens"";""Jill"""\n' +
               '"809892345;""Deane"";""Benjamin"""\n';
    const ir = io.csv_to_ir(de);
    assert.deepEqual(ir.rows[0], ['USAT Member #', 'Last Name', 'First Name']);
    assert.deepEqual(ir.rows[1], ['2100382197', 'Stevens', 'Jill']);
    assert.match(ir.csv_note, /unwrapped|re-wrapped/i);
  });
});
