'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const io = require('../src/io');

describe('io', () => {
test('grid_to_buffer -> read_to_ir round-trips text cells', async () => {
  const headers = ['Member Number', 'Recorded Time'];
  const rows = [['1-day', '01:04:28.000'], ['2100013891', '01:12:57.000']];
  const buf = await io.grid_to_buffer(headers, rows);
  const ir = await io.read_to_ir(Buffer.from(buf));
  assert.deepEqual(ir.rows[0], headers);
  assert.deepEqual(ir.rows[1], rows[0]);
  assert.deepEqual(ir.rows[2], rows[1]);
  // member number preserved as text (no scientific notation / number coercion)
  assert.equal(ir.rows[2][0], '2100013891');
});

test('grid_to_csv quotes fields with comma/quote/newline and keeps numbers as text', () => {
  const csv = io.grid_to_csv(['Member Number', 'Last Name', 'Note'],
    [['2100213562', "O'Brien", 'plain'], ['1-day', 'Smith, Jr.', 'line1\nline2'], ['', 'Quote "x"', null]]);
  // rows join with CRLF; the embedded \n lives INSIDE a quoted field, so splitting on \r\n
  // keeps that field on one line.
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 4, 'header + 3 data rows');
  assert.equal(lines[0], 'Member Number,Last Name,Note');
  assert.equal(lines[1], "2100213562,O'Brien,plain");           // long number stays as text, no quoting
  assert.equal(lines[2], '1-day,"Smith, Jr.","line1\nline2"');  // comma + embedded newline quoted, kept intact
  assert.equal(lines[3], ',"Quote ""x""",');                    // embedded quotes doubled, trailing empty field
});

test('grid_to_csv excel_safe_cols wraps the chosen columns as ="..." (Excel keeps the format)', () => {
  const headers = ['First Name', 'DOB', 'Recorded Time'];
  const rows = [['Ann', '01/15/1990', '00:59:59.000']];
  const csv = io.grid_to_csv(headers, rows, { excel_safe_cols: [1, 2] });
  const line = csv.split('\r\n')[1];
  // wrapped cells become ="value", then CSV-quoted -> "=""value"""
  assert.equal(line, 'Ann,"=""01/15/1990""","=""00:59:59.000"""');
  // without the option, behaviour is unchanged
  assert.equal(io.grid_to_csv(headers, rows).split('\r\n')[1], 'Ann,01/15/1990,00:59:59.000');
  // empty cells are not wrapped
  assert.equal(io.grid_to_csv(['DOB'], [['']], { excel_safe_cols: [0] }).split('\r\n')[1], '');
});

test('grid_to_csv round-trips back through csv_to_ir', () => {
  const headers = ['First Name', 'Last Name', 'City'];
  const rows = [['Ann', 'Lee', 'San Jose'], ['Bo', 'Ng', 'Reno, NV']];
  const ir = io.csv_to_ir(io.grid_to_csv(headers, rows));
  assert.deepEqual(ir.rows[0], headers);
  assert.deepEqual(ir.rows[2], rows[1]);   // the comma-containing city survived the quote/parse round-trip
});

test('flatten_cell unwraps hyperlink + rich-text cells (no "[object Object]")', () => {
  const f = io.flatten_cell;
  // a styled email link reads from exceljs as { text: { richText: [...] }, hyperlink: 'mailto:...' }
  assert.equal(f({ text: { richText: [{ font: {}, text: 'arnoldqueral@gmail.com' }] }, hyperlink: 'mailto:arnoldqueral@gmail.com' }), 'arnoldqueral@gmail.com');
  assert.equal(f({ text: 'bob@x.com', hyperlink: 'mailto:bob@x.com' }), 'bob@x.com');     // plain-string label
  assert.equal(f({ hyperlink: 'mailto:cleo@y.com?subject=hi' }), 'cleo@y.com');            // no label → de-mailto'd URL
  assert.equal(f({ richText: [{ text: 'Los ' }, { text: 'Gatos' }] }), 'Los Gatos');       // plain rich text
  assert.equal(f({ formula: 'A1', result: '95123' }), '95123');                            // formula result
  assert.equal(f('plain'), 'plain');
  assert.equal(f(194), 194);
  assert.equal(f(null), null);
});
});
