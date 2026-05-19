/**
 * step_4_cancelled_cross_match — Tried to Return + Recovered event lists.
 */

'use strict';

const { C, fill, font, align, applyBorders, th, td } = require('../styles');

const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

module.exports = function build_cancelled_cross_match(wb, results) {
  const YA = results?.years?.BASELINE_YEAR ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.ANALYSIS_YEAR ?? new Date().getFullYear();
  const { triedToReturn, recovered } = results;
  const ws = wb.addWorksheet('step_4d_cancelled_cross_match');
  ws.views = [{ state: 'frozen', ySplit: 5 }];

  const COLS = [
    [`${YA}\nMonth`,10],['Type',14],[`${YA} Sanction ID`,24],[`${YA} Event Name`,44],
    [`${YB}\nMonth`,10],[`${YB} Sanction ID`,24],[`${YB} Status`,16],[`${YB} Event Name`,44],
  ];
  COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });

  // Title
  ws.mergeCells('A1:H1');
  Object.assign(ws.getCell('A1'), {
    value:     `Cancelled Cross-Match  |  Tried to Return: ${triedToReturn.length}  |  Recovered: ${recovered.length}`,
    font:      font({ bold: true, sz: 12, color: C.WH }),
    fill:      fill(C.DR),
    alignment: align({ h: 'left' }),
  });
  ws.getRow(1).height = 24;

  function writeSection(startRow, data, bg, fg, title) {
    ws.mergeCells(`A${startRow}:H${startRow}`);
    Object.assign(ws.getCell(`A${startRow}`), {
      value:     title,
      font:      font({ bold: true, sz: 10, color: C.WH }),
      fill:      fill(fg),
      alignment: align({ h: 'left' }),
    });
    ws.getRow(startRow).height = 22;

    // Sub-headers
    COLS.forEach(([h], i) => { th(ws.getCell(startRow + 1, i + 1), h, { bg: fg, sz: 9 }); });
    ws.getRow(startRow + 1).height = 24;

    const sortedData = [...data].sort((a, b) => (a.month25 ?? 0) - (b.month25 ?? 0) || (a.type < b.type ? -1 : 1));
    for (let i = 0; i < sortedData.length; i++) {
      const d   = sortedData[i];
      const row = startRow + 2 + i;
      const rbg = i % 2 === 0 ? bg : (bg === C.TRBG ? 'FFF8F4' : 'F8F2FF');
      ws.getRow(row).height = 18;

      td(ws.getCell(row, 1), d.month25 ? MN[d.month25] : '?', { bg: rbg, bold: true, hAlign: 'center', fg });
      td(ws.getCell(row, 2), d.type,          { bg: rbg, hAlign: 'left' });
      td(ws.getCell(row, 3), d.sanctionId25 ?? '', { bg: rbg, hAlign: 'left', sz: 8 });
      td(ws.getCell(row, 4), d.name25,         { bg: rbg, hAlign: 'left', italic: bg === C.RECBG });
      td(ws.getCell(row, 5), d.month26 ? MN[d.month26] : '?', { bg: rbg, bold: true, hAlign: 'center', fg });
      td(ws.getCell(row, 6), d.sanctionId26 ?? '', { bg: rbg, hAlign: 'left', sz: 8 });
      td(ws.getCell(row, 7), d.status26,       { bg: rbg, bold: true, hAlign: 'center', fg: bg === C.TRBG ? C.RD : C.GD });
      td(ws.getCell(row, 8), d.name26,         { bg: rbg, hAlign: 'left', italic: bg === C.TRBG });
    }
    applyBorders(ws, startRow + 1, startRow + 1 + sortedData.length, 1, 8);
    return startRow + 2 + sortedData.length;
  }

  const trTitle  = `TRIED TO RETURN (${triedToReturn.length}) — ${YA} active events that re-filed in ${YB} but were Cancelled / Declined`;
  const recTitle = `RECOVERED (${recovered.length}) — ${YA} Cancelled events that successfully sanctioned in ${YB}`;

  let nextRow = writeSection(3, triedToReturn, C.TRBG, C.TRFG, trTitle);
  nextRow = writeSection(nextRow + 2, recovered, C.RECBG, C.RECFG, recTitle);

  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
};
