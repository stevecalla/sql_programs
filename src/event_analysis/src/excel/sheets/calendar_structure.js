/**
 * step_0_calendar_structure — prior-year vs current-year side-by-side calendar.
 */

'use strict';

const { C, fill, font, align, applyBorders, th } = require('../styles');
const { weekendDays, usHolidays, calendarNotes, monthGrid, dow } = require('../../calendar');

const MNL = ['','January','February','March','April','May','June',
             'July','August','September','October','November','December'];
const DOW_HDRS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MN_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

module.exports = function build_calendar_structure(wb, results) {
  const YA = results?.years?.BASELINE_YEAR ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.ANALYSIS_YEAR ?? new Date().getFullYear();
  const ws = wb.addWorksheet('step_0_calendar_structure');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // Column widths: A(wk label), B-H(BASELINE_YEAR), I(spacer), J-P(ANALYSIS_YEAR), Q(notes)
  const colWidths = [10, 8,8,8,8,8,9,9, 2, 8,8,8,8,8,9,9, 36];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: title
  ws.mergeCells('A1:Q1');
  const t1 = ws.getCell('A1');
  t1.value     = `Side-by-Side Calendar ${YA} vs ${YB}  |  Green=Weekend (Sat/Sun)  |  Amber=Major Holiday  |  Notes=key calendar changes`;
  t1.font      = font({ bold: true, sz: 12, color: C.WH });
  t1.fill      = fill(C.DR);
  t1.alignment = align({ h: 'left', wrap: false });
  ws.getRow(1).height = 24;

  // Row 2: legend
  ws.mergeCells('A2:Q2');
  const t2 = ws.getCell('A2');
  t2.value     = '⚠=Holiday moves onto/off weekend  |  ↕=Holiday date shift  |  Amber note=weekend day count change (Sat or Sun)';
  t2.font      = font({ sz: 9, color: C.WH });
  t2.fill      = fill('444444');
  t2.alignment = align({ h: 'left' });
  ws.getRow(2).height = 18;

  const hols25 = usHolidays(YA);
  const hols26 = usHolidays(YB);

  // Helper: is a date a holiday?
  function isHoliday(year, month, day) {
    const hols = year === YA ? hols25 : hols26;
    return hols.some(h => h.month === month && h.day === day);
  }
  // Helper: holiday name (or null) for a (year, month, day) — used for cell tooltips.
  function holidayName(year, month, day) {
    const hols = year === YA ? hols25 : hols26;
    const found = hols.find(h => h.month === month && h.day === day);
    return found ? found.name : null;
  }

  let row = 3;

  for (let m = 1; m <= 12; m++) {
    const notes = calendarNotes(m);

    // Month header row
    ws.mergeCells(`A${row}:H${row}`);
    Object.assign(ws.getCell(`A${row}`), {
      value:     `${MNL[m]} ${YA}`,
      font:      font({ bold: true, sz: 11, color: C.WH }),
      fill:      fill('1A237E'),
      alignment: align({ h: 'center' }),
    });
    ws.mergeCells(`J${row}:P${row}`);
    Object.assign(ws.getCell(`J${row}`), {
      value:     `${MNL[m]} ${YB}`,
      font:      font({ bold: true, sz: 11, color: C.WH }),
      fill:      fill('006064'),
      alignment: align({ h: 'center' }),
    });
    ws.getCell(row, 9).fill = fill('EEEEEE');  // spacer

    // Notes column Q — calendar shifts + a holiday line for this month.
    const month_hols_a = hols25.filter(h => h.month === m).map(h => `${h.name} ${MN_SHORT[m]} ${h.day}`);
    const month_hols_b = hols26.filter(h => h.month === m).map(h => `${h.name} ${MN_SHORT[m]} ${h.day}`);
    const holiday_lines = [];
    if (month_hols_a.length) holiday_lines.push(`${YA} hol: ${month_hols_a.join(', ')}`);
    if (month_hols_b.length) holiday_lines.push(`${YB} hol: ${month_hols_b.join(', ')}`);
    const all_lines = [...notes, ...holiday_lines];
    if (all_lines.length) {
      const hasWarn = notes.some(n => n.includes('⚠'));
      const hasWknd = notes.some(n => n.includes('Wknd'));
      const noteBg  = hasWarn ? C.RBG : hasWknd ? C.ABG : (holiday_lines.length ? C.ABG : 'F3E5F5');
      const noteFg  = hasWarn ? C.RD  : hasWknd ? C.AM  : (holiday_lines.length ? C.AM  : '6A1B9A');
      const nc = ws.getCell(row, 17);
      nc.value     = all_lines.join('\n');
      nc.font      = font({ bold: hasWarn || hasWknd, sz: 8.5, color: noteFg });
      nc.fill      = fill(noteBg);
      nc.alignment = align({ h: 'left', wrap: true });
    }
    ws.getRow(row).height = all_lines.length ? Math.min(60, 24 + all_lines.length * 9) : 22;
    row++;

    // DOW header row
    // Col 1: blank, cols 2-8: Mon→Sun for BASELINE_YEAR, col 9: spacer, cols 10-16: Mon→Sun for ANALYSIS_YEAR
    ws.getCell(row, 1).fill = fill('37474F');
    DOW_HDRS.forEach((d, i) => {
      th(ws.getCell(row, i + 2), d, { bg: '37474F', sz: 9 });   // BASELINE_YEAR side
      th(ws.getCell(row, i + 10), d, { bg: '37474F', sz: 9 });  // ANALYSIS_YEAR side
    });
    ws.getCell(row, 9).fill = fill('EEEEEE');
    th(ws.getCell(row, 17), 'Notes', { bg: '555555', sz: 8 });
    ws.getRow(row).height = 18;
    row++;

    // Week rows
    const grid25 = monthGrid(YA, m);
    const grid26 = monthGrid(YB, m);
    const maxWks = Math.max(grid25.length, grid26.length);

    for (let wk = 0; wk < maxWks; wk++) {
      ws.getRow(row).height = 16;

      // Week label
      Object.assign(ws.getCell(row, 1), {
        value:     `Wk ${wk + 1}`,
        font:      font({ sz: 8, color: '888888' }),
        fill:      fill('EEEEEE'),
        alignment: align({ h: 'center' }),
      });

      // BASELINE_YEAR: cols 2-8 (dow 0=Mon → col 2)
      const week25 = grid25[wk] || new Array(7).fill(0);
      for (let d = 0; d < 7; d++) {
        const dn  = week25[d];
        const col = d + 2;
        const cell = ws.getCell(row, col);
        if (!dn) {
          cell.fill = fill('F5F5F5');
        } else {
          const isWknd = d >= 5;                          // Sat(5) or Sun(6) in Mon-based grid
          const isHol  = isHoliday(YA, m, dn);
          const hname  = isHol ? holidayName(YA, m, dn) : null;
          cell.value     = dn;
          cell.font      = font({ bold: dn === 1 || isHol, sz: 9, color: isHol ? C.AM : isWknd ? C.GD : '333333' });
          cell.fill      = fill(isHol ? C.ABG : isWknd ? C.GBG : C.WH);
          cell.alignment = align({ h: 'center' });
          if (hname) {
            cell.note = { texts: [{ text: `${hname} (${YA})` }], margins: { insetmode: 'auto' } };
          }
        }
      }

      // Spacer
      ws.getCell(row, 9).fill = fill('EEEEEE');

      // ANALYSIS_YEAR: cols 10-16 (dow 0=Mon → col 10)
      const week26 = grid26[wk] || new Array(7).fill(0);
      for (let d = 0; d < 7; d++) {
        const dn  = week26[d];
        const col = d + 10;
        const cell = ws.getCell(row, col);
        if (!dn) {
          cell.fill = fill('F5F5F5');
        } else {
          const isWknd = d >= 5;
          const isHol  = isHoliday(YB, m, dn);
          const hname  = isHol ? holidayName(YB, m, dn) : null;
          cell.value     = dn;
          cell.font      = font({ bold: dn === 1 || isHol, sz: 9, color: isHol ? C.AM : isWknd ? C.GD : '333333' });
          cell.fill      = fill(isHol ? C.ABG : isWknd ? C.GBG : C.WH);
          cell.alignment = align({ h: 'center' });
          if (hname) {
            cell.note = { texts: [{ text: `${hname} (${YB})` }], margins: { insetmode: 'auto' } };
          }
        }
      }
      row++;
    }

    // Gap between months
    ws.getRow(row).height = 5;
    row++;
  }

  return ws;
};
