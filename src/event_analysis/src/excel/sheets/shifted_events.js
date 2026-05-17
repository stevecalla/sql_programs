/**
 * step_4c_shifted_events — Full shifted-event analysis matching reference v9f.
 *   Part A: Key statistics (Total, Later, Earlier, Avg Distance)
 *   Part B: Breakdown by type with top origin/destination months + interpretation
 *   Part C: Complete event roster (Direction, Type, 2025 details, 2026 details, Confidence)
 */
'use strict';

const { C, fill, font, align, applyBorders, th, td } = require('../styles');

const MN = {1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
            7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'};

module.exports = function build_shifted_events(wb, results) {
  const { segments } = results;
  const shifted = segments.shifted;
  const ws = wb.addWorksheet('step_4c_shifted_events');
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  // Column widths (13 cols to match reference)
  [3, 16, 9, 14, 12, 22, 14, 46, 12, 22, 14, 46, 18].forEach((w,i) => {
    ws.getColumn(i + 1).width = w;
  });

  const total = shifted.length;
  const later   = shifted.filter(r => r.e26.month > r.e25.month).length;
  const earlier = shifted.filter(r => r.e26.month < r.e25.month).length;
  const avg_dist = (shifted.reduce((s,r) => s + Math.abs(r.e26.month - r.e25.month), 0) / total).toFixed(1);

  // ── Title ──────────────────────────────────────────────────────────────────
  ws.mergeCells('A1:M1');
  Object.assign(ws.getCell('A1'), {
    value:     `Step 4B — Shifted Events Detail  |  ${total} events ran in both years but in a different calendar month`,
    fill:      fill(C.DR),
    font:      font({ bold: true, sz: 12, color: C.WH }),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:M2');
  Object.assign(ws.getCell('A2'), {
    value:     'Shifted = same event matched in both 2025 and 2026 but running in a different calendar month. SA = shifted away from 2025 month. SU = shifted into 2026 month.',
    fill:      fill('444444'),
    font:      font({ sz: 9, color: C.WH, italic: true }),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 15;

  let row = 4;

  // ── PART A — Key Statistics ────────────────────────────────────────────────
  ws.mergeCells(`A${row}:M${row}`);
  Object.assign(ws.getCell(`A${row}`), {
    value:     'PART A — Key Statistics',
    fill:      fill(C.DK),
    font:      font({ bold: true, sz: 11, color: C.WH }),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(row).height = 18; row++;

  // Group labels row
  const grp_labels = ['Total Shifted','Moving Later →','Moving Earlier ←','Avg Distance'];
  const grp_cols   = [2, 5, 8, 11];
  grp_labels.forEach((label, i) => {
    td(ws.getCell(row, grp_cols[i]), label, { bg: C.LG, bold: true, hAlign: 'center', sz: 9 });
  });
  ws.getRow(row).height = 14; row++;

  // Values row
  const grp_vals = [total, later, earlier, `${avg_dist} mo`];
  grp_vals.forEach((v, i) => {
    const c = ws.getCell(row, grp_cols[i]);
    c.value = v; c.font = font({ bold: true, sz: 14, color: C.DK });
    c.fill = fill(C.LG); c.alignment = align({ h: 'center' });
  });
  ws.getRow(row).height = 20; row++;

  // Pct/desc row
  const grp_pct = [
    `${((total/1178)*100).toFixed(1)}% of 2025 events`,
    `${((later/total)*100).toFixed(0)}% of all shifts`,
    `${((earlier/total)*100).toFixed(0)}% of all shifts`,
    'avg months between dates',
  ];
  grp_pct.forEach((v, i) => {
    td(ws.getCell(row, grp_cols[i]), v, { bg: C.LG, fg: '555555', hAlign: 'center', sz: 9 });
  });
  ws.getRow(row).height = 13; row++;

  // Type counts row
  const TYPES = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
  const by_type = {};
  TYPES.forEach(t => { by_type[t] = shifted.filter(r => r.e25.type === t).length; });
  const type_cols = [2, 5, 8, 11];
  TYPES.forEach((t, i) => {
    td(ws.getCell(row, type_cols[i]), t, { bg: C.LG, bold: true, hAlign: 'center', sz: 9 });
  });
  ws.getRow(row).height = 13; row++;

  TYPES.forEach((t, i) => {
    td(ws.getCell(row, type_cols[i]), by_type[t], { bg: C.LG, bold: true, hAlign: 'center', sz: 10 });
  });
  ws.getRow(row).height = 14; row++;

  TYPES.forEach((t, i) => {
    const pct = `${((by_type[t]/total)*100).toFixed(0)}% of shifts`;
    td(ws.getCell(row, type_cols[i]), pct, { bg: C.LG, fg: '555555', hAlign: 'center', sz: 9 });
  });
  ws.getRow(row).height = 13; row += 2;

  // ── PART B — Breakdown by type ─────────────────────────────────────────────
  ws.mergeCells(`A${row}:M${row}`);
  Object.assign(ws.getCell(`A${row}`), {
    value:     'PART B — Breakdown by Event Type',
    fill:      fill(C.DK),
    font:      font({ bold: true, sz: 11, color: C.WH }),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(row).height = 18; row++;

  // Header row (10 cols starting at col 2, matching reference)
  const b_hdrs = ['Type','Total','→ Later','← Earlier','1 Month','2 Months','3+ Months',
                  'Top Origin\nMonth','Top Dest.\nMonth','Interpretation'];
  ws.getCell(row, 1).fill = fill(C.DK);
  b_hdrs.forEach((h, i) => th(ws.getCell(row, i + 2), h, { bg: '37474F', sz: 9 }));
  ws.getRow(row).height = 28; row++;

  // Helper: top month for a set of shifts
  const top_month = (arr, mo_fn) => {
    const counts = {};
    arr.forEach(r => { const m = mo_fn(r); counts[m] = (counts[m]||0)+1; });
    const best = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return best ? MN[best[0]] : '—';
  };

  TYPES.forEach(t => {
    const sub   = shifted.filter(r => r.e25.type === t);
    const tot   = sub.length;
    const lat   = sub.filter(r => r.e26.month > r.e25.month).length;
    const ear   = sub.filter(r => r.e26.month < r.e25.month).length;
    const m1    = sub.filter(r => Math.abs(r.e26.month - r.e25.month) === 1).length;
    const m2    = sub.filter(r => Math.abs(r.e26.month - r.e25.month) === 2).length;
    const m3p   = sub.filter(r => Math.abs(r.e26.month - r.e25.month) >= 3).length;
    const t_orig = top_month(sub, r => r.e25.month);
    const t_dest = top_month(sub, r => r.e26.month);
    const interp = `${tot} shifted; ${lat} moved later, ${ear} moved earlier. Peak origin: ${t_orig}, peak dest: ${t_dest}.`;
    const bg = row % 2 === 0 ? C.LG : C.WH;

    ws.getRow(row).height = 14;
    td(ws.getCell(row, 1), '', { bg });
    [t, tot, lat, ear, m1, m2, m3p, t_orig, t_dest].forEach((v, i) => {
      td(ws.getCell(row, i + 2), v, { bg, hAlign: i === 0 ? 'left' : 'center', bold: i === 1, sz: 9 });
    });
    // Interpretation col (12) - merged to col 13
    ws.mergeCells(row, 11, row, 13);
    td(ws.getCell(row, 11), interp, { bg, fg: '444444', hAlign: 'left', sz: 8 });
    row++;
  });

  // Total row
  ws.getRow(row).height = 14;
  th(ws.getCell(row, 2), 'TOTAL', { bg: C.DK, sz: 9 });
  [total, later, earlier,
    shifted.filter(r=>Math.abs(r.e26.month-r.e25.month)===1).length,
    shifted.filter(r=>Math.abs(r.e26.month-r.e25.month)===2).length,
    shifted.filter(r=>Math.abs(r.e26.month-r.e25.month)>=3).length,
  ].forEach((v, i) => th(ws.getCell(row, i + 3), v, { bg: C.DK, sz: 9 }));
  ws.getCell(row, 1).fill = fill(C.DK);
  row += 2;

  // ── PART C — Full event roster ─────────────────────────────────────────────
  ws.mergeCells(`A${row}:M${row}`);
  Object.assign(ws.getCell(`A${row}`), {
    value:     `PART C — All ${total} Shifted Events  (sorted by direction → Later first, then months shifted, then type)`,
    fill:      fill(C.DK),
    font:      font({ bold: true, sz: 11, color: C.WH }),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(row).height = 18; row++;

  // Headers matching reference: Direction | Months Shifted | Type | 2025 Month | 2025 Sanction ID | 2025 Start Date | 2025 Event Name | 2026 Month | 2026 Sanction ID | 2026 Start Date | 2026 Event Name | Confidence
  const c_hdrs = ['Direction','Months\nShifted','Type','2025\nMonth','2025 Sanction ID','2025 Start Date',
                  '2025 Event Name','2026\nMonth','2026 Sanction ID','2026 Start Date','2026 Event Name','Confidence'];
  c_hdrs.forEach((h, i) => th(ws.getCell(row, i + 1), h, { bg: C.MR, sz: 9 }));
  ws.getRow(row).height = 28; row++;

  // Sort: → Later first, then by months shifted asc, then type, then 2025 month
  const sorted = [...shifted].sort((a, b) => {
    const a_dir = a.e26.month > a.e25.month ? 0 : 1;
    const b_dir = b.e26.month > b.e25.month ? 0 : 1;
    if (a_dir !== b_dir) return a_dir - b_dir;
    const a_abs = Math.abs(a.e26.month - a.e25.month);
    const b_abs = Math.abs(b.e26.month - b.e25.month);
    if (a_abs !== b_abs) return a_abs - b_abs;
    if (a.e25.type !== b.e25.type) return a.e25.type < b.e25.type ? -1 : 1;
    return a.e25.month - b.e25.month;
  });

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const ev_row = row + i;
    const bg = i % 2 === 0 ? C.LG : C.WH;
    const delta = r.e26.month - r.e25.month;
    const abs_d = Math.abs(delta);
    const dir   = delta > 0 ? `→ ${abs_d} mo later` : `← ${abs_d} mo earlier`;
    const dir_bg = delta > 0 ? C.BBG : C.ABG;
    const dir_fg = delta > 0 ? C.BD  : C.AM;

    ws.getRow(ev_row).height = 18;
    Object.assign(ws.getCell(ev_row, 1), {
      value: dir,
      font: font({ bold: true, sz: 9, color: dir_fg }),
      fill: fill(dir_bg),
      alignment: align({ h: 'center' }),
    });
    td(ws.getCell(ev_row,  2), abs_d,          { bg, hAlign: 'center', sz: 9 });
    td(ws.getCell(ev_row,  3), r.e25.type,     { bg, hAlign: 'left',   sz: 9 });
    td(ws.getCell(ev_row,  4), MN[r.e25.month],{ bg, bold: true, hAlign: 'center' });
    td(ws.getCell(ev_row,  5), r.e25.sanctionId, { bg, hAlign: 'left', sz: 8 });
    td(ws.getCell(ev_row,  6), r.e25.startDate ? r.e25.startDate.toISOString().slice(0,10) : '', { bg, hAlign: 'center', sz: 8 });
    td(ws.getCell(ev_row,  7), r.e25.name,     { bg, hAlign: 'left',   sz: 9 });
    td(ws.getCell(ev_row,  8), MN[r.e26.month],{ bg, bold: true, hAlign: 'center', fg: dir_fg });
    td(ws.getCell(ev_row,  9), r.e26.sanctionId, { bg, hAlign: 'left', sz: 8 });
    td(ws.getCell(ev_row, 10), r.e26.startDate ? r.e26.startDate.toISOString().slice(0,10) : '', { bg, hAlign: 'center', sz: 8 });
    td(ws.getCell(ev_row, 11), r.e26.name,     { bg, hAlign: 'left',   sz: 9 });
    td(ws.getCell(ev_row, 12), r.conf || 'Exact-Shifted', { bg, hAlign: 'center', sz: 8 });
  }

  applyBorders(ws, row - 1, row + sorted.length - 1, 1, 12);
  ws.autoFilter = {
    from: { row: row - 1, column: 1 },
    to:   { row: row + sorted.length - 1, column: 12 },
  };
};
