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

  function worksheet_rows(ws) {
    var rows = [];
    if (!ws) return rows;
    var max_col = ws.columnCount || 0;
    ws.eachRow({ includeEmpty: true }, function (row) {
      var arr = [];
      for (var c = 1; c <= max_col; c++) arr.push(flatten_cell(row.getCell(c).value));
      rows.push(arr);
    });
    return rows;
  }

  // Single (first) sheet -> IR. Unchanged contract; used by the CLI/tests.
  async function read_to_ir(input) {
    var wb = await load_workbook(input);
    var ws = wb.worksheets[0];
    return { sheet_name: ws ? ws.name : 'Sheet1', rows: worksheet_rows(ws) };
  }

  // Every non-empty worksheet -> IR[]. Used by the web app for multi-tab files.
  async function read_to_irs(input) {
    var wb = await load_workbook(input);
    var out = [];
    wb.worksheets.forEach(function (ws) {
      var rows = worksheet_rows(ws);
      var has_data = rows.some(function (r) { return r.some(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; }); });
      if (has_data) out.push({ sheet_name: ws.name, rows: rows });
    });
    if (!out.length) { var w0 = wb.worksheets[0]; out.push({ sheet_name: w0 ? w0.name : 'Sheet1', rows: w0 ? worksheet_rows(w0) : [] }); }
    return out;
  }

  var COL_WIDTHS = { 'Member Number': 16, 'Last Name': 18, 'First Name': 18, 'Gender': 10,
    'DOB': 14, 'Email': 30, 'Address': 28, 'City': 18, 'State': 10, 'Zip': 12,
    'Category': 15, 'Recorded Time': 18 };

  // Excel sheet-name rules: <=31 chars, none of []:*?/\\, non-empty, unique.
  function sanitize_sheet_name(name, used) {
    var n = String(name == null ? '' : name).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31);
    if (!n) n = 'Sheet';
    var base = n, i = 2;
    while (used[n.toLowerCase()]) { var suffix = ' (' + (i++) + ')'; n = base.slice(0, 31 - suffix.length) + suffix; }
    used[n.toLowerCase()] = true;
    return n;
  }

  // Write one formatted worksheet (all cells as centred text, bold frozen header).
  function format_sheet(ws, headers, rows) {
    ws.addRow(headers);
    rows.forEach(function (r) { ws.addRow(r); });
    ws.eachRow(function (row) {
      row.eachCell({ includeEmpty: true }, function (cell) {
        cell.numFmt = '@';
        if (cell.value !== null && cell.value !== undefined) cell.value = String(cell.value);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach(function (c, i) { c.width = COL_WIDTHS[headers[i]] || 16; });
  }

  // Build a single-sheet .xlsx (all cells written as text).
  async function grid_to_buffer(headers, rows) {
    return grids_to_buffer([{ name: 'Rankings', headers: headers, rows: rows }]);
  }

  // Build a multi-sheet .xlsx — one worksheet per { name, headers, rows }.
  async function grids_to_buffer(sheets) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'race_results_transform';
    wb.created = new Date();
    var used = {};
    sheets.forEach(function (sh) {
      var ws = wb.addWorksheet(sanitize_sheet_name(sh.name || 'Rankings', used));
      format_sheet(ws, sh.headers, sh.rows);
    });
    if (!sheets.length) wb.addWorksheet('Rankings');
    return wb.xlsx.writeBuffer(); // Node: Buffer-like; Browser: ArrayBuffer
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

  // Same, but returns every sheet (CSV -> single-element array).
  async function read_file_to_irs(filepath) {
    if (/\.csv$/i.test(filepath)) {
      var fs = require('fs');
      return [csv_to_ir(fs.readFileSync(filepath, 'utf8'))];
    }
    return read_to_irs(filepath);
  }

  return { read_to_ir: read_to_ir, read_to_irs: read_to_irs, csv_to_ir: csv_to_ir,
    read_file_to_ir: read_file_to_ir, read_file_to_irs: read_file_to_irs,
    parse_csv: parse_csv, grid_to_buffer: grid_to_buffer, grids_to_buffer: grids_to_buffer,
    sanitize_sheet_name: sanitize_sheet_name, _flattenCell: flatten_cell };
}));
