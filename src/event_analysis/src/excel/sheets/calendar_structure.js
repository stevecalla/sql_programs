/**
 * step_0_calendar_structure — 2025 vs 2026 side-by-side calendar.
 */

'use strict';

const { C, fill, font, align, applyBorders, th } = require('../styles');
const { weekendDays, usHolidays, calendarNotes, monthGrid, dow } = require('../../calendar');

const MNL = ['','January','February','March','April','May','June',
             'July','August','September','October','November','December'];
const DOW_HDRS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

module.exports = function build_calendar_structure(wb) {
  const ws = wb.addWorksheet('step_0_calendar_structure');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // Column widths: A(wk label), B-H(2025), I(spacer), J-P(2026), Q(notes)
  const colWidths = [10, 8,8,8,8,8,9,9, 2, 8,8,8,8,8,9,9, 36];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: title
  ws.mergeCells('A1:Q1');
  const t1 = ws.getCell('A1');
  t1.value     = 'Side-by-Side Calendar 2025 vs 2026  |  Green=Weekend (Sat/Sun)  |  Amber=Major Holiday  |  Notes=key calendar changes';
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

  const hols25 = usHolidays(2025);
  const hols26 = usHolidays(2026);

  // Helper: is a date a holiday?
  function isHoliday(year, month, day) {
    const hols = year === 2025 ? hols25 : hols26;
    return hols.some(h => h.month === month && h.day === day);
  }

  let row = 3;

  for (let m = 1; m <= 12; m++) {
    const notes = calendarNotes(m);

    // Month header row
    ws.mergeCells(`A${row}:H${row}`);
    Object.assign(ws.getCell(`A${row}`), {
      value:     `${MNL[m]} 2025`,
      font:      font({ bold: true, sz: 11, color: C.WH }),
      fill:      fill('1A237E'),
      alignment: align({ h: 'center' }),
    });
    ws.mergeCells(`J${row}:P${row}`);
    Object.assign(ws.getCell(`J${row}`), {
      value:     `${MNL[m]} 2026`,
      font:      font({ bold: true, sz: 11, color: C.WH }),
      fill:      fill('006064'),
      alignment: align({ h: 'center' }),
    });
    ws.getCell(row, 9).fill = fill('EEEEEE');  // spacer

    // Notes column Q
    if (notes.length) {
      const hasWarn = notes.some(n => n.includes('⚠'));
      const hasWknd = notes.some(n => n.includes('Wknd'));
      const noteBg  = hasWarn ? C.RBG : hasWknd ? C.ABG : 'F3E5F5';
      const noteFg  = hasWarn ? C.RD  : hasWknd ? C.AM  : '6A1B9A';
      const nc = ws.getCell(row, 17);
      nc.value     = notes.join('\n');
      nc.font      = font({ bold: true, sz: 9, color: noteFg });
      nc.fill      = fill(noteBg);
      nc.alignment = align({ h: 'left', wrap: true });
    }
    ws.getRow(row).height = notes.length ? 36 : 22;
    row++;

    // DOW header row
    // Col 1: blank, cols 2-8: Mon→Sun for 2025, col 9: spacer, cols 10-16: Mon→Sun for 2026
    ws.getCell(row, 1).fill = fill('37474F');
    DOW_HDRS.forEach((d, i) => {
      th(ws.getCell(row, i + 2), d, { bg: '37474F', sz: 9 });   // 2025 side
      th(ws.getCell(row, i + 10), d, { bg: '37474F', sz: 9 });  // 2026 side
    });
    ws.getCell(row, 9).fill = fill('EEEEEE');
    th(ws.getCell(row, 17), 'Notes', { bg: '555555', sz: 8 });
    ws.getRow(row).height = 18;
    row++;

    // Week rows
    const grid25 = monthGrid(2025, m);
    const grid26 = monthGrid(2026, m);
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

      // 2025: cols 2-8 (dow 0=Mon → col 2)
      const week25 = grid25[wk] || new Array(7).fill(0);
      for (let d = 0; d < 7; d++) {
        const dn  = week25[d];
        const col = d + 2;
        const cell = ws.getCell(row, col);
        if (!dn) {
          cell.fill = fill('F5F5F5');
        } else {
          const isWknd = d >= 5;                          // Sat(5) or Sun(6) in Mon-based grid
          const isHol  = isHoliday(2025, m, dn);
          cell.value     = dn;
          cell.font      = font({ bold: dn === 1 || isHol, sz: 9, color: isHol ? C.AM : isWknd ? C.GD : '333333' });
          cell.fill      = fill(isHol ? C.ABG : isWknd ? C.GBG : C.WH);
          cell.alignment = align({ h: 'center' });
        }
      }

      // Spacer
      ws.getCell(row, 9).fill = fill('EEEEEE');

      // 2026: cols 10-16 (dow 0=Mon → col 10)
      const week26 = grid26[wk] || new Array(7).fill(0);
      for (let d = 0; d < 7; d++) {
        const dn  = week26[d];
        const col = d + 10;
        const cell = ws.getCell(row, col);
        if (!dn) {
          cell.fill = fill('F5F5F5');
        } else {
          const isWknd = d >= 5;
          const isHol  = isHoliday(2026, m, dn);
          cell.value     = dn;
          cell.font      = font({ bold: dn === 1 || isHol, sz: 9, color: isHol ? C.AM : isWknd ? C.GD : '333333' });
          cell.fill      = fill(isHol ? C.ABG : isWknd ? C.GBG : C.WH);
          cell.alignment = align({ h: 'center' });
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
