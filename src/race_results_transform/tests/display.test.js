'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const display = require('../src/display');
const io = require('../src/io');
const parse = require('../src/parse');
const data_dir = require('../data_dir');

async function inputs_dir() { try { return await data_dir.inputs(); } catch (e) { return null; } }

describe('display', () => {
test('Excel time values render as times, not dates', () => {
  assert.equal(display.cell_text(new Date(Date.UTC(1899, 11, 30, 1, 41, 53, 240))), '01:41:53.240');
  assert.equal(display.cell_text(new Date(Date.UTC(1899, 11, 30, 0, 49, 29, 300))), '00:49:29.300');
  assert.equal(display.cell_text(new Date(Date.UTC(1899, 11, 30, 1, 4, 28, 0))), '01:04:28');
});

test('calendar dates (DOB) render as mm/dd/yyyy', () => {
  assert.equal(display.cell_text(new Date(Date.UTC(1992, 8, 1))), '09/01/1992');
  assert.equal(display.cell_text(new Date(Date.UTC(1978, 0, 2))), '01/02/1978');
});

test('strings, numbers, and blanks pass through sensibly', () => {
  assert.equal(display.cell_text('Penado'), 'Penado');
  assert.equal(display.cell_text(1049), '1049');
  assert.equal(display.cell_text(''), '');
  assert.equal(display.cell_text(null), '');
  assert.equal(display.cell_text('2100013891'), '2100013891');
});

test('no original-table cell renders as an Excel-epoch date', async () => {
  const INPUTS = await inputs_dir();
  if (!INPUTS) { console.log('  (data dir unavailable — skipped)'); return; }
  const list = fs.readdirSync(INPUTS).filter((x) => /\.(xlsx|csv)$/i.test(x));
  if (list.length === 0) { console.log('  (no inputs — skipped)'); return; }
  for (const f of list) {
    const ir = /\.csv$/i.test(f) ? io.csv_to_ir(fs.readFileSync(path.join(INPUTS, f), 'utf8')) : await io.read_to_ir(path.join(INPUTS, f));
    parse.detect_table(ir).data_rows.forEach((dr) => dr.cells.forEach((v) => {
      const txt = display.cell_text(v);
      assert.ok(!/18\d\d|1900/.test(txt) || !(v instanceof Date), 'epoch date leaked for ' + f + ': ' + txt);
    }));
  }
});

test('finish-time columns display in time format', async () => {
  const INPUTS = await inputs_dir();
  if (!INPUTS) return;
  const TIME = /^\d{2}:\d{2}:\d{2}(\.\d{3})?$/;
  const list = fs.readdirSync(INPUTS).filter((x) => /\.xlsx$/i.test(x));
  if (list.length === 0) return;
  for (const f of list) {
    const parsed = parse.detect_table(await io.read_to_ir(path.join(INPUTS, f)));
    const tcol = parsed.headers.findIndex((h) => /gun time|final time/i.test(h));
    if (tcol < 0) continue;
    let checked = 0;
    for (const dr of parsed.data_rows) {
      const raw = dr.cells[tcol];
      if (raw == null || raw === '') continue;
      assert.ok(TIME.test(display.cell_text(raw)), f + ' finish time not a time: ' + display.cell_text(raw));
      if (++checked >= 20) break;
    }
  }
});
});
