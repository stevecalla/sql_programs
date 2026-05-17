/**
 * step_5_creation_pipeline — When were prior-year and current-year events filed?
 *
 * Parts:
 *   A — Application totals (prior-year vs in-year) by type
 *   B — In-year month-by-month Jan–May pace comparison
 *   C — Prior-year Q4 (Oct–Dec) planning applications
 *   D — Key findings
 *   E — Highest-probability opportunities in the remaining window
 *   F — Call to action
 */

'use strict';

const { C, fill, font, align, applyBorders } = require('../styles');

const TYPES  = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MO_LBL = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                 7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

// ── Style helpers ─────────────────────────────────────────────────────────

function hdr(ws, row, col, val, bgHex, fgHex = C.WH, sz = 10, h = 'center', colspan = 1) {
  const c = ws.getCell(row, col);
  c.value     = val;
  c.fill      = fill(bgHex);
  c.font      = font({ bold: true, sz, color: fgHex });
  c.alignment = align({ h, v: 'middle', wrap: true });
  if (colspan > 1) ws.mergeCells(row, col, row, col + colspan - 1);
  return c;
}

function dat(ws, row, col, val, bgHex = C.WH, fgHex = C.DK, bold = false, sz = 10, h = 'center') {
  const c = ws.getCell(row, col);
  c.value     = val;
  c.fill      = fill(bgHex);
  c.font      = font({ bold, sz, color: fgHex });
  c.alignment = align({ h, v: 'middle', wrap: true });
  return c;
}

function dlt(ws, row, col, n, sz = 10) {
  const num  = typeof n === 'number' ? n : parseFloat(String(n).replace(/[^0-9.\-]/g, ''));
  const bg   = num > 0 ? C.GBG : num < 0 ? C.RBG : C.LG;
  const fg   = num > 0 ? C.GD  : num < 0 ? C.RD  : C.DK;
  const bold = Math.abs(num) >= 8;
  dat(ws, row, col, n, bg, fg, bold, sz);
}

function gapRow(ws, row, cols = 13) {
  for (let c = 1; c <= cols; c++) ws.getCell(row, c).fill = fill(C.LG);
  ws.getRow(row).height = 5;
}

function sectionHdr(ws, row, txt, cols = 13) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value     = txt;
  c.fill      = fill(C.DK);
  c.font      = font({ bold: true, sz: 10.5, color: C.WH });
  c.alignment = align({ h: 'left', v: 'middle' });
  ws.getRow(row).height = 19;
}

function note(ws, row, txt, cols = 13) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value     = txt;
  c.fill      = fill('555555');
  c.font      = font({ italic: true, sz: 8.5, color: C.WH });
  c.alignment = align({ h: 'left', v: 'middle', wrap: true });
  ws.getRow(row).height = 13;
}

function applyTableBorders(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      ws.getCell(r, c).border = {
        top:    { style:'thin', color:{ argb:'FFCCCCCC' } },
        bottom: { style:'thin', color:{ argb:'FFCCCCCC' } },
        left:   { style:'thin', color:{ argb:'FFCCCCCC' } },
        right:  { style:'thin', color:{ argb:'FFCCCCCC' } },
      };
    }
  }
}

// ── Row helpers ───────────────────────────────────────────────────────────
// Rows arrive pre-shaped from src/db.js as { yr, type, mo, cnt }.

function get(rows, yr, type, mo = null) {
  const mo_matches = (rmo) => {
    if (mo === null) return true;
    if (Array.isArray(mo)) return mo.includes(rmo);
    return rmo === mo;
  };
  return rows
    .filter(r => r.yr === yr && r.type === type && mo_matches(r.mo))
    .reduce((s, r) => s + r.cnt, 0);
}

// ── Colour-by-type ────────────────────────────────────────────────────────

const TYPE_BG = {
  'Adult Race':   C.LG,
  'Youth Race':   C.WH,
  'Adult Clinic': C.RBG,
  'Youth Clinic': C.GBG,
};
const TYPE_FG = {
  'Adult Race':   C.DK,
  'Youth Race':   C.DK,
  'Adult Clinic': C.RD,
  'Youth Clinic': C.GD,
};

// ── Main builder ──────────────────────────────────────────────────────────

