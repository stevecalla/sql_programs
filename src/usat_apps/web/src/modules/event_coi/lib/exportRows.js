// exportRows.js — client-side CSV + Excel export for the in-memory holder table. Mirrors the merge
// app's DataTable client export exactly: CSV via a text Blob, and "Excel" as SpreadsheetML 2003 (a .xls
// that Excel opens natively, no library). columns = [{ key, label }].

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(columns, rows, name = 'export') {
  const esc = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c.key])).join(','));
  triggerDownload(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name + '.csv');
}

export function exportExcel(columns, rows, name = 'export') {
  const xesc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isNum = (v) => (typeof v === 'number') || (v != null && v !== '' && typeof v !== 'boolean' && String(v).trim() !== '' && !Number.isNaN(Number(v)));
  const cell = (v) => `<Cell><Data ss:Type="${isNum(v) ? 'Number' : 'String'}">${xesc(v)}</Data></Cell>`;
  const head = '<Row>' + columns.map((c) => `<Cell><Data ss:Type="String">${xesc(c.label)}</Data></Cell>`).join('') + '</Row>';
  const body = rows.map((row) => '<Row>' + columns.map((c) => cell(row[c.key])).join('') + '</Row>').join('');
  const xml = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Worksheet ss:Name="Holders"><Table>' + head + body + '</Table></Worksheet></Workbook>';
  triggerDownload(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), name + '.xls');
}
