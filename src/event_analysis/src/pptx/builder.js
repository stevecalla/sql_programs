/**
 * src/pptx/builder.js — PowerPoint deck driven entirely by `results`.
 *
 * Every number, label, and table cell here comes from the analysis output
 * (the same object the Excel builder consumes) or from the commentary
 * object. Nothing is hardcoded — the deck for any pair of years renders
 * straight from the data.
 *
 *   results       — output of runAnalysis()
 *   commentary    — output of generate_rule_based() or generate_ai()
 *   rows25, rows26 — creation-pipeline rows (yr/type/mo/cnt) for each year
 */

'use strict';

const pptxgen = require('pptxgenjs');
const {
  MINUS, EM_DASH, EN_DASH, WARN, CHECK, ARROW_R,
  MN_SHORT: F_MN_SHORT, MN_FULL: F_MN_FULL,
  fmt_int: f_int, fmt_delta: f_delta, fmt_delta1: f_delta1, fmt_pct: f_pct, fmt_pct_n: f_pct_n,
  severity: f_severity, list_and: f_list_and,
} = require('../fmt');

// ── Colour palette ─────────────────────────────────────────────────────────
const RED  = 'BF1B2C', DK = '222222', WH = 'FFFFFF', LG = 'F5F5F5';
const GD   = '1E7D34', GBG = 'E8F5E9', MGBG = 'C8E6C9';
const RD   = 'C62828', RBG = 'FDECEA', MRDBG = 'FFCDD2';
const BL   = '1565C0', BBG = 'E3F2FD';
const AM   = 'E65100', ABG = 'FFF8E1';
const TEAL = '006064', PURP = '4A148C', DARK = '37474F';
const TOTAL_SLIDES = 8;

const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };
const MN_LONG = { 1:'January',2:'February',3:'March',4:'April',5:'May',6:'June',
                  7:'July',8:'August',9:'September',10:'October',11:'November',12:'December' };

// ── Number formatters (delegated to src/fmt.js for Unicode consistency) ─
const fmt_int   = f_int;
const fmt_delta = f_delta;
const fmt_delta1 = f_delta1;
const fmt_pct   = f_pct;

// ── Cell helpers (mirror the Excel sheet conventions) ──────────────────────
const hc = (t, bg = DK, fg = WH, sz = 10) => ({
  text: String(t),
  options: { fill: bg, color: fg, bold: true, fontSize: sz, align: 'center', valign: 'middle' }
});
const dc = (t, bg = WH, fg = DK, bold = false, align = 'center', sz = 10) => ({
  text: String(t),
  options: { fill: bg, color: fg, bold, fontSize: sz, align, valign: 'middle' }
});
const dv = (v, sz = 10) => {
  const s = String(v);
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return dc(s, n > 0 ? GBG : n < 0 ? RBG : LG, n > 0 ? GD : n < 0 ? RD : DK,
            Math.abs(n) >= 8, 'center', sz);
};

// ── Shape helpers ──────────────────────────────────────────────────────────
function add_header(prs, s, step, title, color = DK, slideNum = null) {
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.62, fill: { color }, line: { color } });
  s.addText(`${step}  —  ${title}`, {
    x: 0.18, y: 0.08, w: 9.0, h: 0.46,
    fontSize: 13.5, bold: true, color: WH, fontFace: 'Calibri'
  });
  if (slideNum) s.addText(`${slideNum} / ${TOTAL_SLIDES}`, {
    x: 9.25, y: 0.10, w: 0.65, h: 0.40,
    fontSize: 9, color: 'AAAAAA', align: 'right', valign: 'middle', fontFace: 'Calibri'
  });
}
function add_slide_num(s, n) {
  s.addText(`${n} / ${TOTAL_SLIDES}`, {
    x: 9.25, y: 5.38, w: 0.65, h: 0.20,
    fontSize: 8.5, color: 'FFAAAA', align: 'right', valign: 'middle', fontFace: 'Calibri'
  });
}
function callout(prs, s, text, x, y, w, h, bg, fg, sz = 10) {
  s.addShape(prs.ShapeType.rect, { x, y, w, h, fill: { color: bg }, line: { color: fg, pt: 1.2 } });
  s.addText(text, {
    x: x + 0.07, y, w: w - 0.14, h,
    fontSize: sz, color: fg, bold: true, align: 'center', valign: 'middle', fontFace: 'Calibri'
  });
}

// ── Data extraction from `results` ────────────────────────────────────────
function compute_totals(r) {
  const c25 = r?.c25 ?? {}, c26 = r?.c26 ?? {};
  const sum_type = (cx, t) => Object.values(cx ?? {}).reduce((s, m) => s + (m[t] ?? 0), 0);
  const by_type = TYPES.map(t => ({
    type: t,
    n25:  sum_type(c25, t),
    n26:  sum_type(c26, t),
    delta: sum_type(c26, t) - sum_type(c25, t),
    pct_str: fmt_pct(sum_type(c25, t), sum_type(c26, t)),
  }));
  const n25 = r?.y25active?.length ?? by_type.reduce((s, b) => s + b.n25, 0);
  const n26 = r?.y26active?.length ?? by_type.reduce((s, b) => s + b.n26, 0);
  return { c25, c26, by_type, n25, n26, net: n26 - n25, pct: fmt_pct(n25, n26) };
}
function monthly_rows(r) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const d = r?.monthly?.[m] ?? {};
    out.push({ m, label: MN[m], n25: d.n25 ?? 0, n26: d.n26 ?? 0,
               netDelta: d.netDelta ?? 0, netShift: d.netShift ?? 0,
               ret: d.ret ?? 0, sa: d.sa ?? 0, su: d.su ?? 0,
               attr: d.attr ?? 0, rec: d.rec ?? 0, new: d.new ?? 0, ttr: d.ttr ?? 0 });
  }
  return out;
}
function organic_rows(r) {
  return (r?.calImpact ?? []).map(ci => ({
    m: ci.month, label: MN[ci.month],
    tot25: ci.tot25 ?? 0, tot26: ci.tot26 ?? 0,
    actDelta: ci.actDelta ?? 0,
    calTotal: ci.calTotal ?? 0,
    orgTotal: ci.orgTotal ?? 0,
    dw: ci.dw ?? 0, ds: ci.ds ?? 0, du: ci.du ?? 0,
    calByType: ci.calByType ?? {}, orgByType: ci.orgByType ?? {},
  }));
}
function organic_by_type(r) {
  const obt = r?.organicByType ?? {};
  return TYPES.map(t => {
    const v = obt[t] ?? {};
    const tot25 = v.tot25 ?? 0;
    return {
      type: t,
      raw: v.actDelta ?? 0,
      cal: v.calTotal ?? 0,
      org: v.orgTotal ?? 0,
      org_pct: tot25 ? ((v.orgTotal ?? 0) / tot25) * 100 : 0,
    };
  });
}
function lost_by_type_for_months(r, months) {
  const out = {};
  for (const t of TYPES) out[t] = 0;
  let total = 0;
  for (const m of months) {
    const mt = r?.attrMt?.[m] ?? {};
    for (const t of TYPES) {
      const v = mt[t] ?? 0;
      out[t] += v;
      total  += v;
    }
  }
  return { by_type: out, total };
}

