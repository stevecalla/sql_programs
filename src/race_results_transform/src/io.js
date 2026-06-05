/**
 * io.js — Excel <-> intermediate-representation (IR) adapter.
 *
 * Isomorphic: in Node it requires the `exceljs` package; in the browser it
 * uses the globally-loaded `ExcelJS` (vendored at public/vendor/exceljs.min.js).
 * The rest of the engine never touches ExcelJS directly — it only sees the IR:
 *
 *   IR = { sheet_name: string, rows: Cell[][] }
 *   Cell = string | number | Date | boolean | null
 *
 * read_to_ir(input)  -> Promise<IR>     input: ArrayBuffer | Buffer | filepath(string, Node only)
 * grid_to_buffer(headers, rows) -> Promise<Buffer|Uint8Array>   all-text cells
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('exceljs'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.io = factory(root.ExcelJS);
  }
}(typeof self !== 'undefined' ? self : this, function (ExcelJS) {
  'use strict';

  // Flatten an ExcelJS cell value into a plain Cell.
  function flatten_cell(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    var t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'object') {
      // rich text
      if (Array.isArray(v.richText)) {
        return v.richText.map(function (r) { return r.text; }).join('');
      }
      // hyperlink { text, hyperlink }
      if (typeof v.text === 'string') return v.text;
      // formula { formula, result }
      if ('result' in v) return flatten_cell(v.result);
      if ('error' in v) return null;
    }
    return String(v);
  }

  async function load_workbook(input) {
    var wb = new ExcelJS.Workbook();
    if (typeof input === 'string') {
      // Node filepath
      await wb.xlsx.readFile(input);
    } else if (input && input.buffer && !(input instanceof ArrayBuffer)) {
      // typed array (e.g. Uint8Array) -> underlying buffer
      await wb.xlsx.load(input);
    } else {
      await wb.xlsx.load(input);
    }
    return wb;
  }

  async function read_to_ir(input) {
    var wb = await load_workbook(input);
    var ws = wb.worksheets[0];
    var rows = [];
    if (ws) {
      var max_col = ws.columnCount || 0;
      ws.eachRow({ includeEmpty: true }, function (row) {
        var arr = [];
        for (var c = 1; c <= max_col; c++) {
          arr.push(flatten_cell(row.getCell(c).value));
        }
        rows.push(arr);
      });
    }
    return { sheet_name: ws ? ws.name : 'Sheet1', rows: rows };
  }

  // Build an .xlsx (all cells written as text) from header + string rows.
  async function grid_to_buffer(headers, rows) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'race_results_transform';
    wb.created = new Date();
    var ws = wb.addWorksheet('Rankings');
    ws.addRow(headers);
    rows.forEach(function (r) { ws.addRow(r); });
    // Force text format (member #s / times not reinterpreted by Excel) and
    // centre every cell.
    ws.eachRow(function (row) {
      row.eachCell({ includeEmpty: true }, function (cell) {
        cell.numFmt = '@';
        if (cell.value !== null && cell.value !== undefined) cell.value = String(cell.value);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });
    // bold, centred, frozen header row + comfortable column widths
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    var WIDTHS = { 'Member Number': 16, 'Last Name': 18, 'First Name': 18, 'Gender': 10,
      'DOB': 14, 'Email': 30, 'Address': 28, 'City': 18, 'State': 10, 'Zip': 12,
      'Category': 15, 'Recorded Time': 18 };
    ws.columns.forEach(function (c, i) { c.width = WIDTHS[headers[i]] || 16; });
    var out = await wb.xlsx.writeBuffer();
    return out; // Node: Buffer-like; Browser: ArrayBuffer
  }

  // ---- CSV support (RFC-4180-ish; handles quoted fields with embedded
  // commas and newlines, e.g. multi-line column headers) ----
  function parse_csv(text) {
    text = String(text).replace(/^\uFEFF/, ''); // strip BOM
    var rows = [], row = [], field = '', in_q = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (in_q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          in_q = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { in_q = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // drop a trailing fully-empty row (trailing newline)
    if (rows.length && rows[rows.length - 1].every(function (c) { return c === ''; })) rows.pop();
    return rows;
  }

  function csv_to_ir(text) {
    var rows = parse_csv(text).map(function (r) {
      return r.map(function (v) { return (v === '' ? null : v); });
    });
    return { sheet_name: 'CSV', rows: rows };
  }

  // Read any supported file by extension (Node-side convenience for the CLI).
  async function read_file_to_ir(filepath) {
    if (/\.csv$/i.test(filepath)) {
      var fs = require('fs');
      return csv_to_ir(fs.readFileSync(filepath, 'utf8'));
    }
    return read_to_ir(filepath);
  }

  return { read_to_ir: read_to_ir, csv_to_ir: csv_to_ir, read_file_to_ir: read_file_to_ir, parse_csv: parse_csv, grid_to_buffer: grid_to_buffer, _flattenCell: flatten_cell };
}));
