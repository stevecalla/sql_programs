/**
 * excel_output.js — write the duplicate output views to a single Excel workbook.
 *
 * One workbook, one tab per view (exact / fuzzy pair / fuzzy group / nickname pair /
 * nickname group / consolidated), columns taken from each view's CSV-shaped rows.
 * Uses the exceljs dependency already in package.json. Additive: the CSVs are
 * unchanged; this just writes an .xlsx beside them.
 */

'use strict';

const ExcelJS = require('exceljs');

// Excel sheet names: max 31 chars and may not contain [ ] : * ? / \.
function sheet_name(name) {
    const cleaned = String(name == null ? '' : name).replace(/[\[\]:*?/\\]/g, '_').slice(0, 31);
    return cleaned || 'Sheet';
}

// Write one workbook to `file_path`. `sheets` is [{ name, rows }]; rows are flat
// objects whose keys become the column headers (taken from the first row). Empty
// sheets are added with no header row. Returns the file path.
async function write_workbook(file_path, sheets) {
    const wb = new ExcelJS.Workbook();
    for (const { name, rows } of sheets) {
        const ws = wb.addWorksheet(sheet_name(name));
        if (rows && rows.length) {
            const columns = Object.keys(rows[0]);
            ws.columns = columns.map((c) => ({ header: c, key: c }));
            for (const r of rows) ws.addRow(r);
        }
    }
    await wb.xlsx.writeFile(file_path);
    return file_path;
}

module.exports = { write_workbook, sheet_name };
