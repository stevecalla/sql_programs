/**
 * step_3_organic_performance — calendar-adjusted organic delta by month and type.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const TYPES = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MN    = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

const NARRATIVES = {
  Jun: 'Strongest organic month. Lost a Sunday but delivered +33 net-new organic events. Real demand.',
  Mar: 'Overcame a lost Saturday. Organic +13 — one of the healthiest months.',
  Jan: 'Calendar helped (+1 Sat) but organic growth (+6) also strong for off-season.',
  Oct: 'Calendar handed it +15 (extra Sat + shifted events). Organic gain modest (+4).',
  Apr: 'No calendar effect; organic +5. Solid.',
  Sep: 'Slight organic decline. No calendar effect — a watch item.',
  Nov: 'Lost a Saturday AND organic decline. Double headwind month.',
  May: 'Most misleading month. Looks +3 raw but organic −13. May underperformed.',
  Jul: 'Zero calendar explanation. Full −16 is organic. Adult Race and Youth Race both declining.',
  Aug: 'Zero calendar explanation. Full −18 is organic. Worst month. No alibi.',
  Feb: '',
  Dec: '',
};

const TYPE_INSIGHT = {
  'Adult Race':   'Essentially flat. Organic +0.2%. Core race product stable.',
  'Youth Race':   'Modest organic softness. Small numbers; watch trend.',
  'Adult Clinic': 'Structural contraction −10.3%. Key concern.',
  'Youth Clinic': 'Strong organic growth +19.4%. Only growing type.',
};

module.exports = function build_organic_performance(wb, results, cm = null) {
  const { organicMonthly, organicByType } = results;
  const ws = wb.addWorksheet('step_3_organic_performance');
  ws.views = [{ state: 'frozen', ySplit: 5 }];

  [10,10,12,12,12,13,3,14,12,12,12,46].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Title
  ws.mergeCells('A1:L1');
  Object.assign(ws.getCell('A1'), {
    value:     'Calendar-Adjusted Organic Performance 2025→2026  |  Strips out weekend-day shifts to show true organic growth or decline',
    font:      font({ bold: true, sz: 12, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:L2');
  Object.assign(ws.getCell('A2'), {
    value:     'Organic Δ = Actual Δ − Calendar Expected Δ.  Positive = grew beyond calendar prediction.  Negative = declined after accounting for weekend structure.  Darker = stronger signal (±10+).',
    font:      font({ sz: 9, color: C.WH }),
    fill:      fill('444444'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 18;

  // Part A header
  ws.mergeCells('A4:L4');
  Object.assign(ws.getCell('A4'), {
    value:     'PART A — Calendar-Adjusted Organic Change by Month & Event Type',
    font:      font({ bold: true, sz: 11, color: C.WH }),
    fill:      fill(C.DK),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(4).height = 20;

  const hdrs5 = ['Month','2025','Cal\nExpected\n2026','Actual\n2026','Raw Δ\n(naive)','Calendar\nEffect','Organic Δ\nTOTAL','',
                 'Adult Race\nOrganic Δ','Youth Race\nOrganic Δ','Adult Clinic\nOrganic Δ','Youth Clinic\nOrganic Δ'];
  hdrs5.forEach((h, i) => {
    const bg = i === 6 ? C.DK : i >= 8 ? '37474F' : '1A237E';
    th(ws.getCell(5, i + 1), h, { bg, sz: 9 });
    if (i === 7) ws.getCell(5, 8).fill = fill('F8F8F8');
  });
  ws.getRow(5).height = 36;

  // Sort months by organic delta for the ranked view (Part B) — build both
  const sorted = [...organicMonthly].sort((a, b) => b.orgTotal - a.orgTotal);

  // Data rows 6-17
  for (let ri = 0; ri < 12; ri++) {
    const ci  = organicMonthly[ri];
    const m   = ci.month;
    const row = ri + 6;
    ws.getRow(row).height = 18;
    const bg = ri % 2 === 0 ? C.LG : C.WH;
    const raw = ci.actDelta;
    const cal = ci.calTotal;
    const org = ci.orgTotal;
    const calExp26 = ci.tot25 + cal;
    const diverge  = (raw >= 0 && org < -5) || (raw <= 0 && org > 5);

    td(ws.getCell(row, 1), MN[m], { bg: diverge ? C.YLBG : bg, fg: diverge ? C.YLD : C.DK, bold: true, hAlign: 'center' });
    td(ws.getCell(row, 2), ci.tot25, { bg, fmt: '#,##0' });
    td(ws.getCell(row, 3), Math.round(calExp26 * 10) / 10, { bg: C.YLBG, fmt: '#,##0.0', italic: true, fg: '666666' });
    td(ws.getCell(row, 4), ci.tot26, { bg, bold: true, fmt: '#,##0' });
    dv(ws.getCell(row, 5), raw, bg);
    // Calendar effect
    const cc = ws.getCell(row, 6);
    if (Math.abs(cal) > 0.1) {
      cc.value     = Math.round(cal * 10) / 10;
      cc.numFmt    = '+0.0;-0.0;"—"';
      cc.font      = font({ sz: 9, italic: true, color: cal > 0 ? C.GD : C.RD });
      cc.fill      = fill(C.YLBG);
    } else {
      cc.value     = '—';
      cc.font      = font({ sz: 9, color: 'CCCCCC', italic: true });
      cc.fill      = fill(bg);
    }
    cc.alignment = align({ h: 'right' });
    // Organic total
    orgCell(ws.getCell(row, 7), org, { fmt: '+#,##0.0;-#,##0.0;"—"', sz: 11, bold: true });
    // Spacer
    ws.getCell(row, 8).fill = fill('F8F8F8');
    // Type organics from calImpact
    const ci2 = results.calImpact[ri];
    for (let ti = 0; ti < 4; ti++) {
      const t   = TYPES[ti];
      const ov  = ci2.orgByType[t];
      orgCell(ws.getCell(row, 9 + ti), ov);
    }
  }

  // Totals row 18
  const tr = 18;
  fillRow(ws, tr, C.DK);
  ws.getRow(tr).height = 18;
  th(ws.getCell(tr, 1), 'FULL YEAR', { bg: C.DK, sz: 10 });
  for (const [col, f] of [[2,'=SUM(B6:B17)'],[4,'=SUM(D6:D17)'],[5,'=D18-B18'],[6,'=SUM(F6:F17)'],[7,'=SUM(G6:G17)'],[9,'=SUM(I6:I17)'],[10,'=SUM(J6:J17)'],[11,'=SUM(K6:K17)'],[12,'=SUM(L6:L17)']]) {
    const c = ws.getCell(tr, col);
    c.value     = { formula: f };
    c.numFmt    = col === 2 || col === 4 ? '#,##0' : '+#,##0.0;-#,##0.0;"—"';
    c.font      = font({ bold: true, sz: col === 7 ? 11 : 10, color: C.WH });
    c.fill      = fill(C.DK);
    c.alignment = align({ h: 'right' });
  }
  applyBorders(ws, 5, tr, 1, 7);
  applyBorders(ws, 5, tr, 9, 12);

  // Part B: ranked
  const pBrow = tr + 2;
  ws.mergeCells(`A${pBrow}:L${pBrow}`);
  Object.assign(ws.getCell(`A${pBrow}`), {
    value:     'PART B — Months Ranked by Organic Δ  (best to worst, calendar noise removed)',
    font:      font({ bold: true, sz: 11, color: C.WH }),
    fill:      fill(C.DK),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(pBrow).height = 20;
  const bhdrs = [['Month',18],['Raw Δ',10],['Calendar Effect',14],['Organic Δ',12],['Interpretation',46]];
  bhdrs.forEach(([h, w], i) => {
    ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width, w);
    th(ws.getCell(pBrow + 1, i + 1), h, { bg: C.MR, sz: 9 });
  });
  ws.getRow(pBrow + 1).height = 22;
  for (let i = 0; i < sorted.length; i++) {
    const ci  = sorted[i];
    const row = pBrow + 2 + i;
    const bg  = i % 2 === 0 ? C.LG : C.WH;
    ws.getRow(row).height = 18;
    td(ws.getCell(row, 1), MN[ci.month], { bg, bold: true, hAlign: 'left' });
    dv(ws.getCell(row, 2), ci.actDelta, bg);
    const cc2 = ws.getCell(row, 3);
    if (Math.abs(ci.calTotal) > 0.1) {
      cc2.value = Math.round(ci.calTotal * 10) / 10; cc2.numFmt = '+0.0;-0.0;"—"';
      cc2.font  = font({ sz: 9, italic: true, color: ci.calTotal > 0 ? C.GD : C.RD });
      cc2.fill  = fill(C.YLBG);
    } else {
      cc2.value = '—'; cc2.font = font({ sz: 9, color: 'CCCCCC' }); cc2.fill = fill(bg);
    }
    cc2.alignment = align({ h: 'right' });
    orgCell(ws.getCell(row, 4), ci.orgTotal, { fmt: '+#,##0.0;-#,##0.0;"—"', sz: 11, bold: true });
    const interp = (cm?.excel_month_narratives ?? {})[MN[ci.month]] || NARRATIVES[MN[ci.month]] || (ci.orgTotal > 8 ? 'Strong organic growth' : ci.orgTotal > 3 ? 'Solid organic growth' : ci.orgTotal > 0 ? 'Modest growth' : ci.orgTotal > -3 ? 'Roughly flat' : ci.orgTotal > -8 ? 'Modest decline' : 'Significant organic decline');
    td(ws.getCell(row, 5), interp, { bg, hAlign: 'left', sz: 9, italic: true, fg: ci.orgTotal > 5 ? '1A237E' : ci.orgTotal < -5 ? C.RD : '555555' });
  }
  applyBorders(ws, pBrow + 1, pBrow + 1 + sorted.length, 1, 5);

  // Part C: by type
  const pcRow = pBrow + 2 + sorted.length + 2;
  ws.mergeCells(`A${pcRow}:L${pcRow}`);
  Object.assign(ws.getCell(`A${pcRow}`), {
    value:     'PART C — Annual Organic Δ by Event Type  (Other folded into Adult Race)',
    font:      font({ bold: true, sz: 11, color: C.WH }),
    fill:      fill(C.DK),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(pcRow).height = 20;
  const chdrs = ['Event Type','2025 Count','Actual Δ (Raw)','Calendar Effect','Organic Δ','Organic %\nvs 2025 base'];
  chdrs.forEach((h, i) => { th(ws.getCell(pcRow + 1, i + 1), h, { bg: C.MR, sz: 9 }); });
  ws.getRow(pcRow + 1).height = 28;
  for (let ti = 0; ti < TYPES.length; ti++) {
    const t   = TYPES[ti];
    const ot  = organicByType[t];
    const row = pcRow + 2 + ti;
    const bg  = ti % 2 === 0 ? C.LG : C.WH;
    ws.getRow(row).height = 20;
    td(ws.getCell(row, 1), t, { bg, bold: true, hAlign: 'left' });
    td(ws.getCell(row, 2), ot.tot25, { bg, fmt: '#,##0' });
    dv(ws.getCell(row, 3), ot.actDelta, bg);
    const cc3 = ws.getCell(row, 4);
    cc3.value = Math.round(ot.calTotal * 10) / 10; cc3.numFmt = '+0.0;-0.0;"—"';
    cc3.font  = font({ sz: 9, italic: true, color: ot.calTotal > 0 ? C.GD : ot.calTotal < 0 ? C.RD : '999999' });
    cc3.fill  = fill(Math.abs(ot.calTotal) > 0.5 ? C.YLBG : bg);
    cc3.alignment = align({ h: 'right' });
    orgCell(ws.getCell(row, 5), ot.orgTotal, { fmt: '+#,##0.0;-#,##0.0;"—"', sz: 11, bold: true });
    const pct = ot.tot25 > 0 ? ot.orgTotal / ot.tot25 : 0;
    dv(ws.getCell(row, 6), pct, pct > 0 ? C.GBG : pct < 0 ? C.RBG : bg,
       { fmt: '+0.0%;-0.0%;"—"', bold: true });
    td(ws.getCell(row, 7), (cm?.excel_type_insights ?? {})[t] || TYPE_INSIGHT[t] || '', { bg, hAlign: 'left', sz: 9 });
  }
  applyBorders(ws, pcRow + 1, pcRow + 1 + TYPES.length, 1, 7);
  return ws;
};

/** Style a cell as an organic delta (green/red, darker for ±10+). */
function orgCell(cell, val, { fmt = '+#,##0;-#,##0;"—"', sz = 9, bold = false } = {}) {
  const strong = Math.abs(val) >= 10;
  const fg  = val > 0 ? C.GD : val < 0 ? C.RD : '999999';
  const bg  = strong ? (val > 0 ? C.MGBG : C.MRDBG) : val > 0 ? C.GBG : val < 0 ? C.RBG : C.LG;
  cell.value     = val !== 0 ? (Number.isInteger(val) ? val : Math.round(val * 10) / 10) : null;
  cell.numFmt    = fmt;
  cell.font      = font({ bold: bold || strong, sz, color: fg });
  cell.fill      = fill(bg);
  cell.alignment = align({ h: 'right' });
}