// ── Creation-pipeline helpers (Slide 7) ───────────────────────────────────
function pipeline_get(rows, yr, type = null, months = null) {
  return (rows ?? [])
    .filter(r => r.yr === yr
              && (type === null || r.type === type)
              && (months === null || months.includes(r.mo)))
    .reduce((s, r) => s + (r.cnt ?? 0), 0);
}
function in_year_cutoff(year_b) {
  const now = new Date();
  if (year_b === now.getFullYear()) {
    return Math.max(1, Math.min(12, now.getMonth() + 1));   // current month (1–12)
  }
  return 12;
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ════════════════════════════════════════════════════════════════════════════
function slide_1(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: RED };
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.0, fill: { color: 'AA1524' }, line: { color: 'AA1524' } });
  s.addText('USAT  |  Sanctioned Events Analysis', { x: 0.4, y: 0.15, w: 9, h: 0.55, fontSize: 12, color: 'FFAAAA', fontFace: 'Calibri' });
  s.addText('Sanctioned Events', { x: 0.4, y: 1.15, w: 9.2, h: 1.0, fontSize: 40, bold: true, color: WH, fontFace: 'Calibri' });
  s.addText(cm.slide_1_subtitle || `${T.year_a} vs ${T.year_b}  |  Year-over-Year Analysis`,
    { x: 0.4, y: 2.1, w: 9, h: 0.55, fontSize: 20, color: 'FFCCCC', fontFace: 'Calibri' });

  // Build default bullets dynamically from the data.
  const decliner = [...T.by_type].sort((a, b) => a.delta - b.delta)[0];
  const grower   = [...T.by_type].sort((a, b) => b.delta - a.delta)[0];
  const worst    = [...monthly_rows(r)].sort((a, b) => a.netDelta - b.netDelta).slice(0, 2);
  const summer_delta = worst.reduce((s, w) => s + w.netDelta, 0);
  const bullet_data = cm.slide_1_bullets ?? [
    { label: `${fmt_delta(T.net)} events overall`, bg_type: T.net >= 0 ? 'positive' : 'negative',
      sub: `${T.pct} -- headline change` },
    { label: `${decliner.type} ${decliner.pct_str}`, bg_type: decliner.delta < 0 ? 'negative' : 'positive',
      sub: decliner.delta < 0 ? 'Primary driver of decline' : 'Largest mover' },
    { label: `${worst.map(w => w.label).join(' & ')} ${fmt_delta(summer_delta)}`,
      bg_type: summer_delta < 0 ? 'negative' : 'positive',
      sub: `Combined ${fmt_delta(summer_delta)} from the two weakest months` },
    { label: `${grower.type} ${grower.pct_str}`, bg_type: grower.delta > 0 ? 'positive' : 'neutral',
      sub: grower.delta > 0 ? 'Only type growing -- bright spot' : 'Best of a soft set' },
  ];
  bullet_data.forEach(({ label, bg_type, sub }, i) => {
    const bg = bg_type === 'positive' ? GBG : bg_type === 'negative' ? RBG : LG;
    const fg = bg_type === 'positive' ? GD  : bg_type === 'negative' ? RD  : DK;
    const x = 0.4 + (i % 2) * 4.8, y = i < 2 ? 2.95 : 3.65;
    s.addShape(prs.ShapeType.rect, { x, y, w: 4.5, h: 0.6, fill: { color: bg }, line: { color: fg, pt: 1 } });
    s.addText(
      [{ text: label + ' ', options: { bold: true } }, { text: `(${sub})`, options: {} }],
      { x: x + 0.1, y, w: 4.3, h: 0.6, fontSize: 10, color: fg, valign: 'middle', fontFace: 'Calibri' }
    );
  });
  s.addText(
    cm.slide_1_data_note || `Data as of ${new Date().toISOString().slice(0,10)}  |  Excl. Cancelled / Declined / Deleted`,
    { x: 0.4, y: 5.1, w: 9, h: 0.35, fontSize: 8.5, color: 'FFAAAA', italic: true, fontFace: 'Calibri' }
  );
  add_slide_num(s, 1);
  s.addNotes(cm.notes?.slide_1 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — Step 0: Event counts by type
// ════════════════════════════════════════════════════════════════════════════
function slide_2(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  add_header(prs, s, 'Step 0', 'What Changed? Event Counts by Type', DK, 2);

  const rows = T.by_type.map((b, idx) => {
    // Color-key each row by sign of delta.
    const big_neg = b.delta < 0 && Math.abs(b.delta) >= 8;
    const big_pos = b.delta > 0 && Math.abs(b.delta) >= 5;
    const bg = big_neg ? RBG : big_pos ? GBG : (idx % 2 ? WH : LG);
    const fg = big_neg ? RD  : big_pos ? GD  : DK;
    return [
      dc(b.type, bg, fg, big_neg || big_pos, 'left'),
      dc(fmt_int(b.n25), bg),
      dc(fmt_int(b.n26), bg),
      dv(fmt_delta(b.delta)),
      dv(b.pct_str),
      dc(read_as(b), bg, fg, big_neg || big_pos, 'left', 9.5),
    ];
  });

  s.addTable([
    [hc('Event Type', '1A237E'), hc(String(T.year_a), '1A237E'), hc(String(T.year_b), '1A237E'),
     hc('Delta Count', '1A237E'), hc('Delta %', '1A237E'), hc('Read as...', '1A237E')],
    ...rows,
    [hc('TOTAL', DARK), hc(fmt_int(T.n25), DARK), hc(fmt_int(T.n26), DARK),
     hc(fmt_delta(T.net), DARK), hc(T.pct, DARK),
     hc(total_read_as(T), DARK)],
  ], { x: 0.3, y: 0.76, w: 9.4, h: 2.72, rowH: 0.44, fontSize: 10.5, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 3.62, w: 9.4, h: 1.1, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_2_narrative
        || `Across the four event types, ${T.year_b} ended at ${fmt_int(T.n26)} (vs ${fmt_int(T.n25)} in ${T.year_a}), a net ${fmt_delta(T.net)} (${T.pct}).` }
  ], { x: 0.42, y: 3.67, w: 9.1, h: 1.0, fontSize: 10, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_2 ?? '');
}
function read_as(b) {
  if (Math.abs(b.delta) < 3) return 'Essentially flat';
  if (b.delta > 0)  return `Growing (${fmt_delta(b.delta)})`;
  if (b.delta < -8) return 'Structural contraction';
  return 'Mild softness';
}
function total_read_as(T) {
  const worst = [...T.by_type].sort((a, b) => a.delta - b.delta)[0];
  if (T.net === 0)   return 'Flat YoY';
  if (T.net < 0)     return `${worst.type} drives the decline`;
  return `${T.by_type.find(b => b.delta === Math.max(...T.by_type.map(x => x.delta))).type} leads the growth`;
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Step 1: Monthly breakdown (with type detail for the worst months)
// ════════════════════════════════════════════════════════════════════════════
function slide_3(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  const M = monthly_rows(r);
  const worst = [...M].sort((a, b) => a.netDelta - b.netDelta).slice(0, 2);
  const best  = [...M].sort((a, b) => b.netDelta - a.netDelta).slice(0, 2);

  const header_label = cm.slide_3_header
    || (worst[0].netDelta < 0
        ? `Monthly Breakdown -- ${worst.map(w => w.label).join(' & ')} Drive the Declines`
        : 'Monthly Breakdown by Month');
  add_header(prs, s, 'Step 1', header_label, DK, 3);

  // Left: 12-row monthly table + Full Year footer.
  const monthly_table = [
    [hc('Month', '1A237E', WH, 10), hc(String(T.year_a), '1A237E', WH, 10),
     hc(String(T.year_b), '1A237E', WH, 10), hc('Var', '1A237E', WH, 10)],
    ...M.map(row => {
      const is_worst = worst.some(w => w.m === row.m);
      const pos = row.netDelta > 0;
      const bg = is_worst ? MRDBG : pos ? MGBG : WH;
      const fg = is_worst ? RD : pos ? GD : DK;
      return [
        dc(row.label, bg, fg, is_worst || (pos && row.netDelta >= 8), 'left', 10),
        dc(fmt_int(row.n25), bg, DK, false, 'center', 10),
        dc(fmt_int(row.n26), bg, DK, false, 'center', 10),
        dv(fmt_delta(row.netDelta), 10),
      ];
    }),
    [hc('Full Year', DARK), hc(fmt_int(T.n25), DARK), hc(fmt_int(T.n26), DARK), hc(fmt_delta(T.net), DARK)],
  ];
  s.addTable(monthly_table, { x: 0.3, y: 0.76, w: 3.4, h: 3.82, rowH: 0.27, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  // Right: per-type detail for the two worst months + Full Year row.
  s.addText(cm.slide_3_type_detail_label || `Type Detail -- ${worst.map(w => w.label).join(' & ')}`,
    { x: 3.9, y: 0.76, w: 5.9, h: 0.28, fontSize: 11, bold: true, color: DK, fontFace: 'Calibri' });

  const type_detail_rows = worst.map(w => {
    return [
      dc(MN_LONG[w.m], MRDBG, RD, true, 'left', 10),
      ...TYPES.map(t => {
        const d = (r.c26?.[w.m]?.[t] ?? 0) - (r.c25?.[w.m]?.[t] ?? 0);
        return d === 0 ? dc('--', MRDBG, 'AAAAAA') : dv(fmt_delta(d));
      }),
      dv(fmt_delta(w.netDelta)),
    ];
  });
  const full_year_typedetail = [
    dc('Full Year', LG, DK, true, 'left', 10),
    ...TYPES.map(t => {
      const b = T.by_type.find(x => x.type === t);
      return dv(fmt_delta(b.delta));
    }),
    dv(fmt_delta(T.net)),
  ];

  s.addTable([
    [hc('Month', DARK), hc('Adult Race', DARK), hc('Youth Race', DARK),
     hc('Adult Clinic', DARK), hc('Youth Clinic', DARK), hc('Total', DARK)],
    ...type_detail_rows,
    full_year_typedetail,
  ], { x: 3.9, y: 1.08, w: 5.9, h: 1.38, rowH: 0.32, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  callout(prs, s,
    cm.slide_3_callout_left
      || `${worst.map(w => w.label).join(' & ')} are the weakest -- combined ${fmt_delta(worst.reduce((s, w) => s + w.netDelta, 0))} events.`,
    3.9, 2.56, 5.9, 0.72, MRDBG, RD, 10);
  callout(prs, s,
    cm.slide_3_callout_right
      || `${best.map(b => `${b.label} (${fmt_delta(b.netDelta)})`).join(' and ')} are the strongest months.`,
    3.9, 3.38, 5.9, 1.00, MGBG, GD, 10);

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.72, w: 9.4, h: 0.50, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_3_narrative
        || `The monthly distribution shows concentrated declines in ${worst.map(w => w.label).join(' & ')} alongside strength in ${best.map(b => b.label).join(' and ')}.` }
  ], { x: 0.42, y: 4.75, w: 9.1, h: 0.44, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_3 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Step 2: Calendar impact (which deltas are calendar vs organic)
// ════════════════════════════════════════════════════════════════════════════
function slide_4(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  add_header(prs, s, 'Step 2', cm.slide_4_header || 'Is This a Calendar Effect?', TEAL, 4);

  const O = organic_rows(r);

  // Pick 5 most-informative months: 2 worst organic, 2 best organic, plus the
  // single most "misleading" month (sign mismatch between raw and organic).
  const by_org_asc  = [...O].sort((a, b) => a.orgTotal - b.orgTotal);
  const by_org_desc = [...O].sort((a, b) => b.orgTotal - a.orgTotal);
  const misleading = O
    .filter(o => Math.sign(o.actDelta) !== Math.sign(o.orgTotal) && o.dw !== 0)
    .sort((a, b) => Math.abs(b.actDelta - b.orgTotal) - Math.abs(a.actDelta - a.orgTotal))[0];
  const pickset = new Map();
  for (const o of by_org_asc.slice(0, 2)) pickset.set(o.m, o);
  for (const o of by_org_desc.slice(0, 2)) pickset.set(o.m, o);
  if (misleading) pickset.set(misleading.m, misleading);
  const picks = [...pickset.values()].sort((a, b) => a.m - b.m);

  // Alert: any zero-cover month with notable organic decline.
  const zero_cover_decliners = O.filter(o => o.dw === 0 && o.orgTotal <= -5)
    .sort((a, b) => a.orgTotal - b.orgTotal).slice(0, 2);
  const alert_text = cm.slide_4_alert
    || (zero_cover_decliners.length
        ? `${zero_cover_decliners.map(o => o.label).join(' and ')} had ZERO change in weekend days between ${T.year_a} and ${T.year_b}. There is no calendar explanation for the decline -- it is fully organic.`
        : 'Calendar pressure is muted this year -- raw deltas track organic deltas closely.');
  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 0.76, w: 9.4, h: 0.62, fill: { color: RBG }, line: { color: RD, pt: 1.5 } });
  s.addText(alert_text,
    { x: 0.46, y: 0.79, w: 9.08, h: 0.56, fontSize: 10.5, color: RD, bold: true, valign: 'middle', fontFace: 'Calibri' });

  const table_rows = picks.map(o => {
    const negative = o.orgTotal < -3;
    const positive = o.orgTotal >  3;
    const bg = negative ? MRDBG : positive ? GBG : ABG;
    const fg = negative ? RD : positive ? GD : AM;
    const wknd_label = o.dw === 0 ? 'None (0)' : `${o.dw > 0 ? '+' : ''}${o.dw} day${Math.abs(o.dw) === 1 ? '' : 's'}`;
    return [
      dc(MN_LONG[o.m], bg, fg, true, 'left', 10),
      dc(wknd_label, BBG, BL, true, 'center', 10),
      dc(o.calTotal === 0 ? '0' : fmt_delta1(o.calTotal), BBG, BL, true, 'center', 10),
      dv(fmt_delta(o.actDelta)),
      dv(fmt_delta1(o.orgTotal)),
      dc(interpret_org(o), bg, fg, negative, 'left', 9),
    ];
  });
  s.addTable([
    [hc('Month', TEAL), hc('Delta Weekend Days', TEAL), hc('Calendar Expected', TEAL),
     hc('Actual Delta', TEAL), hc('Organic Delta', TEAL), hc('Interpretation', TEAL)],
    ...table_rows,
  ], { x: 0.3, y: 1.48, w: 9.4, h: 2.44, rowH: 0.37, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  // Two info boxes — shifting impact and biggest "raw masks organic" example.
  const shifted_total = r?.segSummary?.Shifted ?? 0;
  const shift_pct = T.n25 ? Math.round((shifted_total / T.n25) * 100) : 0;
  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.02, w: 4.55, h: 0.62, fill: { color: BBG }, line: { color: BL, pt: 0.8 } });
  s.addText(`Event shifting (${fmt_int(shifted_total)} events, ${shift_pct}%) explains a small share of monthly net changes.`,
    { x: 0.42, y: 4.04, w: 4.3, h: 0.58, fontSize: 9.5, color: BL, valign: 'middle', fontFace: 'Calibri' });

  const misleading_box_text = misleading
    ? `${MN_LONG[misleading.m]} distortion: raw ${fmt_delta(misleading.actDelta)} masks ${fmt_delta1(misleading.orgTotal)} organic. Calendar effect was ${fmt_delta1(misleading.calTotal)}.`
    : 'No month had a sign mismatch between raw and organic deltas this year.';
  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 4.02, w: 4.65, h: 0.62, fill: { color: ABG }, line: { color: AM, pt: 0.8 } });
  s.addText(misleading_box_text,
    { x: 5.17, y: 4.04, w: 4.4, h: 0.58, fontSize: 9.5, color: AM, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.76, w: 9.4, h: 0.50, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_4_narrative
        || 'Calendar analysis isolates which month-over-month changes are explained by weekend-day shifts vs organic demand.' }
  ], { x: 0.42, y: 4.79, w: 9.1, h: 0.44, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_4 ?? '');
}
function interpret_org(o) {
  if (o.dw === 0 && o.orgTotal < -3) return 'Zero calendar cover -- full decline is organic';
  if (o.dw === 0 && o.orgTotal >  3) return 'No calendar help -- organic gain';
  if (Math.sign(o.actDelta) !== Math.sign(o.orgTotal) && o.dw !== 0)
    return `Looks ${fmt_delta(o.actDelta)} raw -- actually ${fmt_delta1(o.orgTotal)} organic`;
  if (o.orgTotal >  3) return 'Genuine organic strength';
  if (o.orgTotal < -3) return 'Organic decline beyond calendar effect';
  return 'Roughly in line with calendar expectation';
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Step 3: Organic performance (calendar-adjusted)
// ════════════════════════════════════════════════════════════════════════════
function slide_5(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  add_header(prs, s, 'Step 3', 'Organic Performance -- True Signal After Removing Calendar Noise', PURP, 5);

  s.addText('Once calendar effects are stripped, the real performance picture:',
    { x: 0.3, y: 0.76, w: 9.4, h: 0.26, fontSize: 11, color: DK, fontFace: 'Calibri' });

  const obt = organic_by_type(r);
  s.addTable([
    [hc('Event Type', PURP, WH, 10.5), hc('Raw Delta', PURP, WH, 10.5),
     hc('Calendar Effect', PURP, WH, 10.5), hc('Organic Delta', PURP, WH, 10.5),
     hc('Organic %', PURP, WH, 10.5)],
    ...obt.map((row, idx) => {
      const big_neg = row.org < -5;
      const big_pos = row.org >  5;
      const bg = big_neg ? RBG : big_pos ? GBG : (idx % 2 ? WH : LG);
      const fg = big_neg ? RD  : big_pos ? GD  : DK;
      return [
        dc(row.type, bg, fg, big_neg || big_pos, 'left', 10.5),
        dv(fmt_delta(row.raw), 10.5),
        dc(fmt_delta1(row.cal), ABG, AM, false, 'center', 10.5),
        dv(fmt_delta1(row.org), 10.5),
        dv((row.org_pct >= 0 ? '+' : '') + row.org_pct.toFixed(1) + '%', 10.5),
      ];
    }),
  ], { x: 0.3, y: 1.06, w: 9.4, h: 2.00, rowH: 0.36, fontSize: 10.5, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 3.16, w: 9.4, h: 0.44, fill: { color: BBG }, line: { color: BL, pt: 0.8 } });
  s.addText(`Organic Delta = Actual Delta - Calendar Expected Delta.   Calendar effect = Delta weekend days x ${T.year_a} events-per-weekend-day for that month & type.`,
    { x: 0.42, y: 3.18, w: 9.1, h: 0.40, fontSize: 9.5, color: BL, valign: 'middle', italic: true, fontFace: 'Calibri' });

  const obt_decliner = [...obt].sort((a, b) => a.org - b.org)[0];
  const obt_grower   = [...obt].sort((a, b) => b.org - a.org)[0];
  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 3.52, w: 4.55, h: 0.78, fill: { color: RBG }, line: { color: RD, pt: 0.8 } });
  s.addText([
    { text: (cm.slide_5_callout_left?.split('\n')[0] || `${obt_decliner.type} -- Structural Decliner`) + '\n', options: { bold: true, fontSize: 10.5 } },
    { text: `Organic delta ${fmt_delta1(obt_decliner.org)} (${(obt_decliner.org_pct >= 0 ? '+' : '') + obt_decliner.org_pct.toFixed(1)}%). Calendar noise cannot explain it.`, options: { fontSize: 9.5 } }
  ], { x: 0.42, y: 3.55, w: 4.3, h: 0.74, fontSize: 9.5, color: RD, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 3.52, w: 4.65, h: 0.78, fill: { color: GBG }, line: { color: GD, pt: 0.8 } });
  s.addText([
    { text: (cm.slide_5_callout_right?.split('\n')[0] || `${obt_grower.type} -- Top Grower`) + '\n', options: { bold: true, fontSize: 10.5 } },
    { text: `Organic delta ${fmt_delta1(obt_grower.org)} (${(obt_grower.org_pct >= 0 ? '+' : '') + obt_grower.org_pct.toFixed(1)}%) -- no calendar help required.`, options: { fontSize: 9.5 } }
  ], { x: 5.17, y: 3.55, w: 4.4, h: 0.74, fontSize: 9.5, color: GD, valign: 'middle', fontFace: 'Calibri' });

  // Strongest / weakest organic months (calendar-adjusted).
  const O = organic_rows(r);
  const top4_pos = [...O].sort((a, b) => b.orgTotal - a.orgTotal).slice(0, 4);
  const top4_neg = [...O].sort((a, b) => a.orgTotal - b.orgTotal).slice(0, 4);
  s.addText('Best & worst organic months (calendar-adjusted):',
    { x: 0.3, y: 4.42, w: 9.4, h: 0.26, fontSize: 10.5, bold: true, color: DK, fontFace: 'Calibri' });
  s.addTable([
    [hc('Strongest', GD, WH, 10),
     ...top4_pos.map(o => hc(`${o.label} ${fmt_delta1(o.orgTotal)}`, GD, WH, 10))],
    [hc('Weakest', RD, WH, 10),
     ...top4_neg.map(o => hc(`${o.label} ${fmt_delta1(o.orgTotal)}`, RD, WH, 10))],
  ], { x: 0.3, y: 4.72, w: 9.4, h: 0.66, rowH: 0.31, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 5.44, w: 9.4, h: 0.14, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText(cm.slide_5_narrative
      || `${obt_grower.type} leads on organic growth; ${obt_decliner.type} is the structural drag. The race types sit between them after calendar normalisation.`,
    { x: 0.42, y: 5.45, w: 9.1, h: 0.12, fontSize: 8.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_5 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 6 — Step 4: Event-level disposition (Retained / Shifted / Lost / New)
// ════════════════════════════════════════════════════════════════════════════
function slide_6(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  add_header(prs, s, 'Step 4', 'Did We Really Lose Events?  Event-Level Disposition', DARK, 6);

  const seg = r?.segSummary ?? {};
  const denom = T.n25 || 1;
  const pct = v => `${Math.round(((v ?? 0) / denom) * 100)}%`;
  const boxes = [
    [seg.Retained ?? 0, pct(seg.Retained), 'Retained', `Same event, same month`,            GBG, GD],
    [seg.Shifted  ?? 0, pct(seg.Shifted),  'Shifted',  `Same event, diff month`,            ABG, AM],
    [seg.Lost     ?? 0, pct(seg.Lost),     'Lost',     `Did not return to ${T.year_b}`,    MRDBG, RD],
    [seg.New      ?? 0, pct(seg.New),      'New',      `Brand new to ${T.year_b}`,          BBG, BL],
  ];
  boxes.forEach(([n, pct_str, label, sub, bg, fg], i) => {
    const x = 0.3 + i * 2.38;
    s.addShape(prs.ShapeType.rect, { x, y: 0.76, w: 2.22, h: 1.26, fill: { color: bg }, line: { color: fg, pt: 1.2 } });
    s.addText(fmt_int(n), { x, y: 0.79, w: 2.22, h: 0.52, fontSize: 27, bold: true, color: fg, align: 'center', fontFace: 'Calibri' });
    s.addText(`${pct_str} of ${T.year_a}`, { x, y: 1.27, w: 2.22, h: 0.22, fontSize: 9, color: fg, align: 'center', italic: true, fontFace: 'Calibri' });
    s.addText(label, { x, y: 1.47, w: 2.22, h: 0.22, fontSize: 10, bold: true, color: fg, align: 'center', fontFace: 'Calibri' });
    s.addText(sub, { x, y: 1.67, w: 2.22, h: 0.28, fontSize: 8.5, color: '555555', align: 'center', fontFace: 'Calibri' });
  });

  // Pick three notable months for the replacement-rate table: 2 worst by netDelta + 1 best by netDelta.
  const M = monthly_rows(r);
  const worst2 = [...M].sort((a, b) => a.netDelta - b.netDelta).slice(0, 2);
  const best1  = [...M].sort((a, b) => b.netDelta - a.netDelta)[0];
  const picks = [...worst2, best1].filter(Boolean);

  s.addText('Replacement Rates -- selected months:', { x: 0.3, y: 2.10, w: 9.4, h: 0.26, fontSize: 10.5, bold: true, color: DK, fontFace: 'Calibri' });
  s.addTable([
    [hc('Month', DARK), hc(`${T.year_a}\nEvents`, DARK), hc('Retained', GD, WH, 10),
     hc('Shifted\nOut', AM, WH, 10), hc('Lost\n(truly lost)', RD, WH, 10),
     hc('Shifted\nIn', BL, WH, 10), hc('New\nAdded', BL, WH, 10),
     hc(`${T.year_b}\nTotal`, DARK), hc('Repl.\nRate', DARK)],
    ...picks.map(p => {
      const repl_rate = p.attr > 0 ? Math.round(((p.new + p.rec) / p.attr) * 100) : 0;
      const bg = p.netDelta >= 0 ? GBG : MRDBG;
      const fg = p.netDelta >= 0 ? GD  : RD;
      return [
        dc(MN_LONG[p.m], bg, fg, true, 'left', 10),
        dc(fmt_int(p.n25), bg),
        dc(fmt_int(p.ret), GBG, GD),
        dc(fmt_int(p.sa), ABG, AM),
        dc(fmt_int(p.attr), MRDBG, RD, true),
        dc(fmt_int(p.su), BBG, BL),
        dc(fmt_int(p.new), BBG, BL, p.new >= 50),
        dc(fmt_int(p.n26), bg),
        dc(repl_rate >= 100 ? '>100%' : `${repl_rate}%`, bg, fg, true),
      ];
    }),
  ], { x: 0.3, y: 2.40, w: 9.4, h: 1.38, rowH: 0.38, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  const ttr = seg['Tried to Return'] ?? 0;
  const rec = seg.Recovered ?? 0;
  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 3.88, w: 4.55, h: 0.60, fill: { color: 'F3E5F5' }, line: { color: '6A1B9A', pt: 0.8 } });
  s.addText(`${fmt_int(ttr)} events Tried to Return -- filed a ${T.year_b} application but were cancelled/declined. ${fmt_int(rec)} events Recovered -- cancelled in ${T.year_a} but came back in ${T.year_b}.`,
    { x: 0.42, y: 3.90, w: 4.3, h: 0.56, fontSize: 9.5, color: '6A1B9A', valign: 'middle', fontFace: 'Calibri' });

  const new_plus_rec = (seg.New ?? 0) + (seg.Recovered ?? 0);
  const truly_lost   = seg.Lost ?? 0;
  const gross_repl   = truly_lost > 0 ? Math.round((new_plus_rec / truly_lost) * 100) : 0;
  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 3.88, w: 4.65, h: 0.60, fill: { color: 'ECEFF1' }, line: { color: '555555', pt: 0.8 } });
  s.addText(`Overall replacement: ${fmt_int(new_plus_rec)} new/recovered vs ${fmt_int(truly_lost)} truly lost -- ${gross_repl}% gross replacement.`,
    { x: 5.17, y: 3.90, w: 4.4, h: 0.56, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.60, w: 9.4, h: 0.65, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_6_narrative
        || `Of ${fmt_int(T.n25)} ${T.year_a} events, ${pct(seg.Retained)} retained, ${pct(seg.Shifted)} shifted, ${pct(seg.Lost)} lost. ${fmt_int(seg.New ?? 0)} new events and ${fmt_int(rec)} recovered events drove ${T.year_b} composition.` }
  ], { x: 0.42, y: 4.63, w: 9.1, h: 0.59, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_6 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 7 — Step 5: Application pipeline (creation_rows)
// ════════════════════════════════════════════════════════════════════════════
function slide_7(prs, r, cm, T, rows25, rows26) {
  const s = prs.addSlide();
  s.background = { color: LG };
  add_header(prs, s, 'Step 5', 'Application Pipeline -- Who Is Filing and When', '1B5E20', 7);

  // For year_a events: pre-filing = Q4 of (year_a - 1), in-year = Jan-cutoff of year_a.
  // For year_b events: pre-filing = Q4 of (year_a),     in-year = Jan-cutoff of year_b.
  const cutoff = in_year_cutoff(T.year_b);
  const months_q4    = [10, 11, 12];
  const months_in_yr = Array.from({ length: cutoff }, (_, i) => i + 1);
  const ya = T.year_a, yb = T.year_b;

  function pipeline_row(type) {
    const pr25 = pipeline_get(rows25, ya - 1, type, months_q4);
    const iy25 = pipeline_get(rows25, ya,     type, months_in_yr);
    const tot25 = pipeline_get(rows25, null,  type) || pipeline_get(rows25, ya, type) + pipeline_get(rows25, ya - 1, type) + pipeline_get(rows25, ya - 2, type);
    // pipeline_get with yr=null doesn't filter; use the sum of all yr's instead:
    const tot25_safe = (rows25 ?? [])
      .filter(rw => type === null || rw.type === type)
      .reduce((s, rw) => s + (rw.cnt ?? 0), 0);
    const pr26 = pipeline_get(rows26, ya,     type, months_q4);
    const iy26 = pipeline_get(rows26, yb,     type, months_in_yr);
    const tot26_safe = (rows26 ?? [])
      .filter(rw => type === null || rw.type === type)
      .reduce((s, rw) => s + (rw.cnt ?? 0), 0);
    return { pr25, iy25, tot25: tot25_safe, pr26, iy26, tot26: tot26_safe };
  }

  const cutoff_label = `Jan-${MN[cutoff]}`;
  const table = [
    [hc('Event Type', '1B5E20'),
     hc(`Q4 ${ya - 1}\nPre-Filing`, '1B5E20'), hc(`${cutoff_label}\n${ya} In-Yr`, '1B5E20'), hc(`${ya}\nTotal Apps`, '1B5E20'),
     hc(`Q4 ${ya}\nPre-Filing`, TEAL),         hc(`${cutoff_label}\n${yb} In-Yr`, TEAL),     hc(`${yb}\nTotal Apps`, TEAL),
     hc('Delta Q4', DARK), hc(`Delta\n${cutoff_label}`, DARK)],
  ];
  let tot_pr25 = 0, tot_iy25 = 0, tot_25 = 0, tot_pr26 = 0, tot_iy26 = 0, tot_26 = 0;
  for (const t of TYPES) {
    const p = pipeline_row(t);
    tot_pr25 += p.pr25; tot_iy25 += p.iy25; tot_25 += p.tot25;
    tot_pr26 += p.pr26; tot_iy26 += p.iy26; tot_26 += p.tot26;
    const big_neg = (t === 'Adult Clinic' && p.tot26 < p.tot25 - 5);
    const big_pos = (p.tot26 - p.tot25 > 3);
    const bg = big_neg ? RBG : big_pos ? GBG : (TYPES.indexOf(t) % 2 ? WH : LG);
    const fg = big_neg ? RD  : big_pos ? GD  : DK;
    table.push([
      dc(t, bg, fg, big_neg || big_pos, 'left', 10),
      dc(fmt_int(p.pr25), bg, DK),
      dc(fmt_int(p.iy25), bg, DK),
      dc(fmt_int(p.tot25), bg, DK, true),
      dc(fmt_int(p.pr26), bg, DK),
      dc(fmt_int(p.iy26), bg, DK),
      dc(fmt_int(p.tot26), bg, DK, true),
      dv(fmt_delta(p.pr26 - p.pr25)),
      dv(fmt_delta(p.iy26 - p.iy25)),
    ]);
  }
  table.push([
    hc('TOTAL', DARK),
    hc(fmt_int(tot_pr25), DARK), hc(fmt_int(tot_iy25), DARK), hc(fmt_int(tot_25), DARK),
    hc(fmt_int(tot_pr26), DARK), hc(fmt_int(tot_iy26), DARK), hc(fmt_int(tot_26), DARK),
    hc(fmt_delta(tot_pr26 - tot_pr25), DARK),
    hc(fmt_delta(tot_iy26 - tot_iy25), DARK),
  ]);
  s.addText(`Total applications: ${fmt_int(tot_25)} for ${ya} vs ${fmt_int(tot_26)} for ${yb}. The story is in WHEN and WHICH type is filing:`,
    { x: 0.3, y: 0.76, w: 9.4, h: 0.24, fontSize: 10.5, color: DK, fontFace: 'Calibri' });
  s.addTable(table,
    { x: 0.3, y: 1.04, w: 9.4, h: 1.74, rowH: 0.28, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  // Two opportunity boxes — bias toward the largest decliner type.
  const obt = organic_by_type(r);
  const lag_type   = [...obt].sort((a, b) => a.org - b.org)[0];
  const lead_type  = [...obt].sort((a, b) => b.org - a.org)[0];

  s.addText(`${cm.slide_7_opportunity_label || 'Highest-Probability Opportunities'}:`,
    { x: 0.3, y: 2.88, w: 9.4, h: 0.26, fontSize: 10.5, bold: true, color: DK, fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 3.18, w: 4.55, h: 1.0, fill: { color: RBG }, line: { color: RD, pt: 1.2 } });
  s.addText([
    { text: `${cm.slide_7_callout_left_title || 'Highest ROI Opportunity'}\n`, options: { bold: true, fontSize: 10.5 } },
    { text: `${lag_type.type} is the structural decliner (${fmt_delta1(lag_type.org)} organic). Proactive outreach in the spontaneous-filing window can close part of the gap.`, options: { fontSize: 9.5 } }
  ], { x: 0.42, y: 3.22, w: 4.3, h: 0.92, fontSize: 9.5, color: RD, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 3.18, w: 4.65, h: 1.0, fill: { color: GBG }, line: { color: GD, pt: 1.2 } });
  s.addText([
    { text: `${lead_type.type} -- Reinforce\n`, options: { bold: true, fontSize: 10.5 } },
    { text: `${lead_type.type} is the organic leader (${fmt_delta1(lead_type.org)} organic, ${(lead_type.org_pct >= 0 ? '+' : '') + lead_type.org_pct.toFixed(1)}%). Fast-track approvals so momentum is not lost.`, options: { fontSize: 9.5 } }
  ], { x: 5.17, y: 3.22, w: 4.4, h: 0.92, fontSize: 9.5, color: GD, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.28, w: 4.55, h: 0.50, fill: { color: MRDBG }, line: { color: RD, pt: 0.8 } });
  s.addText(`${lag_type.type} action: target organizers in the spontaneous-filing window. Low effort, high impact.`,
    { x: 0.42, y: 4.30, w: 4.3, h: 0.46, fontSize: 9, color: RD, valign: 'middle', fontFace: 'Calibri' });

  const iy_delta = tot_iy26 - tot_iy25;
  const iy_pace_pct = tot_iy25 ? Math.round((iy_delta / tot_iy25) * 100) : 0;
  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 4.28, w: 4.65, h: 0.50, fill: { color: BBG }, line: { color: BL, pt: 0.8 } });
  s.addText(`Overall pipeline is ${iy_pace_pct >= 0 ? '+' : ''}${iy_pace_pct}% (${fmt_delta(iy_delta)} in-yr apps) vs ${ya} pace through ${MN[cutoff]}.`,
    { x: 5.17, y: 4.30, w: 4.4, h: 0.46, fontSize: 9, color: BL, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.90, w: 9.4, h: 0.46, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_7_narrative
        || `The application data tells a different story than the active-event snapshot. Total volume is ${fmt_delta(tot_26 - tot_25)} year-over-year; in-year applications are running ${iy_pace_pct >= 0 ? '+' : ''}${iy_pace_pct}% vs ${ya}.` }
  ], { x: 0.42, y: 4.93, w: 9.1, h: 0.42, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_7 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 8 — Step 6: Win-back focus on the two worst months
// ════════════════════════════════════════════════════════════════════════════
function slide_8(prs, r, cm, T) {
  const s = prs.addSlide();
  s.background = { color: LG };
  const M = monthly_rows(r);
  const worst = [...M].sort((a, b) => a.netDelta - b.netDelta).slice(0, 2).sort((a, b) => a.m - b.m);
  const header = cm.slide_8_header
    || `${worst.map(w => w.label).join(' & ')}: Organic Churn and the Win-Back Opportunity`;
  add_header(prs, s, 'Step 6', header, RD, 8);

  s.addText(cm.slide_8_subtitle
      || `Replacement is incomplete in ${worst.map(w => w.label).join(' & ')} -- the churn volume itself is the problem:`,
    { x: 0.3, y: 0.76, w: 9.4, h: 0.20, fontSize: 10, color: DK, fontFace: 'Calibri' });

  // Two month panels.
  worst.forEach((w, idx) => {
    const x0 = idx === 0 ? 0.3 : 5.05;
    const colW = idx === 0 ? 4.55 : 4.65;
    const repl = w.attr > 0 ? Math.round(((w.new + w.rec) / w.attr) * 100) : 0;
    s.addTable([
      [hc(MN_LONG[w.m], DARK, WH, 9.5), hc(String(T.year_a), '1A237E', WH, 9.5), hc(String(T.year_b), '1A237E', WH, 9.5)],
      [dc('Retained', LG, DK, false, 'left', 9.5), dc(fmt_int(w.ret), LG, DK), dc(fmt_int(w.ret), GBG, GD, true)],
      [dc('Shifted Out', WH, DK, false, 'left', 9.5), dc('-' + fmt_int(w.sa), RBG, RD), dc('--', WH, 'AAAAAA')],
      [dc('Lost', MRDBG, RD, true, 'left', 9.5), dc('-' + fmt_int(w.attr), MRDBG, RD, true), dc('--', MRDBG, 'AAAAAA')],
      [dc('Shift In', WH, GD, false, 'left', 9.5), dc('--', WH, 'AAAAAA'), dc('+' + fmt_int(w.su), GBG, GD)],
      [dc("New / Rec'd", GBG, GD, false, 'left', 9.5), dc('--', GBG, 'AAAAAA'), dc('+' + fmt_int(w.new + w.rec), GBG, GD, true)],
    ], { x: x0, y: 1.00, w: colW, h: 1.46, rowH: 0.23, fontSize: 9.5, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });
    s.addShape(prs.ShapeType.rect, { x: x0, y: 2.54, w: colW, h: 0.36, fill: { color: DARK }, line: { color: DARK } });
    s.addText(`${T.year_a}: ${fmt_int(w.n25)} events  ->  ${T.year_b}: ${fmt_int(w.n26)}       Replacement: ${fmt_int(w.new + w.rec)}/${fmt_int(w.attr)} = ${repl}%`,
      { x: x0 + 0.02, y: 2.55, w: colW - 0.05, h: 0.34, fontSize: 9, color: GBG, bold: true, align: 'center', valign: 'middle', fontFace: 'Calibri' });
  });

  // Lost-by-type summary across the two worst months.
  const lbt = lost_by_type_for_months(r, worst.map(w => w.m));
  s.addText(`Lost events by type (combined ${worst.map(w => w.label).join(' + ')}):`,
    { x: 0.3, y: 2.98, w: 9.4, h: 0.18, fontSize: 10, bold: true, color: DK, fontFace: 'Calibri' });

  const lbt_rows = TYPES.slice(0, 2).map(t => {
    const a = (r?.attrMt?.[worst[0].m]?.[t] ?? 0);
    const b = (r?.attrMt?.[worst[1].m]?.[t] ?? 0);
    const c = a + b;
    const share = lbt.total ? Math.round((c / lbt.total) * 100) : 0;
    const heavy = share >= 25;
    return [
      dc(t, LG, DK, true, 'left', 10),
      dc(fmt_int(a), MRDBG, RD, heavy),
      dc(fmt_int(b), MRDBG, RD, heavy),
      dc(fmt_int(c), MRDBG, RD, heavy),
      dc(`${share}%`, MRDBG, RD, heavy),
    ];
  });
  s.addTable([
    [hc('Type', DARK, WH, 9.5), hc(`${worst[0].label} Lost`, RD, WH, 9.5),
     hc(`${worst[1].label} Lost`, RD, WH, 9.5), hc('Combined', DARK, WH, 9.5), hc('Share', DARK, WH, 9.5)],
    ...lbt_rows,
  ], { x: 0.3, y: 3.19, w: 9.4, h: 0.68, rowH: 0.22, fontSize: 9.5, border: { type: 'solid', pt: 0.5, color: 'CCCCCC' } });

  // Tail row: clinic lost.
  const clinic_lost_a = (r?.attrMt?.[worst[0].m]?.['Adult Clinic'] ?? 0) + (r?.attrMt?.[worst[1].m]?.['Adult Clinic'] ?? 0);
  const clinic_lost_y = (r?.attrMt?.[worst[0].m]?.['Youth Clinic'] ?? 0) + (r?.attrMt?.[worst[1].m]?.['Youth Clinic'] ?? 0);
  const ac_share = lbt.total ? Math.round((clinic_lost_a / lbt.total) * 100) : 0;
  const yc_share = lbt.total ? Math.round((clinic_lost_y / lbt.total) * 100) : 0;
  s.addText(`Adult Clinic: ${fmt_int(clinic_lost_a)} lost (${ac_share}%)  |  Youth Clinic: ${fmt_int(clinic_lost_y)} lost (${yc_share}%)  --  minor; not material to win-back prioritisation`,
    { x: 0.3, y: 3.91, w: 9.4, h: 0.15, fontSize: 8.5, color: '777777', italic: true, fontFace: 'Calibri' });

  // Two-speed callouts: the later worst month gets "Act Now"; the earlier gets "Diagnose for next cycle".
  const acts = [...worst].sort((a, b) => b.m - a.m); // later month first → "Act Now"
  const act_now = acts[0], diagnose = acts[1];
  const act_now_winback = act_now.attr > 0 ? Math.round(act_now.attr * 0.20) : 0;
  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.14, w: 4.55, h: 0.78, fill: { color: MRDBG }, line: { color: RD, pt: 1.2 } });
  s.addText([
    { text: `${MN_LONG[act_now.m]} -- Act Now (${T.year_b} Window)\n`, options: { bold: true, fontSize: 10.5 } },
    { text: `${fmt_int(act_now.attr)} lost in ${T.year_a}. Reach all known organizers; a 20% win-back recovers ~${fmt_int(act_now_winback)} events.`, options: { fontSize: 9.5 } }
  ], { x: 0.42, y: 4.17, w: 4.3, h: 0.72, color: RD, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 5.05, y: 4.14, w: 4.65, h: 0.78, fill: { color: BBG }, line: { color: BL, pt: 1.2 } });
  s.addText([
    { text: `${MN_LONG[diagnose.m]} -- Diagnose for ${T.year_b + 1}\n`, options: { bold: true, fontSize: 10.5 } },
    { text: `${fmt_int(diagnose.attr)} lost in ${T.year_a}. Too late for ${T.year_b}; outreach to understand WHY is the highest-ROI ${T.year_b + 1} planning action.`, options: { fontSize: 9.5 } }
  ], { x: 5.17, y: 4.17, w: 4.4, h: 0.72, color: BL, valign: 'middle', fontFace: 'Calibri' });

  s.addShape(prs.ShapeType.rect, { x: 0.3, y: 5.02, w: 9.4, h: 0.36, fill: { color: 'ECEFF1' }, line: { color: 'CCCCCC', pt: 0.5 } });
  s.addText([
    { text: 'Narrative:  ', options: { bold: true } },
    { text: cm.slide_8_narrative
        || `${worst.map(w => w.label).join(' and ')} each lose meaningful event volume and only partially replace it. The net decline is a volume problem, not a demand collapse.` }
  ], { x: 0.42, y: 5.05, w: 9.1, h: 0.32, fontSize: 9.5, color: DK, valign: 'middle', fontFace: 'Calibri' });

  s.addNotes(cm.notes?.slide_8 ?? '');
}

// ════════════════════════════════════════════════════════════════════════════
// Main export
// ════════════════════════════════════════════════════════════════════════════
async function buildDeck(outPath, results, commentary = null, rows25 = null, rows26 = null) {
  const cm = commentary ?? {};
  const T = compute_totals(results);
  T.year_a = results?.years?.year_a ?? new Date().getFullYear() - 1;
  T.year_b = results?.years?.year_b ?? new Date().getFullYear();

  const prs = new pptxgen();
  prs.layout = 'LAYOUT_16x9';
  prs.title = `Sanctioned Events ${T.year_a} vs ${T.year_b}`;

  slide_1(prs, results, cm, T);
  slide_2(prs, results, cm, T);
  slide_3(prs, results, cm, T);
  slide_4(prs, results, cm, T);
  slide_5(prs, results, cm, T);
  slide_6(prs, results, cm, T);
  slide_7(prs, results, cm, T, rows25, rows26);
  slide_8(prs, results, cm, T);

  return prs.writeFile({ fileName: outPath });
}

module.exports = { buildDeck };
