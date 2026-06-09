'use strict';
// Legacy .xls support via SheetJS (optional). SheetJS may or may not be present (installed `xlsx`
// package, a vendored XLSX global, or neither), so these tests adapt:
//   - a provided XLSX global is always used (deterministic, no install needed);
//   - the "unsupported" path is only asserted when SheetJS is genuinely absent.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const io = require('../src/io');

describe('xls (SheetJS, optional)', () => {
  test('sheetjs_available() returns a boolean', () => {
    assert.equal(typeof io.sheetjs_available(), 'boolean');
  });

  test('reads .xls via a provided SheetJS (global XLSX) into IR rows', async () => {
    // A global XLSX always takes precedence in get_sheetjs(), so this is deterministic regardless
    // of whether the npm `xlsx` package is installed.
    const prev = global.XLSX;
    global.XLSX = {
      read: function () { return { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }; },
      utils: { sheet_to_json: function () { return [['First Name', 'Last Name'], ['Jane', 'Doe']]; } }
    };
    try {
      assert.equal(io.sheetjs_available(), true);
      const irs = await io.xls_to_irs(new ArrayBuffer(16));
      assert.equal(irs.length, 1);
      assert.equal(irs[0].sheet_name, 'Sheet1');
      assert.deepEqual(irs[0].rows[0], ['First Name', 'Last Name']);
      assert.deepEqual(irs[0].rows[1], ['Jane', 'Doe']);
    } finally {
      if (prev === undefined) delete global.XLSX; else global.XLSX = prev;
    }
  });

  test('without SheetJS, xls_to_irs fails clearly (XLS_UNSUPPORTED)', { skip: io.sheetjs_available() }, async () => {
    await assert.rejects(
      function () { return io.xls_to_irs(new ArrayBuffer(16)); },
      function (e) { return e && e.code === 'XLS_UNSUPPORTED'; }
    );
  });
});
