/**
 * styles.js — colour palette + ExcelJS cell-styling helpers.
 *
 * ExcelJS uses ARGB hex strings (8 chars, alpha first).
 * All colour constants are stored WITHOUT the leading FF so they can be
 * passed to argb() which prepends it.
 */

'use strict';

// ── Colour palette (matches Python exactly) ───────────────────────────────
const C = {
  DR:    'BF1B2C',   // dark red (header)
  MR:    'D9534F',   // mid red
  DK:    '222222',   // dark charcoal
  LG:    'F2F2F2',   // light grey
  MG:    'ECEFF1',   // medium grey
  WH:    'FFFFFF',

  GD:    '1E7D34',   // green dark
  GBG:   'E8F5E9',   // green bg
  MGBG:  'C8E6C9',   // strong green bg

  RD:    '8B1A1A',   // red dark
  RBG:   'FDECEA',   // red bg
  MRDBG: 'FFCDD2',   // strong red bg

  BD:    '1565C0',   // blue dark
  BBG:   'E3F2FD',   // blue bg (DCEEFB also used → same hue)

  AM:    'E65100',   // amber dark
  ABG:   'FFF8E1',   // amber bg

  PD:    '4A148C',   // purple dark
  PBG:   'F3E5F5',   // purple bg

  TL:    '006064',   // teal dark
  TLBG:  'E0F2F1',   // teal bg

  TRBG:  'FFF3E0',   // tried-to-return bg (deep orange light)
  TRFG:  'BF360C',   // tried-to-return fg
  RECBG: 'F3E5F5',   // recovered bg (purple light)
  RECFG: '6A1B9A',   // recovered fg

  SLACK: '2EB67D',   // Slack green

  YLBG:  'FFF9C4',   // yellow bg (calendar expected highlight)
  YLD:   'F57F17',   // yellow dark
};

/** Prepend alpha FF to a 6-char hex colour for ExcelJS ARGB. */
const argb = hex => `FF${hex}`;

/** Solid fill helper. */
const fill = hex => ({
  type:     'pattern',
  pattern:  'solid',
  fgColor:  { argb: argb(hex) },
});

/** Font helper. */
function font({ bold = false, italic = false, sz = 10, color = C.DK, name = 'Calibri' } = {}) {
  return { name, size: sz, bold, italic, color: { argb: argb(color) } };
}

/** Alignment helper. */
function align({ h = 'center', v = 'middle', wrap = false, indent = 0 } = {}) {
  return { horizontal: h, vertical: v, wrapText: wrap, indent };
}

/** Thin border on all 4 sides. */
const THIN_BORDER = {
  top:    { style: 'thin', color: { argb: argb('CCCCCC') } },
  bottom: { style: 'thin', color: { argb: argb('CCCCCC') } },
  left:   { style: 'thin', color: { argb: argb('CCCCCC') } },
  right:  { style: 'thin', color: { argb: argb('CCCCCC') } },
};

/**
 * Apply borders to a rectangular range in a worksheet.
 * @param {ExcelJS.Worksheet} ws
 * @param {number} r1 startRow
 * @param {number} r2 endRow (inclusive)
 * @param {number} c1 startCol
 * @param {number} c2 endCol (inclusive)
 */
function applyBorders(ws, r1, r2, c1, c2) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      ws.getCell(r, c).border = THIN_BORDER;
    }
  }
}

/**
 * Fill an entire row with a background colour (columns 1–14 by default).
 */
function fillRow(ws, row, hex, c1 = 1, c2 = 14) {
  const f = fill(hex);
  for (let c = c1; c <= c2; c++) ws.getCell(row, c).fill = f;
}

/**
 * Write a header cell with standard header styling.
 */
function th(cell, text, {
  bg     = C.DK,
  fg     = C.WH,
  sz     = 9,
  bold   = true,
  wrap   = true,
  hAlign = 'center',
} = {}) {
  cell.value     = text;
  cell.font      = font({ bold, sz, color: fg });
  cell.fill      = fill(bg);
  cell.alignment = align({ h: hAlign, wrap });
}

/**
 * Write a data cell.
 */
function td(cell, value, {
  bg      = C.WH,
  fg      = C.DK,
  sz      = 9,
  bold    = false,
  italic  = false,
  hAlign  = 'right',
  fmt     = null,
  wrap    = false,
} = {}) {
  cell.value     = value ?? null;
  cell.font      = font({ bold, italic, sz, color: fg });
  cell.fill      = fill(bg);
  cell.alignment = align({ h: hAlign, v: 'middle', wrap: wrap || hAlign === 'left' });
  if (fmt) cell.numFmt = fmt;
}

/**
 * Write a delta (positive/negative) cell with green/red colouring.
 */
function dv(cell, value, bgHex, {
  fmt  = '+#,##0;-#,##0;"—"',
  sz   = 9,
  bold = true,
} = {}) {
  const v = value ?? 0;
  cell.value     = v !== 0 ? v : null;
  cell.numFmt    = fmt;
  cell.font      = font({ bold, sz, color: v > 0 ? C.GD : v < 0 ? C.RD : '777777' });
  cell.fill      = fill(bgHex);
  cell.alignment = align({ h: 'right' });
}

/**
 * Segment → [bgHex, fgHex] colour mapping.
 */
const SEG_COLORS = {
  'Retained':        [C.GBG,   C.GD],
  'Shifted':         [C.ABG,   C.AM],
  'Tried to Return': [C.TRBG,  C.TRFG],
  'Lost':        [C.RBG,   C.RD],
  'Recovered':       [C.RECBG, C.RECFG],
  'New':             [C.BBG,   C.BD],
};

const CONF_SHADE = {
  'Exact':          'A5D6A7',
  'Exact-Shifted':  'FFE082',
  'High':           'C8E6C9',
  'Medium':         'DCEEFB',
  'Low':            'FFCCBC',
  'N/A':            'F5F5F5',
  'Cross':          'EDE7F6',
};

module.exports = { C, argb, fill, font, align, THIN_BORDER, applyBorders, fillRow, th, td, dv, SEG_COLORS, CONF_SHADE };