/**
 * @param {ExcelJS.Workbook} wb
 * @param {Array<{yr:number,type:string,mo:number,cnt:number}>} rows25  prior-year events
 * @param {Array<{yr:number,type:string,mo:number,cnt:number}>} rows26  current-year events
 * @param {object|null} cm
 * @param {object|null} results  full analysis output (for year_a/year_b + typeAnnual)
 */
module.exports = function build_creation_pipeline(wb, rows25, rows26, cm = null, results = null) {
  const ev25 = rows25;
  const ev26 = rows26;

  // Year context — fall back to current/prior year if results isn't supplied.
  const YA = results?.years?.year_a ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.year_b ?? new Date().getFullYear();
  const PRE_YA = YA - 1;   // prior year before YA (Q4 pre-filing window for YA events)
  // In-year window: through current month when YB is the current year, else full year.
  const NOW = new Date();
  const CUTOFF_MO = (YB === NOW.getFullYear()) ? Math.max(1, Math.min(12, NOW.getMonth() + 1)) : 12;
  const IN_YR_MOS = Array.from({ length: CUTOFF_MO }, (_, i) => i + 1);
  const cutoff_label = `Jan-${MO_LBL[CUTOFF_MO]}`;

  // Active-event counts come from results.typeAnnual (computed from c25/c26),
  // not from a stale hardcoded map.
  const typeAnnual = results?.typeAnnual ?? {};
  const ACTIVE_A = Object.fromEntries(TYPES.map(t => [t, typeAnnual[t]?.tot25 ?? 0]));
  const ACTIVE_B = Object.fromEntries(TYPES.map(t => [t, typeAnnual[t]?.tot26 ?? 0]));
  const TOT_A = TYPES.reduce((s, t) => s + ACTIVE_A[t], 0);
  const TOT_B = TYPES.reduce((s, t) => s + ACTIVE_B[t], 0);

  const ws = wb.addWorksheet('step_5_creation_pipeline');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // Column widths
  [22,10,10,10,12,2,10,10,10,12,2,10,11].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Title
  ws.mergeCells('A1:M1');
  Object.assign(ws.getCell('A1'), {
    value:     `Step 5 — Application Creation Pipeline: When Were ${YA} and ${YB} Events Filed?`,
    fill:      fill(C.DR),
    font:      font({ bold: true, sz: 13, color: C.WH }),
    alignment: align({ h: 'left', v: 'middle' }),
  });
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:M2');
  Object.assign(ws.getCell('A2'), {
    value:     '"Prior-year" = filed in the year before the event runs.  "In-year" = filed in the same calendar year as the event.',
    fill:      fill('444444'),
    font:      font({ italic: true, sz: 9.5, color: C.WH }),
    alignment: align({ h: 'left', v: 'middle' }),
  });
  ws.getRow(2).height = 15;

  let row = 3;

  // ── PART A — Totals ──────────────────────────────────────────────────────
  gapRow(ws, row, 13); row++;
  sectionHdr(ws, row, 'PART A — Application Totals: Prior-Year vs In-Year, by Type', 13); row++;

  ws.getRow(row).height = 34;
  hdr(ws, row, 1, 'Event Type',     C.DK,      C.WH, 10, 'left');
  hdr(ws, row, 2, `Prior-Yr Apps\n${PRE_YA}→${YA}`, '1A237E', C.WH, 9);
  hdr(ws, row, 3, `In-Yr Apps\n${YA} in-yr`,  '1A237E', C.WH, 9);
  hdr(ws, row, 4, `${YA}\nTotal Apps`,          '1A237E', C.WH, 9);
  hdr(ws, row, 5, `${YA}\nActive Events`,       '1A237E', C.WH, 9);
  ws.getCell(row, 6).fill = fill(C.LG);
  hdr(ws, row, 7, `Prior-Yr Apps\n${YA}→${YB}`, C.TL || '006064', C.WH, 9);
  hdr(ws, row, 8, `In-Yr Apps\n${YB} in-yr`,   C.TL || '006064', C.WH, 9);
  hdr(ws, row, 9, `${YB}\nTotal Apps`,          C.TL || '006064', C.WH, 9);
  hdr(ws, row,10, `${YB}\nActive Events`,       C.TL || '006064', C.WH, 9);
  ws.getCell(row, 11).fill = fill(C.LG);
  hdr(ws, row,12, 'Delta\nPrior-Yr', '37474F', C.WH, 9);
  hdr(ws, row,13, 'Delta\nIn-Yr YTD', '37474F', C.WH, 9);
  applyTableBorders(ws, row, 1, row, 13);
  row++;

  let totPr25=0, totIy25=0, totPr26=0, totIy26=0;
  for (const t of TYPES) {
    const bg = TYPE_BG[t], fg = TYPE_FG[t];
    const bold = t === 'Adult Clinic' || t === 'Youth Clinic';
    const pr25 = get(ev25, PRE_YA, t), iy25 = get(ev25, YA, t);
    const pr26 = get(ev26, YA,     t), iy26 = get(ev26, YB, t);
    totPr25+=pr25; totIy25+=iy25; totPr26+=pr26; totIy26+=iy26;
    ws.getRow(row).height = 15;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    dat(ws,row,2,pr25,bg,fg,false,10);
    dat(ws,row,3,iy25,bg,fg,false,10);
    dat(ws,row,4,pr25+iy25,bg,fg,true,10);
    dat(ws,row,5,ACTIVE_A[t],bg,fg,true,10);
    ws.getCell(row,6).fill = fill(C.LG);
    dat(ws,row,7,pr26,bg,fg,false,10);
    dat(ws,row,8,iy26,bg,fg,false,10);
    dat(ws,row,9,pr26+iy26,bg,fg,true,10);
    dat(ws,row,10,ACTIVE_B[t],bg,fg,true,10);
    ws.getCell(row,11).fill = fill(C.LG);
    dlt(ws,row,12,pr26-pr25);
    dlt(ws,row,13,iy26-iy25);
    applyTableBorders(ws,row,1,row,13);
    row++;
  }
  // Total row
  ws.getRow(row).height = 18;
  hdr(ws,row,1,'TOTAL','37474F',C.WH,10,'left');
  dat(ws,row,2,totPr25,'37474F',C.WH,true,10); dat(ws,row,3,totIy25,'37474F',C.WH,true,10);
  dat(ws,row,4,totPr25+totIy25,'37474F',C.WH,true,10); dat(ws,row,5,TOT_A,'37474F',C.WH,true,10);
  ws.getCell(row,6).fill=fill(C.LG);
  dat(ws,row,7,totPr26,'37474F',C.WH,true,10); dat(ws,row,8,totIy26,'37474F',C.WH,true,10);
  dat(ws,row,9,totPr26+totIy26,'37474F',C.WH,true,10); dat(ws,row,10,TOT_B,'37474F',C.WH,true,10);
  ws.getCell(row,11).fill=fill(C.LG);
  dlt(ws,row,12,totPr26-totPr25); dlt(ws,row,13,totIy26-totIy25);
  applyTableBorders(ws,row,1,row,13); row++;

  // ── PART B — In-year by month ───────────────────────────────────────────
  gapRow(ws, row, 13); row++;
  sectionHdr(ws, row, `PART B — In-Year Applications by Month (${cutoff_label}): ${YA} Pace vs ${YB} Pace`, 13); row++;
  note(ws, row, `${YA} in-year = applications filed Jan-Dec ${YA} for ${YA} events.   ${YB} in-year = applications filed ${cutoff_label} ${YB} for ${YB} events (window through current month).`, 13); row++;

  ws.getRow(row).height = 30;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  IN_YR_MOS.forEach((mo,i)=>hdr(ws,row,i+2,`${MO_LBL[mo]}\n${YA}`,'1A237E',C.WH,9));
  hdr(ws,row,7,`YTD\n${cutoff_label}\n${YA}`,'1A237E',C.WH,9);
  ws.getCell(row,8).fill=fill(C.LG);
  IN_YR_MOS.forEach((mo,i)=>hdr(ws,row,i+9,`${MO_LBL[mo]}\n${YB}`,C.TL||'006064',C.WH,9));
  hdr(ws,row,14,`YTD\n${cutoff_label}\n${YB}`,C.TL||'006064',C.WH,9);
  applyTableBorders(ws,row,1,row,14); row++;

  for (const t of TYPES) {
    const bg=TYPE_BG[t], fg=TYPE_FG[t], bold=t==='Adult Clinic'||t==='Youth Clinic';
    ws.getRow(row).height = 15;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    let y25=0,y26=0;
    IN_YR_MOS.forEach((mo,i)=>{
      const v25=get(ev25,YA,t,mo), v26=get(ev26,YB,t,mo);
      dat(ws,row,i+2,v25||'—',bg,fg,false,10); y25+=v25;
      dat(ws,row,i+9,v26||'—',bg,fg,false,10); y26+=v26;
    });
    dat(ws,row,7,y25,bg,fg,true,10);
    ws.getCell(row,8).fill=fill(C.LG);
    dat(ws,row,14,y26,bg,fg,true,10);
    applyTableBorders(ws,row,1,row,14); row++;
  }
  // Total
  ws.getRow(row).height=18;
  dat(ws,row,1,'TOTAL','37474F',C.WH,true,10,'left');
  let tYTD25=0,tYTD26=0;
  IN_YR_MOS.forEach((mo,i)=>{
    const v25=TYPES.reduce((s,t)=>s+get(ev25,YA,t,mo),0);
    const v26=TYPES.reduce((s,t)=>s+get(ev26,YB,t,mo),0);
    dat(ws,row,i+2,v25,'37474F',C.WH,true,10); dat(ws,row,i+9,v26,'37474F',C.WH,true,10);
    tYTD25+=v25; tYTD26+=v26;
  });
  dat(ws,row,7,tYTD25,'37474F',C.WH,true,10);
  ws.getCell(row,8).fill=fill(C.LG);
  dat(ws,row,14,tYTD26,'37474F',C.WH,true,10);
  applyTableBorders(ws,row,1,row,14); row++;
  // Delta row
  ws.getRow(row).height=15;
  dat(ws,row,1,`Delta (${YB} vs ${YA})`,C.LG,C.DK,true,10,'left');
  IN_YR_MOS.forEach((mo,i)=>{
    const d=TYPES.reduce((s,t)=>s+get(ev26,YB,t,mo)-get(ev25,YA,t,mo),0);
    dlt(ws,row,i+2,d); dlt(ws,row,i+9,d);
  });
  dlt(ws,row,7,tYTD26-tYTD25); ws.getCell(row,8).fill=fill(C.LG); dlt(ws,row,14,tYTD26-tYTD25);
  applyTableBorders(ws,row,1,row,14); row++;

  // ── PART C — Prior-year Q4 ───────────────────────────────────────────────
  gapRow(ws,row,14); row++;
  sectionHdr(ws,row,'PART C — Prior-Year Q4 Planning Applications (Oct-Dec): The Earliest Demand Signal',13); row++;
  note(ws,row,`Q4 prior-year applications = the earliest indicator of next-year event volume. Compared: Q4 ${PRE_YA} (filing for ${YA}) vs Q4 ${YA} (filing for ${YB}).`,13); row++;

  ws.getRow(row).height=28;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  hdr(ws,row,2,`Oct ${PRE_YA}`,'1A237E',C.WH,9); hdr(ws,row,3,`Nov ${PRE_YA}`,'1A237E',C.WH,9); hdr(ws,row,4,`Dec ${PRE_YA}`,'1A237E',C.WH,9); hdr(ws,row,5,`Q4-${PRE_YA}`,'1A237E',C.WH,9);
  ws.getCell(row,6).fill=fill(C.LG);
  hdr(ws,row,7,`Oct ${YA}`,C.TL||'006064',C.WH,9); hdr(ws,row,8,`Nov ${YA}`,C.TL||'006064',C.WH,9); hdr(ws,row,9,`Dec ${YA}`,C.TL||'006064',C.WH,9); hdr(ws,row,10,`Q4-${YA}`,C.TL||'006064',C.WH,9);
  ws.getCell(row,11).fill=fill(C.LG);
  hdr(ws,row,12,'Delta Q4','37474F',C.WH,9); hdr(ws,row,13,'Delta %','37474F',C.WH,9);
  applyTableBorders(ws,row,1,row,13); row++;

  let tQ425=0,tQ426=0;
  for(const t of TYPES){
    const bg=TYPE_BG[t],fg=TYPE_FG[t],bold=t==='Adult Clinic'||t==='Youth Clinic';
    ws.getRow(row).height=15;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    let q25=0,q26=0;
    [10,11,12].forEach((mo,i)=>{
      const v25=get(ev25,PRE_YA,t,mo), v26=get(ev26,YA,t,mo);
      dat(ws,row,i+2,v25||'—',bg,fg,false,10); q25+=v25;
      dat(ws,row,i+7,v26||'—',bg,fg,false,10); q26+=v26;
    });
    dat(ws,row,5,q25,bg,fg,true,10); ws.getCell(row,6).fill=fill(C.LG);
    dat(ws,row,10,q26,bg,fg,true,10); ws.getCell(row,11).fill=fill(C.LG);
    dlt(ws,row,12,q26-q25);
    const pct=q25?`${((q26-q25)/q25*100).toFixed(1)}%`:'—';
    dat(ws,row,13,pct,q26>=q25?C.GBG:C.RBG,q26>=q25?C.GD:C.RD,false,10);
    tQ425+=q25; tQ426+=q26;
    applyTableBorders(ws,row,1,row,13); row++;
  }
  ws.getRow(row).height=18;
  dat(ws,row,1,'TOTAL','37474F',C.WH,true,10,'left');
  dat(ws,row,2,TYPES.reduce((s,t)=>s+get(ev25,PRE_YA,t,10),0),'37474F',C.WH,true,10);
  dat(ws,row,3,TYPES.reduce((s,t)=>s+get(ev25,PRE_YA,t,11),0),'37474F',C.WH,true,10);
  dat(ws,row,4,TYPES.reduce((s,t)=>s+get(ev25,PRE_YA,t,12),0),'37474F',C.WH,true,10);
  dat(ws,row,5,tQ425,'37474F',C.WH,true,10); ws.getCell(row,6).fill=fill(C.LG);
  dat(ws,row,7,TYPES.reduce((s,t)=>s+get(ev26,YA,t,10),0),'37474F',C.WH,true,10);
  dat(ws,row,8,TYPES.reduce((s,t)=>s+get(ev26,YA,t,11),0),'37474F',C.WH,true,10);
  dat(ws,row,9,TYPES.reduce((s,t)=>s+get(ev26,YA,t,12),0),'37474F',C.WH,true,10);
  dat(ws,row,10,tQ426,'37474F',C.WH,true,10); ws.getCell(row,11).fill=fill(C.LG);
  dlt(ws,row,12,tQ426-tQ425);
  dat(ws,row,13,`${((tQ426-tQ425)/tQ425*100).toFixed(1)}%`,tQ426>=tQ425?C.GBG:C.RBG,tQ426>=tQ425?C.GD:C.RD,true,10);
  applyTableBorders(ws,row,1,row,13); row++;

  // ── PART D — Key Findings ────────────────────────────────────────────────
  gapRow(ws,row,13); row++;
  sectionHdr(ws,row,'PART D — Key Findings',13); row++;

  const pipeline_findings = cm?.excel_pipeline_findings ?? {};
  // Compute dynamic per-type narrative for the four event types — uses the
  // numbers already calculated in Part A so this always tells the truth about
  // the current data. Commentary overrides via `pipeline_findings[type]`.
  const finding_for = (t) => {
    const pr_a = get(ev25, PRE_YA, t, [10,11,12]);
    const iy_a = IN_YR_MOS.reduce((s,m)=>s+get(ev25,YA,t,m),0);
    const pr_b = get(ev26, YA,     t, [10,11,12]);
    const iy_b = IN_YR_MOS.reduce((s,m)=>s+get(ev26,YB,t,m),0);
    const fmtd = n => n > 0 ? `+${n}` : `${n}`;
    const pct  = (a,b) => a ? `${(((b-a)/a)*100).toFixed(0)}%` : 'n/a';
    return `Prior-year Q4 apps: ${pr_a}->${pr_b} (${fmtd(pr_b - pr_a)}, ${pct(pr_a, pr_b)}).  In-year ${cutoff_label}: ${iy_a}->${iy_b} (${fmtd(iy_b - iy_a)}, ${pct(iy_a, iy_b)}).  Active events: ${ACTIVE_A[t]} -> ${ACTIVE_B[t]} (${fmtd(ACTIVE_B[t] - ACTIVE_A[t])}).`;
  };
  const overall_iy_a = IN_YR_MOS.reduce((s,m)=>s+TYPES.reduce((ss,t)=>ss+get(ev25,YA,t,m),0),0);
  const overall_iy_b = IN_YR_MOS.reduce((s,m)=>s+TYPES.reduce((ss,t)=>ss+get(ev26,YB,t,m),0),0);
  const overall_fmt = (overall_iy_b - overall_iy_a) > 0 ? `+${overall_iy_b - overall_iy_a}` : `${overall_iy_b - overall_iy_a}`;
  const overall_pct = overall_iy_a ? `${(((overall_iy_b - overall_iy_a) / overall_iy_a) * 100).toFixed(0)}%` : 'n/a';
  const findings = [
    ['Adult Race',   C.LG,   C.DK,  C.DK,
     pipeline_findings['Adult Race']   || finding_for('Adult Race')],
    ['Youth Race',   C.WH,   C.DK,  C.DK,
     pipeline_findings['Youth Race']   || finding_for('Youth Race')],
    ['Adult Clinic', C.RBG,  C.RD,  C.RD,
     pipeline_findings['Adult Clinic'] || finding_for('Adult Clinic')],
    ['Youth Clinic', C.GBG,  C.GD,  C.GD,
     pipeline_findings['Youth Clinic'] || finding_for('Youth Clinic')],
    ['Overall Pipeline', C.BBG || 'E3F2FD', '1565C0', '1565C0',
     pipeline_findings['Overall Pipeline'] || `Total in-year apps through ${MO_LBL[CUTOFF_MO]} ${YB}: ${overall_iy_b} vs ${overall_iy_a} in ${YA} (${overall_fmt}, ${overall_pct}). Pipeline pace ${overall_iy_b >= overall_iy_a ? 'ahead of' : 'behind'} the prior-year comparison window.`],
  ];
  for(const [label,bg,fgL,fgT,text] of findings){
    ws.getRow(row).height=13;
    dat(ws,row,1,label,bg,fgL,true,9.5,'left');
    ws.mergeCells(row,2,row,13);
    dat(ws,row,2,text,bg,fgT,false,9.5,'left');
    applyTableBorders(ws,row,1,row,13); row++;
  }

  // ── PART E — Opportunities ───────────────────────────────────────────────
  gapRow(ws,row,13); row++;
  sectionHdr(ws,row,`PART E — Highest-Probability Application Opportunities in the Remaining Window (${MO_LBL[CUTOFF_MO]}-Dec ${YB})`,13); row++;
  note(ws,row,`"Expected" = if ${YB} follows ${YA} ${MO_LBL[CUTOFF_MO]}-Dec pace.  "Gap" = applications still likely to come in.`,13); row++;

  ws.getRow(row).height=32;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  hdr(ws,row,2,`${YA}\n${MO_LBL[CUTOFF_MO]}-Dec`,'1A237E',C.WH,9); hdr(ws,row,3,`${YB} ${MO_LBL[CUTOFF_MO]}\n(so far)`,'006064',C.WH,9);
  hdr(ws,row,4,`${YB} Expected\n${MO_LBL[CUTOFF_MO]}-Dec`,'006064',C.WH,9); hdr(ws,row,5,'Gap','37474F',C.WH,9);
  hdr(ws,row,6,`${YB} YTD\n${cutoff_label}`,'006064',C.WH,9); hdr(ws,row,7,`${YA} Full\nIn-Yr`,'1A237E',C.WH,9);
  hdr(ws,row,8,`${YB} Projected\nFull In-Yr`,'006064',C.WH,9); hdr(ws,row,9,`vs ${YA}\nFull Yr`,'37474F',C.WH,9);
  hdr(ws,row,10,'Priority','37474F',C.WH,9);
  hdr(ws,row,11,'Why',C.DK,C.WH,9,'left',3);
  applyTableBorders(ws,row,1,row,13); row++;

  const PRIORITY = {
    'Adult Race':   ['High ***',   C.GBG, C.GD,         pipeline_findings['Adult Race priority']   || `Monitor remaining-window applications (${MO_LBL[CUTOFF_MO]}-Dec); historically a non-trivial share lands after this point.`],
    'Youth Race':   ['Medium **',  C.ABG||'FFF8E1', C.AM||'E65100', pipeline_findings['Youth Race priority']   || 'Pipeline tracks active event count. Watch late-year apps to confirm trajectory.'],
    'Adult Clinic': ['Highest ***',C.RBG, C.RD,        pipeline_findings['Adult Clinic priority'] || `Proactive outreach in the remaining window can recover events. Clinics historically appear spontaneously between ${MO_LBL[CUTOFF_MO]} and Dec.`],
    'Youth Clinic': ['Medium **',  C.GBG, C.GD,        pipeline_findings['Youth Clinic priority'] || 'Reinforce growth. Fast-track approvals to avoid processing delays.'],
  };
  for(const t of TYPES){
    const bg=TYPE_BG[t],fg=TYPE_FG[t],bold=t==='Adult Clinic'||t==='Youth Clinic';
    // Remaining-window pace for YA: months from CUTOFF_MO..12 in YA.
    const remaining_mos = Array.from({length:12-CUTOFF_MO+1},(_,k)=>k+CUTOFF_MO);
    const md25 = remaining_mos.reduce((s,mo)=>s+get(ev25,YA,t,mo),0);
    const cur_mo26 = get(ev26,YB,t,CUTOFF_MO);
    const ytd26 = IN_YR_MOS.reduce((s,mo)=>s+get(ev26,YB,t,mo),0);
    const full25 = get(ev25,YA,t);
    const proj26=ytd26+md25;
    const [pr,prBg,prFg,why]=PRIORITY[t];
    ws.getRow(row).height=13;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    dat(ws,row,2,md25,bg,fg); dat(ws,row,3,cur_mo26,bg,fg);
    dat(ws,row,4,md25,bg,fg); dlt(ws,row,5,md25-cur_mo26);
    dat(ws,row,6,ytd26,bg,fg); dat(ws,row,7,full25,bg,fg);
    dat(ws,row,8,proj26,bg,fg,true); dlt(ws,row,9,proj26-full25);
    dat(ws,row,10,pr,prBg,prFg,true,9);
    ws.mergeCells(row,11,row,13);
    dat(ws,row,11,why,bg,fg,false,9,'left');
    applyTableBorders(ws,row,1,row,13); row++;
  }

  // ── PART F — Call to Action ──────────────────────────────────────────────
  gapRow(ws,row,13); row++;
  sectionHdr(ws,row,'PART F — Call to Action',13); row++;
  const ctas = [
    ['Adult Clinic -- Highest ROI', C.RBG, C.RD,
     pipeline_findings['Adult Clinic cta'] || `Target ${MO_LBL[CUTOFF_MO]}-Aug outreach to potential clinic organizers. Late-year (post-${MO_LBL[CUTOFF_MO]}) applications are historically the swing factor for clinics.`],
    ['Adult Race -- Capture Late Registrants', C.LG, C.DK,
     pipeline_findings['Adult Race cta'] || `${MO_LBL[CUTOFF_MO]}-Dec historically brings additional Adult Race apps. Keep the application window open through September.`],
    ['Youth Clinic -- Reinforce the Growth', C.GBG, C.GD,
     pipeline_findings['Youth Clinic cta'] || `Fast-track event approval so momentum is not lost to processing delays. Consider outreach to ${YA} Youth Clinic organizers to encourage expansion.`],
    ['Youth Race -- Monitor Only', C.WH, C.DK,
     pipeline_findings['Youth Race cta'] || 'Application flow is healthy. Watch late-year applications to confirm trajectory holds.'],
  ];
  for(const [label,bg,fg,text] of ctas){
    ws.getRow(row).height=13;
    dat(ws,row,1,label,bg,fg,true,9.5,'left');
    ws.mergeCells(row,2,row,13);
    dat(ws,row,2,text,bg,fg,false,9.5,'left');
    applyTableBorders(ws,row,1,row,13); row++;
  }
};
