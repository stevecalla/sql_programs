/**
 * step_4_event_detail — full event roster with 6-segment classification.
 */

'use strict';

const { C, fill, font, align, applyBorders, th, td, SEG_COLORS, CONF_SHADE } = require('../styles');

const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

const SEG_ORDER = { 'Retained':0,'Shifted':1,'Tried to Return':2,'Lost':3,'Recovered':4,'New':5 };

module.exports = function build_event_detail(wb, results) {
  const { segments } = results;
  const ws = wb.addWorksheet('step_4_event_detail');
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  // 16 columns matching reference v9f exactly
  const COLS = [
    ['Segment',        12], ['Confidence',       14], ['Type',             14],
    ['Month 2025',     10], ['2025 Sanction ID', 24], ['2025 Start Date',  13],
    ['2025\nDay',       9], ['2025 Event Name',  50], ['2025 Status',      20],
    ['→',               3],
    ['Month 2026',     10], ['2026 Sanction ID', 24], ['2026 Start Date',  13],
    ['2026\nDay',       9], ['2026 Event Name',  50], ['2026 Status',      20],
  ];
  COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });

  // Helper: day-of-week abbreviation from a Date string
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const day_of = d => d ? DAY_NAMES[new Date(d).getDay()] : '';

  // Rows 1-2: title
  ws.mergeCells('A1:P1');
  Object.assign(ws.getCell('A1'), {
    value:     `Event Detail Roster  |  1,477 roster rows  |  Note: roster row count (1,477) may differ from active event count (1,166/1,178) due to multi-type events`,
    font:      font({ bold: true, sz: 11, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:P2');
  Object.assign(ws.getCell('A2'), {
    value:     'Green=Retained | Amber=Shifted | Orange=Tried to Return (2025 active → 2026 cancelled) | Red=Lost | Purple=Recovered (2025 cancelled → 2026 active) | Blue=New',
    font:      font({ sz: 8, color: C.WH }),
    fill:      fill('444444'),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(2).height = 20;

  // Row 3: headers (cols 1-3=dark, 4-9=navy, 10=dark, 11-16=teal)
  COLS.forEach(([h], i) => {
    const bg = i < 3 ? C.DK : i < 9 ? '1A237E' : i === 9 ? C.DK : '006064';
    if (h) th(ws.getCell(3, i + 1), h, { bg, sz: 9 });
    else ws.getCell(3, i + 1).fill = fill('F0F0F0');
  });
  ws.getRow(3).height = 28;

  // Build roster (all segments)
  const all = [
    ...segments.retained,
    ...segments.shifted,
    ...segments.triedToReturn,
    ...segments.attrited,
    ...segments.recovered,
    ...segments.new,
  ];

  // Sort: month → segment order → type → name
  all.sort((a, b) => {
    const m_a = a.e25?.month ?? a.e26?.month ?? 0;
    const m_b = b.e25?.month ?? b.e26?.month ?? 0;
    if (m_a !== m_b) return m_a - m_b;
    if (SEG_ORDER[a.seg] !== SEG_ORDER[b.seg]) return SEG_ORDER[a.seg] - SEG_ORDER[b.seg];
    const t_a = a.e25?.type ?? a.e26?.type ?? '';
    const t_b = b.e25?.type ?? b.e26?.type ?? '';
    if (t_a !== t_b) return t_a < t_b ? -1 : 1;
    return 0;
  });

  for (let ri = 0; ri < all.length; ri++) {
    const row = ri + 4;
    const m   = all[ri];
    const e25 = m.e25;
    const e26 = m.e26;
    ws.getRow(row).height = 16;

    const [sbg, sfg] = SEG_COLORS[m.seg] ?? [C.LG, C.DK];
    const cbg = CONF_SHADE[m.conf] ?? 'F5F5F5';

    // Segment
    const sc = ws.getCell(row, 1);
    sc.value     = m.seg;
    sc.font      = font({ bold: true, sz: 9, color: sfg });
    sc.fill      = fill(sbg);
    sc.alignment = align({ h: 'center' });

    // Confidence
    const cc = ws.getCell(row, 2);
    cc.value     = m.conf;
    cc.font      = font({ sz: 8, color: '333333', italic: m.conf === 'Low' });
    cc.fill      = fill(cbg);
    cc.alignment = align({ h: 'center' });

    // Type
    td(ws.getCell(row, 3), e25?.type ?? e26?.type ?? '', { bg: sbg, hAlign: 'left', sz: 9 });

    // 2025 columns (4-9)
    if (e25) {
      td(ws.getCell(row, 4), MN[e25.month],  { bg: sbg, bold: true, hAlign: 'center' });
      td(ws.getCell(row, 5), e25.sanctionId, { bg: sbg, hAlign: 'left',   sz: 8 });
      td(ws.getCell(row, 6), e25.startDate ? e25.startDate.toISOString().slice(0,10) : '', { bg: sbg, hAlign: 'center', sz: 8 });
      td(ws.getCell(row, 7), day_of(e25.startDate), { bg: sbg, hAlign: 'center', sz: 8 });
      td(ws.getCell(row, 8), e25.name,       { bg: sbg, hAlign: 'left',   sz: 9 });
      td(ws.getCell(row, 9), e25.status ?? '', { bg: sbg, hAlign: 'center', sz: 8 });
    } else {
      for (let c = 4; c <= 9; c++) {
        ws.getCell(row, c).value = '—';
        ws.getCell(row, c).font  = font({ sz: 8, color: 'CCCCCC' });
        ws.getCell(row, c).fill  = fill('F8F8F8');
        ws.getCell(row, c).alignment = align({ h: 'center' });
      }
    }

    // Arrow (col 10)
    const arrow = ws.getCell(row, 10);
    arrow.value     = e25 && e26 ? '→' : '';
    arrow.font      = font({ sz: 10, color: '888888' });
    arrow.fill      = fill(C.WH);
    arrow.alignment = align({ h: 'center' });

    // 2026 columns (11-16)
    if (e26) {
      const m26   = e26.month;
      const m25v  = e25?.month;
      const col_fg = (m25v && m26 !== m25v) ? C.AM : sfg;
      td(ws.getCell(row, 11), MN[m26],       { bg: sbg, bold: true, hAlign: 'center', fg: col_fg });
      td(ws.getCell(row, 12), e26.sanctionId,{ bg: sbg, hAlign: 'left',   sz: 8 });
      td(ws.getCell(row, 13), e26.startDate ? e26.startDate.toISOString().slice(0,10) : '', { bg: sbg, hAlign: 'center', sz: 8 });
      td(ws.getCell(row, 14), day_of(e26.startDate), { bg: sbg, hAlign: 'center', sz: 8 });
      td(ws.getCell(row, 15), e26.name,      { bg: sbg, hAlign: 'left',   sz: 9 });
      td(ws.getCell(row, 16), e26.status ?? '', { bg: sbg, hAlign: 'center', sz: 8 });
    } else {
      for (let c = 11; c <= 16; c++) {
        ws.getCell(row, c).value = '—';
        ws.getCell(row, c).font  = font({ sz: 8, color: 'CCCCCC' });
        ws.getCell(row, c).fill  = fill('F8F8F8');
        ws.getCell(row, c).alignment = align({ h: 'center' });
      }
    }
  }

  applyBorders(ws, 3, 3 + all.length, 1, 16);
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + all.length, column: 16 } };

  // ── Status legend & methodology note — matching reference v9f layout ──────
  // Reference: col1=blank, col2=status label, col3-7=description (merged)
  const legend_start = 3 + all.length + 2;
  const statuses = [
    ['COMPLETE',   'Event has concluded; post-race data available. Race results submitted.'],
    ['POST_RACE',  'Event has concluded; post-race processing in progress. Results pending.'],
    ['SUBMITTED',  'Application submitted and under review by USAT sanctioning team.'],
    ['CANCELLED',  'Event or application was cancelled before the event date.'],
    ['DECLINED',   'Application was reviewed and declined by USAT. Event did not run.'],
    ['DELETED',    'Record removed from the system. Excluded from all analysis counts.'],
  ];
  for (let i = 0; i < statuses.length; i++) {
    const row = legend_start + i;
    const [label, desc] = statuses[i];
    ws.getRow(row).height = 13;
    // Col 1: blank spacer
    ws.getCell(row, 1).fill = fill(C.LG);
    // Col 2: status label (bold)
    const lc = ws.getCell(row, 2);
    lc.value = label; lc.font = font({ bold: true, sz: 9, color: C.DK }); lc.fill = fill(C.LG); lc.alignment = align({ h: 'left' });
    // Cols 3-7: description merged
    ws.mergeCells(row, 3, row, 7);
    const dc2 = ws.getCell(row, 3);
    dc2.value = desc; dc2.font = font({ sz: 9, color: '555555', italic: true }); dc2.fill = fill(C.LG); dc2.alignment = align({ h: 'left' });
  }
  const meta_row = legend_start + statuses.length + 1;
  ws.mergeCells(meta_row, 1, meta_row, 16);
  const mhc = ws.getCell(meta_row, 1);
  mhc.value = '  METHODOLOGY NOTE'; mhc.font = font({ bold: true, sz: 9, color: C.WH }); mhc.fill = fill(C.DK); mhc.alignment = align({ h: 'left' }); ws.getRow(meta_row).height = 13;
  ws.getRow(meta_row + 1).height = 13;
  ws.mergeCells(meta_row + 1, 1, meta_row + 1, 16);
  const mtc = ws.getCell(meta_row + 1, 1);
  mtc.value = 'Event matching: (1) Exact sanction-ID match, (2) Exact name match after normalisation, (3) Fuzzy Jaccard similarity >= 0.55 with date-proximity weighting. Excl. Cancelled/Declined/Deleted. Cross-match: 2025 active -> 2026 cancelled = Tried to Return; 2025 cancelled -> 2026 active = Recovered.';
  mtc.font = font({ sz: 8.5, color: '444444', italic: true }); mtc.fill = fill('F5F5F5'); mtc.alignment = align({ h: 'left', wrap: true });

  return ws;
};
