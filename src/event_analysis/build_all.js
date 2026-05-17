#!/usr/bin/env node
/**
 * build_all.js — USAT Sanctioned Event Analysis, master build script.
 *
 * Produces from scratch:
 *   output/2026_event_calendar_analysis_v9f.xlsx
 *   output/event_trends_summary_v3.pptx
 *
 * Usage:
 *   npm run build          (after npm install)
 *   node build_all.js
 *
 * Input CSVs live in data/ — add new year files there and update
 * the csv_25 / csv_26 / csv_create_25 / csv_create_26 constants below.
 */

'use strict';

// Load .env file if present (ANTHROPIC_API_KEY etc.)
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const path = require('path');
const fs   = require('fs');

// ── Input CSV paths — update these when adding new year files ───────────────
const DIR = __dirname;

const csv_25       = path.join(DIR, 'data', '2025a_events_051526.csv');
const csv_26       = path.join(DIR, 'data', '2026_events_051526.csv');
const csv_create_25 = path.join(DIR, 'data', '2025_events_by_start_year_by_type.csv');
const csv_create_26 = path.join(DIR, 'data', '2026_events_by_start_year_by_type.csv');

// ── Output paths ─────────────────────────────────────────────────────────────
const out_xlsx = path.join(DIR, 'output', '2026_event_calendar_analysis_v9f.xlsx');
const out_pptx = path.join(DIR, 'output', 'event_trends_summary_v3.pptx');

// ── Source modules ────────────────────────────────────────────────────────────
const { loadBothYears: load_both_years } = require('./src/loader');
const { runAnalysis: run_analysis } = require('./src/analysis');
const { build_workbook } = require('./src/excel/builder');
const { generate_rule_based, generate_ai } = require('./src/commentary');
const { generate_dashboard }    = require('./src/dashboard');
const pptxgen           = require('pptxgenjs');


// ── Archive + export helpers ──────────────────────────────────────────────────

function archive_outputs(dir, ...files) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const archive_dir = path.join(dir, 'archive', ts);
  let archived = 0;
  for (const fp of files) {
    if (fs.existsSync(fp)) {
      fs.mkdirSync(archive_dir, { recursive: true });
      fs.copyFileSync(fp, path.join(archive_dir, path.basename(fp)));
      archived++;
    }
  }
  if (archived > 0) console.log(`  Archived ${archived} prior file(s) to output/archive/${ts}/`);
}

function save_json(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
}

// ════════════════════════════════════════════════════════════════════════════
// POWERPOINT — 8 slides with full speaker notes
// ════════════════════════════════════════════════════════════════════════════

