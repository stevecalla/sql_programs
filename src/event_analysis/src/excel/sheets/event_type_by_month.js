/**
 * step_1_event_type_by_month — raw YoY delta by event type per month.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const TYPES  = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MN     = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                 7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

module.exports = function build_event_type_by_month(wb, results) {
  const YA = results?.years?.year_a ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.year_b ?? new Date().getFullYear();
  const { c25, c26 } = results;
  const ws = wb.addWorksheet('step_1_event_type_by_month');
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  // Column widths
  [10,12,12,12,12,12,13,12,12,12,12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: title
  ws.mergeCells('A1:K1');
  Object.assign(ws.getCell('A1'), {
    value:     `Sanctioned Event Changes by Type — ${YA} vs ${YB}  |  Excl. Cancelled, Declined & Deleted  |  "Other" folded into Adult Race`,
    font:      font({ bold: true, sz: 12, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 28;

  // Row 2: subtitle
  ws.mergeCells('A2:K2');
  Object.assign(ws.getCell('A2'), {
    value:     `Net Change = ${YA} Total + sum of all Δ columns = ${YB} Total  |  ✓ column verifies arithmetic`,
    font:      font({ sz: 9, color: C.WH }),
    fill:      fill('444444'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 18;

  // Row 3: header — matching reference v9f exactly (12 cols)
  // Other Δ col included (always 0; "Other" folded into Adult Race per subtitle)
  const H3 = ['Month',`${YA}\nTotal`,'Adult Race\nΔ','Youth Race\nΔ','Adult Clinic\nΔ','Youth Clinic\nΔ','Other\nΔ','Net Δ\n(formula)',`${YB}\nTotal`,'✓ Check'];
  ws.getRow(3).height = 32;
  H3.forEach((h, i) => {
    const bg = i < 2 ? C.DK : i < 7 ? '1A237E' : i < 9 ? '006064' : C.DK;
    th(ws.getCell(3, i + 1), h, { bg, sz: 9 });
  });

  // Data rows 4-15
  for (let ri = 0; ri < 12; ri++) {
    const m  = ri + 1;
    const rowNum = ri + 4;
    const row = ws.getRow(rowNum);
    row.height = 20;

    const n25  = Object.values(c25[m] ?? {}).reduce((s, v) => s + v, 0);
    const n26  = Object.values(c26[m] ?? {}).reduce((s, v) => s + v, 0);
    const diff = n26 - n25;
    const bg   = diff > 0 ? C.GBG : diff < 0 ? C.RBG : C.LG;

    // Month label
    td(ws.getCell(rowNum, 1), MN[m], { bg, fg: diff > 0 ? C.GD : diff < 0 ? C.RD : C.DK, bold: true, hAlign: 'center' });
    td(ws.getCell(rowNum, 2), n25,   { bg, fmt: '#,##0' });

    // Type deltas: cols 3-6 (Adult Race, Youth Race, Adult Clinic, Youth Clinic)
    let col = 3;
    for (const t of TYPES) {
      const d = (c26[m]?.[t] ?? 0) - (c25[m]?.[t] ?? 0);
      dv(ws.getCell(rowNum, col), d, d > 0 ? C.GBG : d < 0 ? C.RBG : C.LG);
      col++;
    }

    // Col 7: Other Δ — always 0 (Other folded into Adult Race per subtitle)
    td(ws.getCell(rowNum, 7), 0, { bg: C.LG, fmt: '+#,##0;-#,##0;"—"', fg: '999999' });

    // Col 8: Net Δ formula (sum of cols 3-7)
    const netCell = ws.getCell(rowNum, 8);
    netCell.value     = { formula: `=C${rowNum}+D${rowNum}+E${rowNum}+F${rowNum}+G${rowNum}` };
    netCell.numFmt    = '+#,##0;-#,##0;"—"';
    netCell.font      = font({ bold: true, sz: 9, color: diff > 0 ? C.GD : diff < 0 ? C.RD : '666666' });
    netCell.fill      = fill(diff > 0 ? C.GBG : diff < 0 ? C.RBG : C.LG);
    netCell.alignment = align({ h: 'right' });

    // Col 9: year_b Total
    td(ws.getCell(rowNum, 9), n26, { bg, bold: true, fmt: '#,##0' });

    // Col 10: Check formula
    const ck = ws.getCell(rowNum, 10);
    ck.value     = { formula: `=IF(B${rowNum}+H${rowNum}=I${rowNum},"✓","!")` };
    ck.font      = font({ sz: 8, color: C.GD });
    ck.fill      = fill('EBF5EB');
    ck.alignment = align({ h: 'center' });
  }

  // Totals row 16
  const tr = 16;
  ws.getRow(tr).height = 18;
  fillRow(ws, tr, C.DK);
  th(ws.getCell(tr, 1), 'FULL YEAR', { bg: C.DK, sz: 10 });

  // Col 2: year_a total
  const c2 = ws.getCell(tr, 2);
  c2.value = { formula: '=SUM(B4:B15)' }; c2.font = font({ bold:true, sz:10, color:C.WH }); c2.fill = fill(C.DK); c2.alignment = align({ h:'right' }); c2.numFmt = '#,##0';

  // Cols 3-7: type + other delta totals
  'CDEFG'.split('').forEach((letter, i) => {
    const c = ws.getCell(tr, i + 3);
    c.value = { formula: `=SUM(${letter}4:${letter}15)` };
    c.font = font({ bold:true, sz:10, color:C.WH }); c.fill = fill(C.DK); c.alignment = align({ h:'right' });
    c.numFmt = '+#,##0;-#,##0;"—"';
  });

  // Col 8: Net total
  const c8 = ws.getCell(tr, 8);
  c8.value = { formula: '=SUM(H4:H15)' }; c8.font = font({ bold:true, sz:10, color:C.WH }); c8.fill = fill(C.DK); c8.alignment = align({ h:'right' }); c8.numFmt = '+#,##0;-#,##0;"—"';

  // Col 9: year_b total
  const c9 = ws.getCell(tr, 9);
  c9.value = { formula: '=SUM(I4:I15)' }; c9.font = font({ bold:true, sz:10, color:C.WH }); c9.fill = fill(C.DK); c9.alignment = align({ h:'right' }); c9.numFmt = '#,##0';

  applyBorders(ws, 3, tr, 1, 10);

  // ── Reference count table below ─────────────────────────────────────
  const refStart = tr + 2;
  ws.mergeCells(`A${refStart}:K${refStart}`);
  Object.assign(ws.getCell(`A${refStart}`), {
    value:     'REFERENCE — Actual Counts by Type (not delta)',
    font:      font({ bold: true, sz: 10, color: C.WH }),
    fill:      fill('37474F'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(refStart).height = 20;

  const refHdrs = ['Month',`Adult Race ${YA}`,`Adult Race ${YB}`,`Youth Race ${YA}`,`Youth Race ${YB}`,
                   `Adult Clinic ${YA}`,`Adult Clinic ${YB}`,`Youth Clinic ${YA}`,`Youth Clinic ${YB}`,
                   `Total ${YA}`,`Total ${YB}`];
  refHdrs.forEach((h, i) => {
    th(ws.getCell(refStart + 1, i + 1), h, { bg: C.MR, sz: 9 });
  });
  ws.getRow(refStart + 1).height = 24;

  for (let ri = 0; ri < 12; ri++) {
    const m      = ri + 1;
    const rowNum = refStart + 2 + ri;
    const bg     = ri % 2 === 0 ? C.LG : C.WH;
    ws.getRow(rowNum).height = 18;
    td(ws.getCell(rowNum, 1), MN[m], { bg, bold: true, hAlign: 'center' });
    let col = 2;
    for (const t of TYPES) {
      td(ws.getCell(rowNum, col),     c25[m]?.[t] ?? 0, { bg, fmt: '#,##0' }); col++;
      td(ws.getCell(rowNum, col),     c26[m]?.[t] ?? 0, { bg, fmt: '#,##0', bold: true }); col++;
    }
    const t25 = Object.values(c25[m] ?? {}).reduce((s, v) => s + v, 0);
    const t26 = Object.values(c26[m] ?? {}).reduce((s, v) => s + v, 0);
    td(ws.getCell(rowNum, 10), t25, { bg, bold: true, fmt: '#,##0' });
    td(ws.getCell(rowNum, 11), t26, { bg, bold: t26 !== t25, fmt: '#,##0',
      fg: t26 > t25 ? C.GD : t26 < t25 ? C.RD : C.DK,
      bg: t26 > t25 ? C.GBG : t26 < t25 ? C.RBG : bg });
  }

  // Totals
  const refTr = refStart + 14;
  fillRow(ws, refTr, C.DK);
  th(ws.getCell(refTr, 1), 'FULL YEAR', { bg: C.DK, sz: 10 });
  for (let col = 2; col <= 11; col++) {
    const c = ws.getCell(refTr, col);
    const colLetter = String.fromCharCode(64 + col);
    c.value     = { formula: `=SUM(${colLetter}${refStart + 2}:${colLetter}${refStart + 13})` };
    c.font      = font({ bold: true, sz: 10, color: C.WH });
    c.fill      = fill(C.DK);
    c.alignment = align({ h: 'right' });
    c.numFmt    = '#,##0';
  }

  applyBorders(ws, refStart + 1, refTr, 1, 11);

  // ── Monthly Totals Summary (Section 3) ─────────────────────────
  const sumStart = refTr + 3;
  ws.mergeCells(`A${sumStart}:D${sumStart}`);
  Object.assign(ws.getCell(`A${sumStart}`), {
    value:     'Monthly Totals Summary',
    font:      font({ bold: true, sz: 10, color: C.WH }),
    fill:      fill('37474F'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(sumStart).height = 18;

  // Headers
  ['Month',`Total\n${YA}`,`Total\n${YB}`,'Var'].forEach((h, i) => {
    th(ws.getCell(sumStart + 1, i + 1), h, { bg: C.MR, sz: 9 });
  });
  ws.getRow(sumStart + 1).height = 24;

  for (let ri = 0; ri < 12; ri++) {
    const m      = ri + 1;
    const rowNum = sumStart + 2 + ri;
    const bg     = ri % 2 === 0 ? C.LG : C.WH;
    const t25    = Object.values(c25[m] ?? {}).reduce((s, v) => s + v, 0);
    const t26    = Object.values(c26[m] ?? {}).reduce((s, v) => s + v, 0);
    const varVal = t26 - t25;
    ws.getRow(rowNum).height = 15;
    td(ws.getCell(rowNum, 1), MN[m],   { bg, bold: true, hAlign: 'center' });
    td(ws.getCell(rowNum, 2), t25,     { bg, fmt: '#,##0' });
    td(ws.getCell(rowNum, 3), t26,     { bg, fmt: '#,##0', bold: true });
    const vc = ws.getCell(rowNum, 4);
    vc.value = varVal;
    vc.font  = font({ sz: 9, color: varVal > 0 ? C.GD : varVal < 0 ? C.RD : C.DK, bold: Math.abs(varVal) >= 10 });
    vc.fill  = fill(varVal > 0 ? C.GBG : varVal < 0 ? C.RBG : bg);
    vc.alignment = align({ h: 'center' });
    vc.numFmt = '+#,##0;-#,##0;"—"';
  }

  const sumTr = sumStart + 14;
  fillRow(ws, sumTr, C.DK);
  th(ws.getCell(sumTr, 1), 'FULL YEAR', { bg: C.DK, sz: 10 });
  const tot25 = Object.values(c25).flatMap(o=>Object.values(o)).reduce((s,v)=>s+v,0);
  const tot26 = Object.values(c26).flatMap(o=>Object.values(o)).reduce((s,v)=>s+v,0);
  td(ws.getCell(sumTr, 2), tot25, { bg: C.DK, fg: C.WH, bold: true, fmt: '#,##0' });
  td(ws.getCell(sumTr, 3), tot26, { bg: C.DK, fg: C.WH, bold: true, fmt: '#,##0' });
  td(ws.getCell(sumTr, 4), tot26 - tot25, { bg: C.DK, fg: C.WH, bold: true, fmt: '+#,##0;-#,##0;"—"' });
  applyBorders(ws, sumStart + 1, sumTr, 1, 4);

  return ws;
};
