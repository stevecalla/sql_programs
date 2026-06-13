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

  function strip_mailto(s) { return String(s).replace(/^mailto:/i, '').replace(/\?.*$/, ''); }
  // Flatten an ExcelJS cell value into a plain Cell.
  function flatten_cell(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    var t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'object') {
      // rich text: concat the runs (styled cells, incl. styled hyperlink labels)
      if (Array.isArray(v.richText)) {
        return v.richText.map(function (r) { return (r && r.text != null) ? r.text : ''; }).join('');
      }
      // hyperlink { text, hyperlink }: `text` may be a plain string OR rich text (a styled email link
      // reads as { text: { richText: [...] } }). Flatten it; if there's no usable label, fall back to
      // the de-mailto'd URL — so an email link never renders as "[object Object]".
      if ('text' in v) {
        var label = flatten_cell(v.text);
        if (label !== null && label !== '') return label;
        return (typeof v.hyperlink === 'string') ? strip_mailto(v.hyperlink) : label;
      }
      if (typeof v.hyperlink === 'string') return strip_mailto(v.hyperlink);
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

  // ---- CSV writing (RFC-4180): quote any field containing a comma/quote/newline and double
  // embedded quotes. Every cell is written as text, so long member numbers stay intact in the file
  // (Excel may still re-format them on open — that's a viewer quirk, not a data loss).
  function csv_field(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // One grid (header row + data rows) -> CSV text. CRLF line endings (Excel-friendly).
  // opts.excel_safe_cols: column indices whose values are wrapped as an Excel text formula ="value"
  // so Excel keeps them EXACTLY as written when the CSV is opened (times like 00:59:59.000 and dates
  // aren't auto-reformatted). Opt-in — those cells become text in Excel, and other CSV tools (Google
  // Sheets, scripts) see the literal ="..." — so it's off by default.
  function grid_to_csv(headers, rows, opts) {
    var safe = (opts && opts.excel_safe_cols) || null;
    function field(v, c) {
      if (safe && safe.indexOf(c) >= 0) {
        var s = (v == null ? '' : String(v));
        if (s !== '') return csv_field('="' + s.replace(/"/g, '""') + '"');
      }
      return csv_field(v);
    }
    var lines = [(headers || []).map(csv_field).join(',')];
    (rows || []).forEach(function (r) { lines.push((r || []).map(function (v, c) { return field(v, c); }).join(',')); });
    return lines.join('\r\n');
  }

  // ---- legacy .xls via SheetJS (optional, drop-in) --------------------------------------------
  // exceljs reads ONLY .xlsx. If SheetJS is present — the global `XLSX` (browser, from
  // public/vendor/xlsx.full.min.js) or the `xlsx` npm package (Node) — we read legacy .xls with it.
  // Otherwise xls_to_irs throws XLS_UNSUPPORTED and the caller tells the user to re-save as .xlsx.
  function get_sheetjs() {
    if (typeof XLSX !== 'undefined' && XLSX) return XLSX;
    var g = (typeof globalThis !== 'undefined') ? globalThis : (typeof self !== 'undefined' ? self : null);
    if (g && g.XLSX) return g.XLSX;
    if (typeof require === 'function') { try { return require('xlsx'); } catch (e) { /* not installed */ } }
    return null;
  }
  function sheetjs_available() { return !!get_sheetjs(); }
  function xls_open(input) {
    var X = get_sheetjs();
    if (!X) { var e = new Error('Legacy .xls needs the SheetJS library — re-save the file as .xlsx, or enable .xls support.'); e.code = 'XLS_UNSUPPORTED'; throw e; }
    var data = input, type = 'buffer';
    if (typeof input === 'string') { type = 'file'; }
    else if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) { data = new Uint8Array(input); type = 'array'; }
    else if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) { type = 'array'; }
    return { X: X, wb: X.read(data, { type: type, cellDates: true }) };   // cellDates -> JS Dates like exceljs
  }
  function xls_rows(X, ws) {
    var rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    return rows.map(function (r) { return r.map(function (v) { return (v === undefined || v === '') ? null : v; }); });
  }
  async function xls_to_irs(input) {
    var ctx = xls_open(input), out = [];
    ctx.wb.SheetNames.forEach(function (name) {
      var rows = xls_rows(ctx.X, ctx.wb.Sheets[name]);
      if (rows.some(function (r) { return r.some(function (v) { return v !== null && String(v).trim() !== ''; }); })) out.push({ sheet_name: name, rows: rows });
    });
    if (!out.length && ctx.wb.SheetNames.length) { var n0 = ctx.wb.SheetNames[0]; out.push({ sheet_name: n0, rows: xls_rows(ctx.X, ctx.wb.Sheets[n0]) }); }
    return out;
  }
  async function xls_to_ir(input) { var irs = await xls_to_irs(input); return irs[0] || { sheet_name: 'Sheet1', rows: [] }; }

  // Read any supported file by extension (Node-side convenience for the CLI).
  async function read_file_to_ir(filepath) {
    if (/\.csv$/i.test(filepath)) {
      var fs = require('fs');
      return csv_to_ir(fs.readFileSync(filepath, 'utf8'));
    }
    if (/\.xls$/i.test(filepath)) return xls_to_ir(filepath);
    return read_to_ir(filepath);
  }

  // Same, but returns every sheet (CSV -> single-element array).
  async function read_file_to_irs(filepath) {
    if (/\.csv$/i.test(filepath)) {
      var fs = require('fs');
      return [csv_to_ir(fs.readFileSync(filepath, 'utf8'))];
    }
    if (/\.xls$/i.test(filepath)) return xls_to_irs(filepath);
    return read_to_irs(filepath);
  }

  return { read_to_ir: read_to_ir, read_to_irs: read_to_irs, csv_to_ir: csv_to_ir,
    xls_to_ir: xls_to_ir, xls_to_irs: xls_to_irs, sheetjs_available: sheetjs_available,
    read_file_to_ir: read_file_to_ir, read_file_to_irs: read_file_to_irs,
    parse_csv: parse_csv, grid_to_csv: grid_to_csv, grid_to_buffer: grid_to_buffer, grids_to_buffer: grids_to_buffer,
    sanitize_sheet_name: sanitize_sheet_name, flatten_cell: flatten_cell, _flattenCell: flatten_cell };
}));