async function buildDeck(outPath, r, commentary_override = null) {
  // r = analysis results; use for dynamic commentary

  // ── Dynamic values from analysis results ─────────────────────────────────
  const d_25_total  = r ? (r.loaded?.y25active?.length ?? r.segSummary ? Object.values(r.segSummary).filter((_,i)=>i<4).reduce ? 1178 : 1178 : 1178) : 1178;
  // Simpler: pull directly from segSummary counts
  const d_n25       = r?.c25total  ?? 1178;
  const d_n26       = r?.c26total  ?? 1166;
  const d_net       = d_n26 - d_n25;
  const d_pct       = ((d_net / d_n25) * 100).toFixed(1);
  const d_ret       = r?.segSummary?.Retained      ?? 746;
  const d_shifted   = r?.segSummary?.Shifted        ?? 124;
  const d_attrited  = r?.segSummary?.Lost           ?? 295;
  const d_new_ev    = r?.segSummary?.New             ?? 263;
  const d_recovered = r?.segSummary?.Recovered       ?? 33;
  const d_ttr       = r?.segSummary?.['Tried to Return'] ?? 13;

  // Per-type counts — from c25/c26 rolled up
  const sum_type = (cx, t) => Object.values(cx ?? {}).reduce((s,m) => s + (m[t] ?? 0), 0);
  const c25 = r?.c25 ?? {};
  const c26 = r?.c26 ?? {};
  const d_ar25 = sum_type(c25,'Adult Race'),   d_ar26 = sum_type(c26,'Adult Race');
  const d_yr25 = sum_type(c25,'Youth Race'),   d_yr26 = sum_type(c26,'Youth Race');
  const d_ac25 = sum_type(c25,'Adult Clinic'), d_ac26 = sum_type(c26,'Adult Clinic');
  const d_yc25 = sum_type(c25,'Youth Clinic'), d_yc26 = sum_type(c26,'Youth Clinic');

  const fmt_delta = v => v > 0 ? `+${v}` : `${v}`;
  const fmt_pct   = (a, b) => `${(((b-a)/a)*100).toFixed(1)}%`;

  // Use pre-computed AI commentary if available, else rule-based
  const cm = commentary_override || (r ? generate_rule_based(r) : {});
  const prs = new pptxgen();
  prs.layout = 'LAYOUT_16x9';   // 10 x 5.625 inches
  prs.title  = 'Sanctioned Events 2025 vs 2026';

  // ── Colour palette ───────────────────────────────────────────────────────
  const RED='BF1B2C', DK='222222', WH='FFFFFF', LG='F5F5F5';
  const GD='1E7D34', GBG='E8F5E9', MGBG='C8E6C9';
  const RD='C62828', RBG='FDECEA', MRDBG='FFCDD2';
  const BL='1565C0', BBG='E3F2FD';
  const AM='E65100', ABG='FFF8E1';
  const TEAL='006064', PURP='4A148C', DARK='37474F';
  const TOTAL_SLIDES = 8;

  // ── Cell / shape helpers ─────────────────────────────────────────────────
  const hc = (t, bg=DK, fg=WH, sz=10) => ({
    text: t,
    options: { fill:bg, color:fg, bold:true, fontSize:sz, align:'center', valign:'middle' }
  });
  const dc = (t, bg=WH, fg=DK, bold=false, align='center', sz=10) => ({
    text: t,
    options: { fill:bg, color:fg, bold, fontSize:sz, align, valign:'middle' }
  });
  const dv = (v, sz=10) => {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return dc(v, n>0?GBG:n<0?RBG:LG, n>0?GD:n<0?RD:DK, Math.abs(n)>=8, 'center', sz);
  };

  /** Coloured header bar with step label and optional slide number. */
  const addHeader = (s, step, title, color=DK, slideNum=null) => {
    s.addShape(prs.ShapeType.rect, { x:0, y:0, w:10, h:0.62, fill:{color}, line:{color} });
    s.addText(`${step}  --  ${title}`, {
      x:0.18, y:0.08, w:9.0, h:0.46,
      fontSize:13.5, bold:true, color:WH, fontFace:'Calibri'
    });
    if (slideNum) s.addText(`${slideNum} / ${TOTAL_SLIDES}`, {
      x:9.25, y:0.10, w:0.65, h:0.40,
      fontSize:9, color:'AAAAAA', align:'right', valign:'middle', fontFace:'Calibri'
    });
  };

  /** Slide number badge for the title slide (no header bar). */
  const addSlideNum = (s, n) => s.addText(`${n} / ${TOTAL_SLIDES}`, {
    x:9.25, y:5.38, w:0.65, h:0.20,
    fontSize:8.5, color:'FFAAAA', align:'right', valign:'middle', fontFace:'Calibri'
  });

  /** Coloured callout box with bold centred text. */
  const callout = (s, text, x, y, w, h, bg, fg, sz=10) => {
    s.addShape(prs.ShapeType.rect, { x, y, w, h, fill:{color:bg}, line:{color:fg, pt:1.2} });
    s.addText(text, {
      x:x+0.07, y, w:w-0.14, h,
      fontSize:sz, color:fg, bold:true, align:'center', valign:'middle', fontFace:'Calibri'
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 1 — Title
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:RED };
    s.addShape(prs.ShapeType.rect, { x:0, y:0, w:10, h:1.0, fill:{color:'AA1524'}, line:{color:'AA1524'} });
    s.addText('USAT  |  Sanctioned Events Analysis', { x:0.4, y:0.15, w:9, h:0.55, fontSize:12, color:'FFAAAA', fontFace:'Calibri' });
    s.addText('Sanctioned Events',                   { x:0.4, y:1.15, w:9.2, h:1.0, fontSize:40, bold:true, color:WH, fontFace:'Calibri' });
    s.addText(cm.slide_1_subtitle || '2025 vs 2026  |  Year-over-Year Analysis', { x:0.4, y:2.1, w:9, h:0.55, fontSize:20, color:'FFCCCC', fontFace:'Calibri' });

    const bullet_data = cm.slide_1_bullets ?? [
      { label: '-12 events overall',  bg_type: 'negative', sub: '-1.0% -- modest headline, but composition matters' },
      { label: 'Adult Clinic -12.4%', bg_type: 'negative', sub: 'Sole driver of the net decline' },
      { label: 'July & August -34',   bg_type: 'negative', sub: 'Zero calendar cover -- purely organic losses' },
      { label: 'Youth Clinic +17.2%', bg_type: 'positive', sub: 'Only type growing -- a genuine bright spot' },
    ];
    bullet_data.forEach(({ label, bg_type, sub }, i) => {
      const bg = bg_type === 'positive' ? GBG : bg_type === 'negative' ? RBG : LG;
      const fg = bg_type === 'positive' ? GD  : bg_type === 'negative' ? RD  : DK;
      const x  = 0.4 + (i % 2) * 4.8, y = i < 2 ? 2.95 : 3.65;
      s.addShape(prs.ShapeType.rect, { x, y, w:4.5, h:0.6, fill:{color:bg}, line:{color:fg, pt:1} });
      s.addText(
        [{ text:label+' ', options:{bold:true} }, { text:`(${sub})`, options:{} }],
        { x:x+0.1, y, w:4.3, h:0.6, fontSize:10, color:fg, valign:'middle', fontFace:'Calibri' }
      );
    });
    s.addText(
      cm.slide_1_data_note || 'Data as of May 15, 2026  |  Excl. Cancelled / Declined / Deleted  |  ~85-90% event-level match confidence',
      { x:0.4, y:5.1, w:9, h:0.35, fontSize:8.5, color:'FFAAAA', italic:true, fontFace:'Calibri' }
    );
    addSlideNum(s, 1);
    s.addNotes(cm.notes?.slide_1 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 2 — Step 0: Event counts by type
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 0', 'What Changed? Event Counts by Type', DK, 2);

    s.addTable([
      [hc('Event Type','1A237E'), hc('2025','1A237E'), hc('2026','1A237E'), hc('Delta Count','1A237E'), hc('Delta %','1A237E'), hc('Read as...','1A237E')],
      [dc('Adult Race',  LG,  DK,true, 'left'), dc(d_ar25.toLocaleString(),LG),  dc(d_ar26.toLocaleString(),LG),  dv(fmt_delta(d_ar26-d_ar25)),  dv(fmt_pct(d_ar25,d_ar26)),  dc('Essentially flat -- no race product problem',          LG, DK,false,'left',9.5)],
      [dc('Youth Race',  WH,  DK,false,'left'), dc(d_yr25.toLocaleString(),WH),  dc(d_yr26.toLocaleString(),WH),  dv(fmt_delta(d_yr26-d_yr25)),  dv(fmt_pct(d_yr25,d_yr26)),  dc('Mild softness -- monitor trend',                        WH, DK,false,'left',9.5)],
      [dc('Adult Clinic',RBG, RD,true, 'left'), dc(d_ac25.toLocaleString(),RBG), dc(d_ac26.toLocaleString(),RBG), dv(fmt_delta(d_ac26-d_ac25)), dv(fmt_pct(d_ac25,d_ac26)), dc('Structural contraction -- sole driver of net decline',  RBG,RD,true, 'left',9.5)],
      [dc('Youth Clinic',GBG, GD,true, 'left'), dc(d_yc25.toLocaleString(),GBG), dc(d_yc26.toLocaleString(),GBG), dv(fmt_delta(d_yc26-d_yc25)),  dv(fmt_pct(d_yc25,d_yc26)), dc('Only type growing -- genuine bright spot',              GBG,GD,true, 'left',9.5)],
      [hc('TOTAL',DARK), hc(d_n25.toLocaleString(),DARK), hc(d_n26.toLocaleString(),DARK), hc(fmt_delta(d_net),DARK), hc(d_pct+'%',DARK), hc(d_ac26<d_ac25?'Adult Clinic = full net decline':'Check type trends',DARK)],
    ], { x:0.3, y:0.76, w:9.4, h:2.72, rowH:0.44, fontSize:10.5, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:3.62, w:9.4, h:1.1, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text: cm.slide_2_narrative || 'The overall net change reflects composition differences across event types. Review the data tabs for details.' }
    ], { x:0.42, y:3.67, w:9.1, h:1.0, fontSize:10, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_2 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 3 — Step 1: Monthly breakdown
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 1', cm.slide_3_header || 'Monthly Breakdown -- July & August Drive the Declines', DK, 3);

    s.addTable([
      [hc('Month','1A237E',WH,10), hc('2025','1A237E',WH,10), hc('2026','1A237E',WH,10), hc('Var','1A237E',WH,10)],
      ...[
        ['Jan',10,17,'+7'],['Feb',43,34,'-9'],['Mar',54,62,'+8'],['Apr',76,81,'+5'],
        ['May',142,145,'+3'],['Jun',209,219,'+10'],['Jul',181,165,'-16'],
        ['Aug',220,202,'-18'],['Sep',151,147,'-4'],['Oct',60,71,'+11'],
        ['Nov',22,13,'-9'],['Dec',10,10,'0'],
      ].map(([m, a, b, v]) => {
        const isJA = m==='Jul' || m==='Aug';
        const pos  = parseFloat(v) > 0;
        const bg   = isJA ? MRDBG : pos ? MGBG : WH;
        const fg   = isJA ? RD    : pos ? GD   : DK;
        return [
          dc(m,  bg, fg, isJA || (pos && parseFloat(v)>=8), 'left',   10),
          dc(a,  bg, DK, false, 'center', 10),
          dc(b,  bg, DK, false, 'center', 10),
          dv(v, 10),
        ];
      }),
      [hc('Full Year',DARK), hc('1,178',DARK), hc('1,166',DARK), hc('-12',DARK)],
    ], { x:0.3, y:0.76, w:3.4, h:3.82, rowH:0.27, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addText(cm.slide_3_type_detail_label || 'Type Detail -- July & August', { x:3.9, y:0.76, w:5.9, h:0.28, fontSize:11, bold:true, color:DK, fontFace:'Calibri' });
    s.addTable([
      [hc('Month',DARK), hc('Adult Race',DARK), hc('Youth Race',DARK), hc('Adult Clinic',DARK), hc('Youth Clinic',DARK), hc('Total',DARK)],
      [dc('July',  MRDBG,RD,true,'left',10), dv('-8'), dv('-8'), dc('--',MRDBG,'AAAAAA'), dc('--',MRDBG,'AAAAAA'), dv('-16')],
      [dc('August',MRDBG,RD,true,'left',10), dv('-6'), dv('-9'), dc('--',MRDBG,'AAAAAA'), dv('-3'),                dv('-18')],
      [dc('Full Year',LG,DK,true,'left',10), dv('-1'), dv('-4'), dv('-12'),                dv('+5'),               dv('-12')],
    ], { x:3.9, y:1.08, w:5.9, h:1.38, rowH:0.32, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    callout(s, cm.slide_3_callout_left || 'July & August are both Adult Race and Youth Race driven -- not clinic-related.\nClinic mix is flat or zero in both months.',
      3.9, 2.56, 5.9, 0.72, MRDBG, RD, 10);
    callout(s, cm.slide_3_callout_right || 'June (+10) and October (+11) are the two strongest months.\nBoth show genuine organic strength plus new event additions.',
      3.9, 3.38, 5.9, 1.00, MGBG, GD, 10);

    s.addShape(prs.ShapeType.rect, { x:0.3, y:4.72, w:9.4, h:0.50, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text: cm.slide_3_narrative || 'The monthly distribution shows concentrated losses in specific months alongside strong performers.' }
    ], { x:0.42, y:4.75, w:9.1, h:0.44, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_3 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 4 — Step 2: Calendar impact
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 2', cm.slide_4_header || 'Is This a Calendar Effect?  No -- Not for July or August', TEAL, 4);

    s.addShape(prs.ShapeType.rect, { x:0.3, y:0.76, w:9.4, h:0.62, fill:{color:RBG}, line:{color:RD,pt:1.5} });
    s.addText(
      cm.slide_4_alert || 'July and August had ZERO change in weekend days (Sat or Sun) between 2025 and 2026. There is no calendar explanation for the summer declines -- they are fully organic.',
      { x:0.46, y:0.79, w:9.08, h:0.56, fontSize:10.5, color:RD, bold:true, valign:'middle', fontFace:'Calibri' }
    );

    s.addTable([
      [hc('Month',TEAL), hc('Delta Weekend Days',TEAL), hc('Calendar Expected',TEAL), hc('Actual Delta',TEAL), hc('Organic Delta',TEAL), hc('Interpretation',TEAL)],
      [dc('July',  MRDBG,RD,true,'left',10), dc('None (0)',BBG,BL,true,'center',10), dc('0',BBG,BL,true,'center',10), dv('-16'), dv('-16'), dc('Zero calendar cover -- full decline is organic',    MRDBG,RD,false,'left',9)],
      [dc('August',MRDBG,RD,true,'left',10), dc('None (0)',BBG,BL,true,'center',10), dc('0',BBG,BL,true,'center',10), dv('-18'), dv('-18'), dc('Zero calendar cover -- full decline is organic',    MRDBG,RD,false,'left',9)],
      [dc('May',   ABG,AM,false,'left',10),  dc('+1 Sunday',ABG,AM,true,'center',10),  dc('+15.8',ABG,AM,false,'center',10), dv('+3'),  dv('-12.8'), dc('Looks +3 raw -- actually -13 organic (calendar gifted +16 that did not fill)', ABG,AM,false,'left',9)],
      [dc('June',  GBG,GD,false,'left',10),  dc('-1 Sunday',ABG,AM,true,'center',10),  dc('-23.2',ABG,AM,false,'center',10), dv('+10'), dv('+33.2'), dc('Lost a Sunday but organic demand drove +33. Strongest organic month.',        GBG,GD,true, 'left',9)],
      [dc('Oct',   GBG,GD,false,'left',10),  dc('+1 Saturday',ABG,AM,true,'center',10),dc('+7.5', ABG,AM,false,'center',10), dv('+11'), dv('+3.5'),  dc('Calendar gave +8; organic gain +4 on top -- both working',                   GBG,GD,false,'left',9)],
    ], { x:0.3, y:1.48, w:9.4, h:2.44, rowH:0.37, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addShape(prs.ShapeType.rect, { x:0.3,  y:4.02, w:4.55, h:0.62, fill:{color:BBG}, line:{color:BL,pt:0.8} });
    s.addText('Event shifting (124 events, 11%) explains little: net shift for July was -3, August was 0. Shifting barely moves the needle on summer.',
      { x:0.42, y:4.04, w:4.3, h:0.58, fontSize:9.5, color:BL, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:4.02, w:4.65, h:0.62, fill:{color:ABG}, line:{color:AM,pt:0.8} });
    s.addText('May distortion: raw +3 masks -13 organic. An extra Sunday worth +16 expected events simply did not materialise -- the most misleading raw number in the data.',
      { x:5.17, y:4.04, w:4.4, h:0.58, fontSize:9.5, color:AM, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:4.76, w:9.4, h:0.50, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text: cm.slide_4_narrative || 'Calendar analysis determines which month-over-month changes are explained by weekend-day shifts vs organic demand.' }
    ], { x:0.42, y:4.79, w:9.1, h:0.44, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_4 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 5 — Step 3: Organic performance by type
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 3', 'Organic Performance -- True Signal After Removing Calendar Noise', PURP, 5);

    s.addText('Once calendar effects are stripped, the real performance picture:',
      { x:0.3, y:0.76, w:9.4, h:0.26, fontSize:11, color:DK, fontFace:'Calibri' });

    s.addTable([
      [hc('Event Type',PURP,WH,10.5), hc('Raw Delta',PURP,WH,10.5), hc('Calendar Effect',PURP,WH,10.5), hc('Organic Delta',PURP,WH,10.5), hc('Organic %',PURP,WH,10.5)],
      [dc('Adult Race',  LG, DK,true, 'left',10.5), dv('-1', 10.5),  dc('-2.4',ABG,AM,false,'center',10.5), dv('+1.4',10.5), dv('+0.2%',10.5)],
      [dc('Youth Race',  WH, DK,false,'left',10.5), dv('-4', 10.5),  dc('-1.2',ABG,AM,false,'center',10.5), dv('-2.8',10.5), dv('-1.2%',10.5)],
      [dc('Adult Clinic',RBG,RD,true, 'left',10.5), dv('-12',10.5),  dc('-2.0',ABG,AM,false,'center',10.5), dv('-10.0',10.5),dv('-10.3%',10.5)],
      [dc('Youth Clinic',GBG,GD,true, 'left',10.5), dv('+5', 10.5),  dc('-0.6',ABG,AM,false,'center',10.5), dv('+5.6',10.5), dv('+19.4%',10.5)],
    ], { x:0.3, y:1.06, w:9.4, h:2.00, rowH:0.36, fontSize:10.5, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:3.16, w:9.4, h:0.44, fill:{color:BBG}, line:{color:BL,pt:0.8} });
    s.addText('Organic Delta = Actual Delta - Calendar Expected Delta.   Calendar effect = Delta weekend days x 2025 events-per-weekend-day for that month & type.',
      { x:0.42, y:3.18, w:9.1, h:0.40, fontSize:9.5, color:BL, valign:'middle', italic:true, fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3,  y:3.52, w:4.55, h:0.78, fill:{color:RBG}, line:{color:RD,pt:0.8} });
    s.addText([
      { text:(cm.slide_5_callout_left?.split('\\n')[0] || 'Structural Decliner')+'\n', options:{bold:true, fontSize:10.5} },
      { text:'Structurally declining -- the sole driver of the net -12. Calendar noise cannot explain it.', options:{fontSize:9.5} }
    ], { x:0.42, y:3.55, w:4.3, h:0.74, fontSize:9.5, color:RD, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:3.52, w:4.65, h:0.78, fill:{color:GBG}, line:{color:GD,pt:0.8} });
    s.addText([
      { text:(cm.slide_5_callout_right?.split('\\n')[0] || 'Top Grower')+'\n', options:{bold:true, fontSize:10.5} },
      { text:'Only type genuinely growing -- no calendar help. Adult & Youth Race are near-flat after stripping noise.', options:{fontSize:9.5} }
    ], { x:5.17, y:3.55, w:4.4, h:0.74, fontSize:9.5, color:GD, valign:'middle', fontFace:'Calibri' });

    s.addText('Best & worst organic months (calendar-adjusted):',
      { x:0.3, y:4.42, w:9.4, h:0.26, fontSize:10.5, bold:true, color:DK, fontFace:'Calibri' });
    s.addTable([
      [hc('Strongest',GD,WH,10), hc('June +33.2',GD,WH,10),    hc('March +13.4',GD,WH,10), hc('January +5.8',GD,WH,10), hc('April +5.0','43A047',WH,10)],
      [hc('Weakest',  RD,WH,10), hc('August -18.0',RD,WH,10),  hc('July -16.0',RD,WH,10),  hc('May -12.8','E65100',WH,10), hc('November -6.8','C62828',WH,10)],
    ], { x:0.3, y:4.72, w:9.4, h:0.66, rowH:0.31, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:5.44, w:9.4, h:0.14, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText(cm.slide_5_narrative || 'Organic performance reveals the true signal after calendar effects are removed.',
      { x:0.42, y:5.45, w:9.1, h:0.12, fontSize:8.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_5 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 6 — Step 4: Event-level disposition
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 4', 'Did We Really Lose Events?  Event-Level Disposition', DARK, 6);

    const boxes = [
      ['746','63%','Retained', 'Same event, same month',   GBG,  GD],
      ['124','11%','Shifted',  'Same event, diff month',   ABG,  AM],
      ['295','25%','Lost', 'Did not return to 2026',   MRDBG,RD],
      ['263','22%','New',      'Brand new to 2026',        BBG,  BL],
    ];
    boxes.forEach(([n, pct, label, sub, bg, fg], i) => {
      const x = 0.3 + i * 2.38;
      s.addShape(prs.ShapeType.rect, { x, y:0.76, w:2.22, h:1.26, fill:{color:bg}, line:{color:fg,pt:1.2} });
      s.addText(n,           { x, y:0.79, w:2.22, h:0.52, fontSize:27, bold:true, color:fg, align:'center', fontFace:'Calibri' });
      s.addText(pct+' of 2025', { x, y:1.27, w:2.22, h:0.22, fontSize:9, color:fg, align:'center', italic:true, fontFace:'Calibri' });
      s.addText(label,       { x, y:1.47, w:2.22, h:0.22, fontSize:10, bold:true, color:fg, align:'center', fontFace:'Calibri' });
      s.addText(sub,         { x, y:1.67, w:2.22, h:0.28, fontSize:8.5, color:'555555', align:'center', fontFace:'Calibri' });
    });

    s.addText('Summer Replacement Rates -- July & August:', { x:0.3, y:2.10, w:9.4, h:0.26, fontSize:10.5, bold:true, color:DK, fontFace:'Calibri' });
    s.addTable([
      [hc('Month',DARK), hc('2025\nEvents',DARK), hc('Retained',GD,WH,10), hc('Shifted\nOut',AM,WH,10), hc('Lost\n(truly lost)',RD,WH,10), hc('Shifted\nIn',BL,WH,10), hc('New\nAdded',BL,WH,10), hc('2026\nTotal',DARK), hc('Repl.\nRate',DARK)],
      [dc('July',  MRDBG,RD,true,'left',10), dc('181',MRDBG), dc('115',GBG,GD), dc('15',ABG,AM), dc('51',MRDBG,RD,true), dc('12',BBG,BL), dc('38',BBG,BL), dc('165',MRDBG), dc('75%',MRDBG,RD,true)],
      [dc('August',MRDBG,RD,true,'left',10), dc('220',MRDBG), dc('148',GBG,GD), dc('15',ABG,AM), dc('57',MRDBG,RD,true), dc('15',BBG,BL), dc('39',BBG,BL), dc('202',MRDBG), dc('68%',MRDBG,RD,true)],
      [dc('June',  GBG, GD,true,'left',10),  dc('209',GBG),  dc('125',GBG,GD), dc('26',ABG,AM), dc('49',RBG,RD),        dc('18',BBG,BL), dc('77',BBG,BL,true), dc('219',GBG,GD), dc('>100%',GBG,GD,true)],
    ], { x:0.3, y:2.40, w:9.4, h:1.38, rowH:0.38, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addShape(prs.ShapeType.rect, { x:0.3,  y:3.88, w:4.55, h:0.60, fill:{color:'F3E5F5'}, line:{color:'6A1B9A',pt:0.8} });
    s.addText('13 events Tried to Return -- filed a 2026 application but were cancelled/declined. 33 events Recovered -- cancelled in 2025 but came back in 2026.',
      { x:0.42, y:3.90, w:4.3, h:0.56, fontSize:9.5, color:'6A1B9A', valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:3.88, w:4.65, h:0.60, fill:{color:'ECEFF1'}, line:{color:'555555',pt:0.8} });
    s.addText('Overall replacement rate: 296 new/recovered events added vs 308 truly lost -- 96% gross replacement, but weakest in summer peak months.',
      { x:5.17, y:3.90, w:4.4, h:0.56, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:4.60, w:9.4, h:0.65, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text: cm.slide_6_narrative || 'Event-level analysis reveals the composition of gains and losses.' }
    ], { x:0.42, y:4.63, w:9.1, h:0.59, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_6 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 7 — Step 5: Application pipeline & opportunities
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 5', 'Application Pipeline -- Who Is Filing, When, and Where the Opportunities Are', '1B5E20', 7);

    s.addText('Total applications are nearly identical year-over-year (~1,178 vs ~1,167). The story is in WHEN and WHICH type is filing:',
      { x:0.3, y:0.76, w:9.4, h:0.24, fontSize:10.5, color:DK, fontFace:'Calibri' });

    s.addTable([
      [hc('Event Type','1B5E20'), hc('Q4 2024\nPre-Filing','1B5E20'), hc('Jan-May\n2025 In-Yr','1B5E20'), hc('2025\nTotal Apps','1B5E20'),
       hc('Q4 2025\nPre-Filing',TEAL), hc('Jan-May\n2026 In-Yr',TEAL), hc('2026\nTotal Apps',TEAL),
       hc('Delta Q4',DARK), hc('Delta In-Yr\n(YTD)',DARK)],
      [dc('Adult Race',  LG, DK,true, 'left',10), dc('431',LG,DK),  dc('129',LG,DK),  dc('816',LG,DK,true),  dc('409',LG,DK),  dc('173',GBG,GD,true), dc('814',LG,DK,true),  dv('-22'), dv('+44')],
      [dc('Youth Race',  WH, DK,false,'left',10), dc('103',WH,DK),  dc('69', WH,DK),  dc('229',WH,DK,true),  dc('101',WH,DK),  dc('91', GBG,GD,true), dc('226',WH,DK,true),  dv('-2'),  dv('+22')],
      [dc('Adult Clinic',RBG,RD,true, 'left',10), dc('22', RBG,RD), dc('55', RBG,RD), dc('97', RBG,RD,true), dc('22', RBG,RD), dc('55', RBG,RD),      dc('86', RBG,RD,true), dv('0'),   dv('0')],
      [dc('Youth Clinic',GBG,GD,true, 'left',10), dc('8',  GBG,GD), dc('10', GBG,GD), dc('29', GBG,GD,true), dc('12', GBG,GD,true), dc('19',GBG,GD,true), dc('34',GBG,GD,true), dv('+4'), dv('+9')],
      [hc('TOTAL',DARK), hc('564',DARK), hc('263',DARK), hc('1,178',DARK), hc('544',DARK), hc('338',DARK), hc('1,167',DARK), hc('-20',DARK), hc('+75',DARK)],
    ], { x:0.3, y:1.04, w:9.4, h:1.74, rowH:0.28, fontSize:10, border:{type:'solid',pt:0.5,color:'CCCCCC'} });

    s.addText(`${cm.slide_7_opportunity_label || 'Highest-Probability Opportunities -- May through December'}:`,
      { x:0.3, y:2.88, w:9.4, h:0.26, fontSize:10.5, bold:true, color:DK, fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3,  y:3.18, w:4.55, h:1.0, fill:{color:RBG}, line:{color:RD,pt:1.2} });
    s.addText([
      { text:`${cm.slide_7_callout_left_title || 'Highest ROI Opportunity'}\n`, options:{bold:true, fontSize:10.5} },
      { text:'Early pipeline is FLAT vs 2025 (Q4 identical; Jan-May identical). In 2025, 16 additional clinics were filed spontaneously May-Dec -- in 2026 only 1 has filed so far. Proactive outreach May-Aug could recover 10-15 events and effectively close the full -12 gap.', options:{fontSize:9.5} }
    ], { x:0.42, y:3.22, w:4.3, h:0.92, fontSize:9.5, color:RD, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:3.18, w:4.65, h:1.0, fill:{color:GBG}, line:{color:GD,pt:1.2} });
    s.addText([
      { text:'Adult Race & Youth Clinic -- Reinforce\n', options:{bold:true, fontSize:10.5} },
      { text:'Adult Race in-year apps are +34% ahead (Jan-May). Jul-Sep historically adds 15-20 more -- keep the channel open. Youth Clinic is +90% in-year and +50% in Q4 pre-filing -- growth is structural. Fast-track approvals so momentum is not lost to processing.', options:{fontSize:9.5} }
    ], { x:5.17, y:3.22, w:4.4, h:0.92, fontSize:9.5, color:GD, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3,  y:4.28, w:4.55, h:0.50, fill:{color:MRDBG}, line:{color:RD,pt:0.8} });
    s.addText('Adult Clinic action: Target clinic organizers May-Aug before spontaneous window closes. Low effort, high impact.',
      { x:0.42, y:4.30, w:4.3, h:0.46, fontSize:9, color:RD, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:4.28, w:4.65, h:0.50, fill:{color:BBG}, line:{color:BL,pt:0.8} });
    s.addText('Overall pipeline is 16% ahead (+48 in-yr apps) of 2025 pace through May. Year-end active count will likely be higher than the May snapshot shows.',
      { x:5.17, y:4.30, w:4.4, h:0.46, fontSize:9, color:BL, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:0.3, y:4.90, w:9.4, h:0.46, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text:'The application data tells a more optimistic story than the active-event snapshot. Total volume is nearly flat and in-year applications are running 16% ahead of 2025 pace. The single highest-ROI action is Adult Clinic outreach (May-Aug) -- early signals are flat, not falling, but the late-year spontaneous apps that filled 2025 have not materialized yet. Youth Clinic and Adult Race pipelines are healthy and self-sustaining.' }
    ], { x:0.42, y:4.93, w:9.1, h:0.42, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_7 ?? 'Speaker notes loading...');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDE 8 — Step 6: July & August win-back
  // ─────────────────────────────────────────────────────────────────────────
  {
    const s = prs.addSlide();
    s.background = { color:LG };
    addHeader(s, 'Step 6', cm.slide_8_header || 'July & August: Organic Churn and the Win-Back Opportunity', RD, 8);

    s.addText(cm.slide_8_subtitle || 'Replacement is near-complete -- the net declines come from month-shifting, not failed attrition recovery. But the churn volume itself is the problem:',
      { x:0.3, y:0.76, w:9.4, h:0.20, fontSize:10, color:DK, fontFace:'Calibri' });

    // July panel
    s.addTable([
      [hc('July',DARK,WH,9.5),       hc('2025','1A237E',WH,9.5), hc('2026','1A237E',WH,9.5)],
      [dc('Retained',  LG,  DK,false,'left',9.5), dc('115',LG,DK),         dc('115',GBG,GD,true)],
      [dc('Shifted Out',WH, DK,false,'left',9.5), dc('-15',RBG,RD),         dc('--', WH,'AAAAAA')],
      [dc('Lost',  MRDBG,RD,true,'left',9.5), dc('-49',MRDBG,RD,true),  dc('--', MRDBG,'AAAAAA')],
      [dc('Shift In',  WH,  GD,false,'left',9.5), dc('--', WH,'AAAAAA'),    dc('+12',GBG,GD)],
      [dc("New / Rec'd",GBG,GD,false,'left',9.5), dc('--', GBG,'AAAAAA'),   dc('+34',GBG,GD,true)],
    ], { x:0.3, y:1.00, w:4.55, h:1.46, rowH:0.23, fontSize:9.5, border:{type:'solid',pt:0.5,color:'CCCCCC'} });
    s.addShape(prs.ShapeType.rect, { x:0.3, y:2.54, w:4.55, h:0.36, fill:{color:DARK}, line:{color:DARK} });
    s.addText('2025: 179 events  ->  2026: 165       Replacement: 46/49 = 94%',
      { x:0.32, y:2.55, w:4.5, h:0.34, fontSize:9, color:GBG, bold:true, align:'center', valign:'middle', fontFace:'Calibri' });

    // August panel
    s.addTable([
      [hc('August',DARK,WH,9.5),      hc('2025',TEAL,WH,9.5),    hc('2026',TEAL,WH,9.5)],
      [dc('Retained',  LG,  DK,false,'left',9.5), dc('148',LG,DK),         dc('148',GBG,GD,true)],
      [dc('Shifted Out',WH, DK,false,'left',9.5), dc('-15',RBG,RD),         dc('--', WH,'AAAAAA')],
      [dc('Lost',  MRDBG,RD,true,'left',9.5), dc('-55',MRDBG,RD,true),  dc('--', MRDBG,'AAAAAA')],
      [dc('Shift In',  WH,  GD,false,'left',9.5), dc('--', WH,'AAAAAA'),    dc('+15',GBG,GD)],
      [dc("New / Rec'd",GBG,GD,false,'left',9.5), dc('--', GBG,'AAAAAA'),   dc('+36',GBG,GD,true)],
    ], { x:5.05, y:1.00, w:4.65, h:1.46, rowH:0.23, fontSize:9.5, border:{type:'solid',pt:0.5,color:'CCCCCC'} });
    s.addShape(prs.ShapeType.rect, { x:5.05, y:2.54, w:4.65, h:0.36, fill:{color:DARK}, line:{color:DARK} });
    s.addText('2025: 218 events  ->  2026: 202       Replacement: 51/55 = 93%',
      { x:5.07, y:2.55, w:4.6, h:0.34, fontSize:9, color:GBG, bold:true, align:'center', valign:'middle', fontFace:'Calibri' });

    // Lost-by-type summary
    s.addText('Lost events by type (combined Jul + Aug) -- race product is 89% of losses:',
      { x:0.3, y:2.98, w:9.4, h:0.18, fontSize:10, bold:true, color:DK, fontFace:'Calibri' });
    s.addTable([
      [hc('Type',DARK,WH,9.5),      hc('Jul Lost',RD,WH,9.5), hc('Aug Lost',RD,WH,9.5), hc('Combined',DARK,WH,9.5), hc('Share',DARK,WH,9.5)],
      [dc('Adult Race',LG, DK,true, 'left',10), dc('30',MRDBG,RD,true), dc('29',MRDBG,RD,true), dc('59',MRDBG,RD,true), dc('56%',MRDBG,RD,true)],
      [dc('Youth Race',WH, DK,false,'left',10), dc('12',MRDBG,RD),      dc('22',MRDBG,RD,true), dc('34',MRDBG,RD,true), dc('33%',MRDBG,RD)],
    ], { x:0.3, y:3.19, w:9.4, h:0.68, rowH:0.22, fontSize:9.5, border:{type:'solid',pt:0.5,color:'CCCCCC'} });
    s.addText('Adult Clinic: 7 lost (7%)  |  Youth Clinic: 4 lost (4%)  --  minor; not material to win-back prioritisation',
      { x:0.3, y:3.91, w:9.4, h:0.15, fontSize:8.5, color:'777777', italic:true, fontFace:'Calibri' });

    // Two-speed callouts
    s.addShape(prs.ShapeType.rect, { x:0.3,  y:4.14, w:4.55, h:0.78, fill:{color:MRDBG}, line:{color:RD,pt:1.2} });
    s.addText([
      { text:'August -- Act Now (2026 Window)\n', options:{bold:true, fontSize:10.5} },
      { text:'55 lost: 29 Adult Race + 22 Youth Race. Events are 10-12 weeks out -- some organizers are still recruitable. Reach all known 2025 August organizers by end of May. A 20% win-back rate recovers ~11 events and nearly closes the gap.', options:{fontSize:9.5} }
    ], { x:0.42, y:4.17, w:4.3, h:0.72, color:RD, valign:'middle', fontFace:'Calibri' });

    s.addShape(prs.ShapeType.rect, { x:5.05, y:4.14, w:4.65, h:0.78, fill:{color:BBG}, line:{color:BL,pt:1.2} });
    s.addText([
      { text:'July -- Diagnose for 2027\n', options:{bold:true, fontSize:10.5} },
      { text:'49 lost: 30 Adult Race + 12 Youth Race. Too late for 2026 (6 weeks away). But ~50 events leave July annually and ~50 replace them -- a treadmill. Q3 outreach to all 49 organizers to understand WHY they left is the highest-ROI 2027 planning action.', options:{fontSize:9.5} }
    ], { x:5.17, y:4.17, w:4.4, h:0.72, color:BL, valign:'middle', fontFace:'Calibri' });

    // Narrative
    s.addShape(prs.ShapeType.rect, { x:0.3, y:5.02, w:9.4, h:0.36, fill:{color:'ECEFF1'}, line:{color:'CCCCCC',pt:0.5} });
    s.addText([
      { text:'Narrative:  ', options:{bold:true} },
      { text:"July and August each lose ~50 events and replace ~94-93% of them organically -- the ecosystem is self-replenishing but not fast enough to fully offset churn. The net decline is a volume problem, not a demand collapse. The immediate 2026 action is August win-back outreach (end of May). The strategic action is diagnosing July's churn before Q4 planning to protect 2027." }
    ], { x:0.42, y:5.05, w:9.1, h:0.32, fontSize:9.5, color:DK, valign:'middle', fontFace:'Calibri' });

    s.addNotes(cm.notes?.slide_8 ?? 'Speaker notes loading...');
  }

  return prs.writeFile({ fileName: outPath });
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('USAT Sanctioned Events -- Build All');
  console.log('====================================');
  console.log(`  2025 events CSV     : ${csv_25}`);
  console.log(`  2026 events CSV     : ${csv_26}`);
  console.log(`  2025 creation CSV   : ${csv_create_25}`);
  console.log(`  2026 creation CSV   : ${csv_create_26}`);
  console.log(`  Excel output        : ${out_xlsx}`);
  console.log(`  PowerPoint output   : ${out_pptx}`);
  console.log('');

  // ── Archive prior outputs ──────────────────────────────────────────────────
  archive_outputs(path.join(DIR, 'output'), out_xlsx, out_pptx);

  // ── Excel ────────────────────────────────────────────────────────────────
  console.log('Building Excel workbook...');
  const loaded  = load_both_years(csv_25, csv_26);
  // Extract analysis years from CSV filenames (e.g. "2025a_events..." → 2025)
  const year_a_match = path.basename(csv_25).match(/^(\d{4})/);
  const year_b_match = path.basename(csv_26).match(/^(\d{4})/);
  const year_a = year_a_match ? Number(year_a_match[1]) : new Date().getFullYear() - 1;
  const year_b = year_b_match ? Number(year_b_match[1]) : new Date().getFullYear();
  loaded.year_a = year_a;
  loaded.year_b = year_b;
  console.log(`  2025 active: ${loaded.y25active.length}  |  2026 active: ${loaded.y26active.length}`);
  const results = run_analysis(loaded);
  results.years = { year_a, year_b };
  console.log('  Segments:', JSON.stringify(results.segSummary));

  // Export analysis results dataset
  const out_results_json = path.join(DIR, 'output', 'analysis_results.json');
  const results_export = {
    generated_at: new Date().toISOString(),
    years: { year_a: 2025, year_b: 2026 },
    totals: { year_a: loaded.y25active.length, year_b: loaded.y26active.length, net: loaded.y26active.length - loaded.y25active.length },
    segments: results.segSummary,
    by_type: results.typeAnnual ?? {},
    monthly: Object.fromEntries(Object.entries(results.monthly ?? {}).map(([m, d]) => [m, { n25: d.n25, n26: d.n26, net_delta: d.netDelta, net_shift: d.netShift, organic_delta: results.calImpact?.[Number(m)-1]?.orgTotal ?? null }])),
    organic_by_type: results.organicByType ?? {},
    shift_flow: results.shiftFlow ?? {},
    calendar_impact: results.calImpact ?? {},
    overrides: results.override_summary ?? { total_applied: 0, applied: [], warnings: [] },
  };
  save_json(out_results_json, results_export);
  console.log(`  Analysis results saved: output/analysis_results.json`);

  // ── Generate commentary (rule-based, upgraded to AI if key present) ────────
  const api_key = process.env.ANTHROPIC_API_KEY || null;
  let commentary = null;
  if (api_key && api_key !== 'sk-ant-your-key-here') {
    console.log('  AI commentary enabled -- calling Claude API for insights...');
    try {
      commentary = await generate_ai(results, api_key);
      if (commentary._ai_generated) {
        console.log('  AI commentary generated successfully.');
      }
    } catch (err) {
      console.warn('  AI commentary failed:', err.message, '-- using rule-based fallback');
      commentary = null;
    }
  } else {
    console.log('  Using rule-based commentary (add ANTHROPIC_API_KEY to .env to enable AI insights)');
  }
  // Ensure we always have commentary
  if (!commentary) commentary = generate_rule_based(results);

  // Export commentary dataset
  const out_commentary_json = path.join(DIR, 'output', 'commentary.json');
  save_json(out_commentary_json, {
    generated_at: new Date().toISOString(),
    mode:  commentary._ai_generated ? 'ai_claude' : 'rule_based',
    model: commentary._ai_generated ? 'claude-haiku-4-5-20251001' : null,
    ...commentary,
  });
  console.log(`  Commentary saved: output/commentary.json (mode: ${commentary._ai_generated ? 'ai_claude' : 'rule_based'})`);

  // ── Excel (receives commentary for dynamic narrative cells) ───────────────
  await build_workbook(results, out_xlsx, csv_create_25, csv_create_26, commentary);
  console.log('  Excel done.\n');

  // ── PowerPoint ────────────────────────────────────────────────────────────
  // ── Auto-append build summary to notes.md ───────────────────────────────────
  try {
    const notes_path = path.join(DIR, 'notes.md');
    let notes_content = '';
    try { notes_content = fs.readFileSync(notes_path, 'utf8'); } catch { /* ok */ }

    // Keep only the last 5 build summaries in notes.md
    const BUILD_TAG = '\n---\n### Build run:';
    const existing_builds = notes_content.split(BUILD_TAG).filter(Boolean);
    const static_part = notes_content.startsWith(BUILD_TAG) ? '' :
      notes_content.slice(0, notes_content.indexOf('\n---\n### Build run:') >= 0
        ? notes_content.indexOf('\n---\n### Build run:') : undefined);

    const new_build = `${BUILD_TAG} ${new Date().toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short'})} | mode: ${commentary._ai_generated ? 'ai_claude' : 'rule_based'}
- Total: ${results.y25active.length} (prior) → ${results.y26active.length} (current), net ${results.y26active.length - results.y25active.length}
- Segments: Retained ${results.segSummary.Retained}, Shifted ${results.segSummary.Shifted}, Lost ${results.segSummary.Lost}, New ${results.segSummary.New}
- Top issue: ${commentary.top_decliner ? commentary.top_decliner.type + ' ' + commentary.top_decliner.pct + '%' : 'No clear decliner'}
- Top growth: ${commentary.top_grower ? commentary.top_grower.type + ' +' + commentary.top_grower.pct + '%' : 'None'}
- Worst months: ${commentary.worst_months?.slice(0,2).map(m => m.label + ' (' + (m.delta >= 0 ? '+' : '') + m.delta + ')').join(', ')}
`;

    const recent_builds = [...existing_builds.slice(-4), new_build.replace(BUILD_TAG, '')];
    const final_notes = (static_part || notes_content.split(BUILD_TAG)[0] || '')
      .trimEnd() + recent_builds.map(b => BUILD_TAG + b).join('');

    fs.writeFileSync(notes_path, final_notes, 'utf8');
    console.log('  Build summary appended to notes.md');
  } catch (err) {
    // Non-fatal — notes.md update failing shouldn't stop the build
  }

  console.log('Building PowerPoint deck...');
  await buildDeck(out_pptx, results, commentary);
  console.log('  PowerPoint done.\n');

  // ── HTML dashboard ───────────────────────────────────────────────────────
  const out_dashboard = path.join(DIR, 'output', 'dashboard.html');
  generate_dashboard(results_export, commentary, out_dashboard, results.segments);
  console.log(`  Dashboard: ${out_dashboard}`);

  // ── Diff report ───────────────────────────────────────────────────────────
  try {
    const archive_dir = path.join(DIR, 'output', 'archive');
    const prior_runs = fs.existsSync(archive_dir) ? fs.readdirSync(archive_dir).sort().reverse() : [];
    const prior_cm_path = prior_runs.length
      ? path.join(archive_dir, prior_runs[0], 'commentary.json')
      : null;
    const prior_cm = prior_cm_path && fs.existsSync(prior_cm_path)
      ? JSON.parse(fs.readFileSync(prior_cm_path, 'utf8'))
      : null;

    if (prior_cm) {
      const diff_lines = [];
      diff_lines.push(`Changes since last build (${prior_runs[0]})`);
      diff_lines.push('='.repeat(60));

      // Compare key metrics
      const metric_keys = ['n25','n26','net','attrited','new_ev','rec','repl_rate'];
      const metric_labels = { n25: 'Prior-yr events', n26: 'Current-yr events', net: 'Net change',
        attrited: 'Lost', new_ev: 'New events', rec: 'Recovered', repl_rate: 'Replacement rate %' };
      let metrics_changed = 0;
      diff_lines.push('\nKey metrics:');
      for (const k of metric_keys) {
        const old_v = prior_cm[k], new_v = commentary[k];
        if (old_v !== undefined && new_v !== undefined && old_v !== new_v) {
          diff_lines.push(`  ${(metric_labels[k] ?? k).padEnd(22)} ${String(old_v).padStart(6)} → ${String(new_v).padStart(6)}`);
          metrics_changed++;
        }
      }
      if (!metrics_changed) diff_lines.push('  (no metric changes)');

      // Compare narratives
      const narrative_keys = ['slide_2_narrative','slide_3_narrative','slide_4_narrative',
                               'slide_5_narrative','slide_6_narrative','slide_7_narrative','slide_8_narrative'];
      diff_lines.push('\nNarrative changes:');
      let narr_changed = 0;
      for (const k of narrative_keys) {
        if (prior_cm[k] !== commentary[k] && commentary[k]) {
          diff_lines.push(`  ${k}:`);
          diff_lines.push(`    WAS: ${(prior_cm[k] ?? '(none)').slice(0, 120)}...`);
          diff_lines.push(`    NOW: ${commentary[k].slice(0, 120)}...`);
          narr_changed++;
        }
      }
      if (!narr_changed) diff_lines.push('  (no narrative changes)');

      // Mode change
      if (prior_cm.mode !== commentary.mode) {
        diff_lines.push(`\nCommentary mode: ${prior_cm.mode} → ${commentary.mode}`);
      }

      // Overrides
      const prior_ov = prior_cm._ai_generated !== undefined ? 0 : 0;
      if (results.override_summary?.total_applied) {
        diff_lines.push(`\nActive overrides: ${results.override_summary.total_applied}`);
        results.override_summary.applied.forEach(a => diff_lines.push(`  ${a.type}: ${a.sid_25 ?? ''}${a.sid_26 ? '/' + a.sid_26 : ''} → ${a.result}`));
      }

      diff_lines.push('\n' + '='.repeat(60));
      const diff_text = diff_lines.join('\n');
      fs.writeFileSync(path.join(DIR, 'output', 'changes.txt'), diff_text, 'utf8');
      console.log(`  Changes:   output/changes.txt (${metrics_changed} metric change(s), ${narr_changed} narrative change(s))`);
    }
  } catch (err) {
    /* diff is non-fatal */
  }

  console.log('Done!');
  console.log(`  Excel      : ${out_xlsx}`);
  console.log(`  PowerPoint : ${out_pptx}`);
  console.log(`  Results    : ${out_results_json}`);
  console.log(`  Commentary : ${out_commentary_json}`);
}

main().catch(err => {
  console.error('Build failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
