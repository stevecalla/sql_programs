/**
 * monthly_reconciliation — arithmetic verification: all 6 segments add up.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

module.exports = function build_monthly_reconciliation(wb, results) {
  const { monthly, c25, c26, retMt, saMt, suMt, ttrMt, attrMt, recMt, newMt, monthTotal } = results;
  const ws = wb.addWorksheet('monthly_reconciliation');
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  [10,9,11,10,10,10,9,9,10,10,9,8,11,11].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells('A1:N1');
  Object.assign(ws.getCell('A1'), {
    value:     'Full Monthly Analysis  |  6 Segments  |  Verifies all segment counts add to raw totals',
    font:      font({ bold: true, sz: 11, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:N2');
  Object.assign(ws.getCell('A2'), {
    value:     'Retained + SA + Tried to Return + Lost = 2025 total  |  Retained + SU + Recovered + New = 2026 total  |  OK = checks balance',
    font:      font({ sz: 8, color: C.WH }),
    fill:      fill('444444'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 18;

  const hdrs = ['Month','2025','Retained','SA out','Tried\nReturn','Lost\n(true)','Check\n2025','2026','SU in','Recovered','New\n(true)','Check\n2026','Net Δ','Net Shift'];
  hdrs.forEach((h, i) => {
    ws.getCell(3, i + 1).value     = h;
    ws.getCell(3, i + 1).font      = font({ bold: true, sz: 8, color: C.WH });
    ws.getCell(3, i + 1).fill      = fill(C.DK);
    ws.getCell(3, i + 1).alignment = align({ h: 'center', wrap: true });
  });
  ws.getRow(3).height = 28;

  for (let ri = 0; ri < 12; ri++) {
    const m   = ri + 1;
    const row = ri + 4;
    const n25 = Object.values(c25[m] ?? {}).reduce((s, v) => s + v, 0);
    const n26 = Object.values(c26[m] ?? {}).reduce((s, v) => s + v, 0);
    const ret  = monthTotal(retMt,  m);
    const sa   = monthTotal(saMt,   m);
    const su   = monthTotal(suMt,   m);
    const ttr  = monthTotal(ttrMt,  m);
    const attr = monthTotal(attrMt, m);
    const rec  = monthTotal(recMt,  m);
    const newE = monthTotal(newMt,  m);
    const diff = n26 - n25;
    const ns   = su - sa;
    const ok25 = ret + sa + ttr + attr === n25 ? 'OK' : `!${ret+sa+ttr+attr}`;
    const ok26 = ret + su + rec + newE === n26 ? 'OK' : `!${ret+su+rec+newE}`;
    const bg   = diff > 0 ? C.GBG : diff < 0 ? C.RBG : C.LG;

    ws.getRow(row).height = 18;
    td(ws.getCell(row, 1), MN[m], { bg, bold: true, hAlign: 'center' });
    td(ws.getCell(row, 2), n25,   { bg, fmt: '#,##0' });
    td(ws.getCell(row, 3), ret || null, { bg: ret ? C.GBG : bg, fg: ret ? C.GD : '888888', fmt: '#,##0' });
    td(ws.getCell(row, 4), sa || null,  { bg: sa ? C.ABG : bg,  fg: sa ? C.AM : '888888', fmt: '#,##0' });
    td(ws.getCell(row, 5), ttr || null, { bg: ttr ? C.TRBG : bg, fg: ttr ? C.TRFG : '888888', fmt: '#,##0', bold: !!ttr });
    td(ws.getCell(row, 6), attr || null,{ bg: attr > 5 ? C.RBG : bg, fg: attr > 5 ? C.RD : '555555', fmt: '#,##0' });

    const ck1 = ws.getCell(row, 7);
    ck1.value     = ok25;
    ck1.font      = font({ sz: 8, color: ok25 === 'OK' ? C.GD : C.RD });
    ck1.fill      = fill('EBF5EB');
    ck1.alignment = align({ h: 'center' });

    td(ws.getCell(row, 8), n26, { bg, bold: true, fmt: '#,##0' });
    td(ws.getCell(row, 9),  su || null,   { bg: su ? C.BBG : bg,   fg: su ? C.BD : '888888', fmt: '#,##0', bold: !!su });
    td(ws.getCell(row, 10), rec || null,  { bg: rec ? C.RECBG : bg, fg: rec ? C.RECFG : '888888', fmt: '#,##0', bold: !!rec });
    td(ws.getCell(row, 11), newE || null, { bg: newE > 5 ? C.BBG : bg, fg: newE > 5 ? C.BD : '555555', fmt: '#,##0' });

    const ck2 = ws.getCell(row, 12);
    ck2.value     = ok26;
    ck2.font      = font({ sz: 8, color: ok26 === 'OK' ? C.GD : C.RD });
    ck2.fill      = fill('EBF5EB');
    ck2.alignment = align({ h: 'center' });

    dv(ws.getCell(row, 13), diff, bg, { bold: true });
    dv(ws.getCell(row, 14), ns, bg,   { bold: false });
  }

  // Totals row 16
  const tr = 16;
  fillRow(ws, tr, C.DK);
  ws.getRow(tr).height = 18;
  th(ws.getCell(tr, 1), 'TOTAL', { bg: C.DK, sz: 10 });
  for (const col of [2,3,4,5,6,8,9,10,11,13,14]) {
    const c = ws.getCell(tr, col);
    c.value     = { formula: `=SUM(${String.fromCharCode(64+col)}4:${String.fromCharCode(64+col)}15)` };
    c.numFmt    = col >= 13 ? '+#,##0;-#,##0;"—"' : '#,##0';
    c.font      = font({ bold: true, sz: 9, color: C.WH });
    c.fill      = fill(C.DK);
    c.alignment = align({ h: 'right' });
  }

  applyBorders(ws, 3, tr, 1, 14);
  return ws;
};
