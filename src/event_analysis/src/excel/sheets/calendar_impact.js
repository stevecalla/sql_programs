/**
 * step_2_calendar_impact — weekend-day count changes × monthly rate → expected delta.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const TYPES = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MN    = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

const TYPE_BG = { 'Adult Race':'37474F','Youth Race':'455A64','Adult Clinic':'546E7A','Youth Clinic':'607D8B' };

module.exports = function build_calendar_impact(wb, results, cm = null) {
  const YA = results?.years?.year_a ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.year_b ?? new Date().getFullYear();
  const { calImpact } = results;
  const ws = wb.addWorksheet('step_2_calendar_impact');
  ws.views = [{ state: 'frozen', ySplit: 5 }];

  // Col widths
  [11,10,10,12,10].concat(Array(12).fill(10)).concat([10,10,10]).forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Row 1
  ws.mergeCells('A1:T1');
  Object.assign(ws.getCell('A1'), {
    value:     'Calendar Impact — Weekend Day (Sat+Sun) Count Changes by Event Type  |  Month-specific rates',
    font:      font({ bold: true, sz: 12, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 28;

  // Row 2
  ws.mergeCells('A2:T2');
  Object.assign(ws.getCell('A2'), {
    value:     `Cal Exp Δ = Δ(Sat+Sun) × (${YA} events ÷ ${YA} weekend days, for that month & type).  Residual = Actual − Cal Exp.`,
    font:      font({ sz: 9, color: C.WH }),
    fill:      fill('444444'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 18;

  // Row 3: group headers
  ws.mergeCells('A3:D3'); th(ws.getCell('A3'), 'Calendar Structure (Sat+Sun)', { bg: '1A237E', sz: 9 });
  ws.mergeCells('E3:E3'); th(ws.getCell('E3'), 'Total\nCal Exp Δ', { bg: '006064', sz: 9 });
  let col = 6;
  for (const t of TYPES) {
    ws.mergeCells(`${colLet(col)}3:${colLet(col+2)}3`);
    th(ws.getCell(3, col), t, { bg: TYPE_BG[t], sz: 9 });
    col += 3;
  }
  ws.mergeCells(`${colLet(col)}3:${colLet(col+2)}3`);
  th(ws.getCell(3, col), 'TOTALS', { bg: C.DK, sz: 9 });
  ws.getRow(3).height = 18;

  // Row 4: sub-headers
  const sub4 = ['Month',`Wknd\n${YA}`,`Wknd\n${YB}`,'Δ Wknd\n(Sat+Sun)','Cal\nExp Δ'];
  sub4.forEach((h, i) => { th(ws.getCell(4, i + 1), h, { bg: C.MR, sz: 9 }); });
  col = 6;
  for (const t of TYPES) {
    ['Cal\nExp Δ','Actual\nΔ','Residual\n(non-cal)'].forEach((h, i) => {
      th(ws.getCell(4, col + i), h, { bg: TYPE_BG[t], sz: 9 });
    });
    col += 3;
  }
  ['Actual Δ\nTotal','Cal Exp\nΔ Total','Residual\nTotal'].forEach((h, i) => {
    th(ws.getCell(4, col + i), h, { bg: C.DK, sz: 9 });
  });
  ws.getRow(4).height = 36;

  // Data rows 5-16
  for (let ri = 0; ri < 12; ri++) {
    const ci  = calImpact[ri];
    const m   = ci.month;
    const row = ri + 5;
    ws.getRow(row).height = 18;
    const bg = ri % 2 === 0 ? C.LG : C.WH;
    const hasCal = ci.dw !== 0;

    td(ws.getCell(row, 1), MN[m], { bg, bold: true, hAlign: 'center' });
    td(ws.getCell(row, 2), ci.w25, { bg, fmt: '#,##0', hAlign: 'center' });
    td(ws.getCell(row, 3), ci.w26, { bg, fmt: '#,##0', hAlign: 'center' });

    // Δ Wknd
    const dwCell = ws.getCell(row, 4);
    if (hasCal) {
      const parts = [];
      if (ci.ds !== 0) parts.push(`Sat${ci.ds > 0 ? '+' : ''}${ci.ds}`);
      if (ci.du !== 0) parts.push(`Sun${ci.du > 0 ? '+' : ''}${ci.du}`);
      dwCell.value     = `${ci.dw > 0 ? '+' : ''}${ci.dw}  (${parts.join(', ')})`;
      dwCell.font      = font({ bold: true, sz: 9, color: ci.dw > 0 ? C.GD : C.RD });
      dwCell.fill      = fill(ci.dw > 0 ? C.GBG : C.RBG);
      dwCell.alignment = align({ h: 'center', wrap: true });
    } else {
      dwCell.value     = '—';
      dwCell.font      = font({ sz: 10, color: 'CCCCCC', italic: true });
      dwCell.fill      = fill(bg);
      dwCell.alignment = align({ h: 'center' });
    }

    // Total Cal Expected
    const ctCell = ws.getCell(row, 5);
    if (hasCal) {
      dv(ctCell, Math.round(ci.calTotal * 10) / 10, C.GBG.replace('E8','C8') ? (ci.calTotal > 0 ? C.GBG : C.RBG) : bg,
         { fmt: '+0.0;-0.0;"—"' });
    } else {
      ctCell.value     = '—';
      ctCell.font      = font({ sz: 10, color: 'BBBBBB', italic: true });
      ctCell.fill      = fill(bg);
      ctCell.alignment = align({ h: 'right' });
    }

    // Per type
    col = 6;
    for (const t of TYPES) {
      const calV = ci.calByType[t];
      const actV = ci.actByType[t];
      const resV = ci.orgByType[t];

      // Cal expected
      const ccCell = ws.getCell(row, col);
      if (hasCal && Math.abs(calV) > 0.05) {
        ccCell.value     = Math.round(calV * 10) / 10;
        ccCell.numFmt    = '+0.0;-0.0;"—"';
        ccCell.font      = font({ sz: 9, italic: true, color: calV > 0 ? C.GD : C.RD });
        ccCell.fill      = fill(C.YLBG);
      } else {
        ccCell.value     = '—';
        ccCell.font      = font({ sz: 9, color: 'CCCCCC' });
        ccCell.fill      = fill(bg);
      }
      ccCell.alignment = align({ h: 'right' });

      // Actual
      const acCell = ws.getCell(row, col + 1);
      acCell.value     = actV !== 0 ? actV : null;
      acCell.numFmt    = '+#,##0;-#,##0;"—"';
      acCell.font      = font({ bold: actV !== 0, sz: 9, color: actV > 0 ? C.GD : actV < 0 ? C.RD : '999999' });
      acCell.fill      = fill(actV > 0 ? C.GBG : actV < 0 ? C.RBG : bg);
      acCell.alignment = align({ h: 'right' });

      // Residual
      const rcCell = ws.getCell(row, col + 2);
      if (Math.abs(resV) > 0.5) {
        rcCell.value     = Math.round(resV * 10) / 10;
        rcCell.numFmt    = '+0.0;-0.0;"—"';
        rcCell.font      = font({ bold: true, sz: 9, color: resV > 0 ? C.GD : C.RD });
        rcCell.fill      = fill(resV > 0 ? C.GBG : C.RBG);
      } else {
        rcCell.value     = '—';
        rcCell.font      = font({ sz: 9, color: 'CCCCCC' });
        rcCell.fill      = fill(bg);
      }
      rcCell.alignment = align({ h: 'right' });
      col += 3;
    }

    // Right totals
    for (const [offset, val, isCalCol] of [[0, ci.actDelta, false],[1, ci.calTotal, true],[2, ci.orgTotal, false]]) {
      const tc = ws.getCell(row, col + offset);
      const v  = offset === 0 ? val : Math.round(val * 10) / 10;
      if (isCalCol && !hasCal) {
        tc.value     = '—';
        tc.font      = font({ sz: 9, color: 'BBBBBB', italic: true });
        tc.fill      = fill(bg);
      } else {
        tc.value     = v !== 0 ? v : null;
        tc.numFmt    = offset === 0 ? '+#,##0;-#,##0;"—"' : '+0.0;-0.0;"—"';
        tc.font      = font({ bold: true, sz: 9, color: val > 0 ? C.GD : val < 0 ? C.RD : '999999' });
        tc.fill      = fill(isCalCol && hasCal ? C.YLBG : val > 0 ? C.GBG : val < 0 ? C.RBG : bg);
      }
      tc.alignment = align({ h: 'right' });
    }
  }

  // Totals row 17
  const tr = 17;
  fillRow(ws, tr, C.DK, 1, col + 2);
  ws.getRow(tr).height = 18;
  th(ws.getCell(tr, 1), 'FULL YEAR', { bg: C.DK, sz: 10 });
  td(ws.getCell(tr, 2), calImpact.reduce((s, ci) => s + ci.w25, 0), { bg: C.DK, fg: C.WH, fmt: '#,##0', bold: true });
  td(ws.getCell(tr, 3), calImpact.reduce((s, ci) => s + ci.w26, 0), { bg: C.DK, fg: C.WH, fmt: '#,##0', bold: true });
  td(ws.getCell(tr, 4), `Net: ${calImpact.reduce((s,ci)=>s+ci.dw,0)>0?'+':''}${calImpact.reduce((s,ci)=>s+ci.dw,0)}`, { bg: C.DK, fg: C.WH, hAlign: 'center' });

  const sumCols = [5, ...Array.from({length: 12}, (_, i) => 6 + i), col, col+1, col+2];
  for (const c of sumCols) {
    const cell = ws.getCell(tr, c);
    cell.value     = { formula: `=SUM(${colLet(c)}5:${colLet(c)}16)` };
    cell.numFmt    = '+0.0;-0.0;"—"';
    cell.font      = font({ bold: true, sz: 9, color: C.WH });
    cell.fill      = fill(C.DK);
    cell.alignment = align({ h: 'right' });
  }

  applyBorders(ws, 3, tr, 1, col + 2);

  // Key findings
  const findings = cm?.excel_calendar_findings ?? [
    ['Jul −16 / Aug −18:', 'ΔWknd=0 both months. Zero calendar explanation. Entire decline is organic attrition.'],
    ['May +3:',            `Gains +1 Sunday → calendar expects +${Math.round(calImpact[4].calTotal*10)/10} more events. Actual +3 → organic ${Math.round(calImpact[4].orgTotal*10)/10}. May underperformed its calendar opportunity.`],
    ['Jun +10:',           `Loses −1 Sunday → calendar expects ${Math.round(calImpact[5].calTotal*10)/10} fewer events. Actual +10 → organic +${Math.round(calImpact[5].orgTotal*10)/10}. Strong organic growth overcame headwind.`],
    ['Jan/Mar/Oct/Nov:', 'Saturday count changes (±1). Calendar explains a portion of those months\' variance; residual reflects true organic change.'],
  ];
  const fb = tr + 2;
  ws.mergeCells(`A${fb}:T${fb}`);
  th(ws.getCell(`A${fb}`), 'KEY FINDINGS', { bg: '37474F', sz: 11, hAlign: 'left' });
  ws.getRow(fb).height = 20;
  for (let i = 0; i < findings.length; i++) {
    const r = fb + 1 + i;
    ws.getRow(r).height = 30;
    ws.mergeCells(`A${r}:C${r}`); ws.mergeCells(`D${r}:T${r}`);
    td(ws.getCell(r, 1), findings[i][0], { bg: C.LG, bold: true, hAlign: 'left' });
    td(ws.getCell(r, 4), findings[i][1], { bg: C.WH, hAlign: 'left' });
  }
  applyBorders(ws, fb, fb + findings.length, 1, 20);

  return ws;
};

function colLet(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
