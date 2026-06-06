'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const io = require('../src/io');

const HEAD = ['Name', 'Gender', 'DOB', 'State', 'Category', 'Finish Time'];

async function two_sheet_book() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Sprint');
  a.addRow(HEAD); a.addRow(['John Smith', 'M', '1990-01-02', 'CA', 'Elite', '01:00:00']);
  const b = wb.addWorksheet('Olympic Dist');
  b.addRow(HEAD); b.addRow(['Jane Doe', 'F', '1985-05-05', 'NV', 'Open', '01:30:00']);
  wb.addWorksheet('Blank'); // intentionally empty
  return wb.xlsx.writeBuffer();
}

describe('io_multisheet', () => {
test('read_to_irs returns one IR per non-empty worksheet (empty skipped)', async () => {
  const irs = await io.read_to_irs(await two_sheet_book());
  assert.equal(irs.length, 2);
  assert.deepEqual(irs.map((x) => x.sheet_name), ['Sprint', 'Olympic Dist']);
  assert.equal(irs[0].rows.length, 2);
});

test('read_to_ir still returns just the first sheet (back-compat)', async () => {
  const ir = await io.read_to_ir(await two_sheet_book());
  assert.equal(ir.sheet_name, 'Sprint');
});

test('sanitize_sheet_name strips illegal chars, caps at 31, dedupes', () => {
  const used = {};
  assert.equal(io.sanitize_sheet_name('A:B*C?D/E[F]', used).indexOf(':'), -1);
  assert.equal(io.sanitize_sheet_name('x'.repeat(40), {}).length, 31);
  const u = {};
  assert.equal(io.sanitize_sheet_name('Sprint', u), 'Sprint');
  assert.equal(io.sanitize_sheet_name('Sprint', u), 'Sprint (2)');
});

test('grids_to_buffer writes one worksheet per group, values as text', async () => {
  const buf = await io.grids_to_buffer([
    { name: 'Sprint', headers: ['Member Number', 'Last Name'], rows: [['2100013891', 'Smith']] },
    { name: 'Olympic Dist', headers: ['Member Number', 'Last Name'], rows: [['1-day', 'Doe']] }
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Sprint', 'Olympic Dist']);
  assert.equal(wb.worksheets[0].getRow(2).getCell(1).value, '2100013891');
  assert.equal(typeof wb.worksheets[0].getRow(2).getCell(1).value, 'string');
});

test('grid_to_buffer (single sheet) still works via grids_to_buffer', async () => {
  const buf = await io.grid_to_buffer(['Last Name'], [['Smith']]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.equal(wb.worksheets.length, 1);
  assert.equal(wb.worksheets[0].getRow(2).getCell(1).value, 'Smith');
});
test('sheets can be combined into one worksheet (rows stacked in order)', async () => {
  const pipe = require('../src/pipeline');
  const irs = await io.read_to_irs(await two_sheet_book());
  let rows = [], headers = null;
  for (const ir of irs) { const out = pipe.convert(ir, {}); headers = out.result.headers; rows = rows.concat(out.result.rows); }
  const buf = await io.grids_to_buffer([{ name: 'Combined', headers: headers, rows: rows }]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.equal(wb.worksheets.length, 1, 'combine = single worksheet');
  assert.equal(rows.length, 2, 'one athlete row per sheet in the fixture');
  assert.equal(wb.worksheets[0].rowCount, 1 + rows.length, 'header + all stacked rows');
  // last/first from each source sheet are both present
  const lastnames = wb.worksheets[0].getColumn(2).values.slice(2);
  assert.deepEqual(lastnames, ['Smith', 'Doe']);
});

});
