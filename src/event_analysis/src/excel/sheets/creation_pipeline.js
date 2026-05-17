/**
 * step_5_creation_pipeline — When were 2025 and 2026 events filed?
 *
 * Parts:
 *   A — Application totals (prior-year vs in-year) by type
 *   B — In-year month-by-month Jan–May pace comparison
 *   C — Prior-year Q4 (Oct–Dec) planning applications
 *   D — Key findings
 *   E — Highest-probability opportunities May–Dec 2026
 *   F — Call to action
 */

'use strict';

const fs  = require('fs');
const csv = require('csv-parse/sync');
const { C, fill, font, align, applyBorders } = require('../styles');

const TYPES  = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MO_LBL = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                 7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };
const ACTIVE_25 = { 'Adult Race':823,'Youth Race':229,'Adult Clinic':97,'Youth Clinic':29 };
const ACTIVE_26 = { 'Adult Race':822,'Youth Race':225,'Adult Clinic':85,'Youth Clinic':34 };

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

// ── CSV loader ────────────────────────────────────────────────────────────

function loadCreationCSV(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = csv.parse(raw, { columns: true, skip_empty_lines: true });
  return rows.map(r => ({
    yr:   parseInt(r.created_at_year_events),
    type: r.name_event_type,
    mo:   parseInt(r.created_at_month_events),
    cnt:  parseInt(r.event_count),
  }));
}

function get(rows, yr, type, mo = null) {
  return rows
    .filter(r => r.yr === yr && r.type === type && (mo === null || r.mo === mo))
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

module.exports = function build_creation_pipeline(wb, csv25Path, csv26Path, cm = null) {
  const ev25 = loadCreationCSV(csv25Path);
  const ev26 = loadCreationCSV(csv26Path);

  const ws = wb.addWorksheet('step_5_creation_pipeline');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // Column widths
  [22,10,10,10,12,2,10,10,10,12,2,10,11].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Title
  ws.mergeCells('A1:M1');
  Object.assign(ws.getCell('A1'), {
    value:     'Step 5 — Application Creation Pipeline: When Were 2025 and 2026 Events Filed?',
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
  hdr(ws, row, 2, 'Prior-Yr Apps\n2024→2025', '1A237E', C.WH, 9);
  hdr(ws, row, 3, 'In-Yr Apps\n2025 in-yr',  '1A237E', C.WH, 9);
  hdr(ws, row, 4, '2025\nTotal Apps',          '1A237E', C.WH, 9);
  hdr(ws, row, 5, '2025\nActive Events',       '1A237E', C.WH, 9);
  ws.getCell(row, 6).fill = fill(C.LG);
  hdr(ws, row, 7, 'Prior-Yr Apps\n2025→2026', C.TL || '006064', C.WH, 9);
  hdr(ws, row, 8, 'In-Yr Apps\n2026 in-yr',   C.TL || '006064', C.WH, 9);
  hdr(ws, row, 9, '2026\nTotal Apps',          C.TL || '006064', C.WH, 9);
  hdr(ws, row,10, '2026\nActive Events',       C.TL || '006064', C.WH, 9);
  ws.getCell(row, 11).fill = fill(C.LG);
  hdr(ws, row,12, 'Delta\nPrior-Yr', '37474F', C.WH, 9);
  hdr(ws, row,13, 'Delta\nIn-Yr YTD', '37474F', C.WH, 9);
  applyTableBorders(ws, row, 1, row, 13);
  row++;

  let totPr25=0, totIy25=0, totPr26=0, totIy26=0;
  for (const t of TYPES) {
    const bg = TYPE_BG[t], fg = TYPE_FG[t];
    const bold = t === 'Adult Clinic' || t === 'Youth Clinic';
    const pr25 = get(ev25, 2024, t), iy25 = get(ev25, 2025, t);
    const pr26 = get(ev26, 2025, t), iy26 = get(ev26, 2026, t);
    totPr25+=pr25; totIy25+=iy25; totPr26+=pr26; totIy26+=iy26;
    ws.getRow(row).height = 15;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    dat(ws,row,2,pr25,bg,fg,false,10);
    dat(ws,row,3,iy25,bg,fg,false,10);
    dat(ws,row,4,pr25+iy25,bg,fg,true,10);
    dat(ws,row,5,ACTIVE_25[t],bg,fg,true,10);
    ws.getCell(row,6).fill = fill(C.LG);
    dat(ws,row,7,pr26,bg,fg,false,10);
    dat(ws,row,8,iy26,bg,fg,false,10);
    dat(ws,row,9,pr26+iy26,bg,fg,true,10);
    dat(ws,row,10,ACTIVE_26[t],bg,fg,true,10);
    ws.getCell(row,11).fill = fill(C.LG);
    dlt(ws,row,12,pr26-pr25);
    dlt(ws,row,13,iy26-iy25);
    applyTableBorders(ws,row,1,row,13);
    row++;
  }
  // Total row
  ws.getRow(row).height = 18;
  hdr(ws,row,1,'TOTAL','37474F',C.WH,10,'left');
  [totPr25,totIy25,totPr25+totIy25,1178].forEach((v,i)=>hdr(ws,row,i+2,'37474F'===v?v:v,'37474F',C.WH,10));
  // redo properly
  dat(ws,row,2,totPr25,'37474F',C.WH,true,10); dat(ws,row,3,totIy25,'37474F',C.WH,true,10);
  dat(ws,row,4,totPr25+totIy25,'37474F',C.WH,true,10); dat(ws,row,5,1178,'37474F',C.WH,true,10);
  ws.getCell(row,6).fill=fill(C.LG);
  dat(ws,row,7,totPr26,'37474F',C.WH,true,10); dat(ws,row,8,totIy26,'37474F',C.WH,true,10);
  dat(ws,row,9,totPr26+totIy26,'37474F',C.WH,true,10); dat(ws,row,10,1166,'37474F',C.WH,true,10);
  ws.getCell(row,11).fill=fill(C.LG);
  dlt(ws,row,12,totPr26-totPr25); dlt(ws,row,13,totIy26-totIy25);
  applyTableBorders(ws,row,1,row,13); row++;

  // ── PART B — In-year Jan–May by month ───────────────────────────────────
  gapRow(ws, row, 13); row++;
  sectionHdr(ws, row, 'PART B — In-Year Applications by Month (Jan–May): 2025 Pace vs 2026 Pace', 13); row++;
  note(ws, row, '2025 in-year = applications filed Jan–Dec 2025 for 2025 events.   2026 in-year = applications filed Jan–May 2026 for 2026 events (year still in progress).', 13); row++;

  ws.getRow(row).height = 30;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  ['Jan','Feb','Mar','Apr','May'].forEach((m,i)=>hdr(ws,row,i+2,`${m}\n2025`,'1A237E',C.WH,9));
  hdr(ws,row,7,'YTD\nJan-May\n2025','1A237E',C.WH,9);
  ws.getCell(row,8).fill=fill(C.LG);
  ['Jan','Feb','Mar','Apr','May'].forEach((m,i)=>hdr(ws,row,i+9,`${m}\n2026`,C.TL||'006064',C.WH,9));
  hdr(ws,row,14,'YTD\nJan-May\n2026',C.TL||'006064',C.WH,9);
  applyTableBorders(ws,row,1,row,14); row++;

  for (const t of TYPES) {
    const bg=TYPE_BG[t], fg=TYPE_FG[t], bold=t==='Adult Clinic'||t==='Youth Clinic';
    ws.getRow(row).height = 15;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    let y25=0,y26=0;
    for(let mo=1;mo<=5;mo++){
      const v25=get(ev25,2025,t,mo), v26=get(ev26,2026,t,mo);
      dat(ws,row,mo+1,v25||'—',bg,fg,false,10); y25+=v25;
      dat(ws,row,mo+9,v26||'—',bg,fg,false,10); y26+=v26;
    }
    dat(ws,row,7,y25,bg,fg,true,10);
    ws.getCell(row,8).fill=fill(C.LG);
    dat(ws,row,14,y26,bg,fg,true,10);
    applyTableBorders(ws,row,1,row,14); row++;
  }
  // Total
  ws.getRow(row).height=18;
  dat(ws,row,1,'TOTAL','37474F',C.WH,true,10,'left');
  let tYTD25=0,tYTD26=0;
  for(let mo=1;mo<=5;mo++){
    const v25=TYPES.reduce((s,t)=>s+get(ev25,2025,t,mo),0);
    const v26=TYPES.reduce((s,t)=>s+get(ev26,2026,t,mo),0);
    dat(ws,row,mo+1,v25,'37474F',C.WH,true,10); dat(ws,row,mo+9,v26,'37474F',C.WH,true,10);
    tYTD25+=v25; tYTD26+=v26;
  }
  dat(ws,row,7,tYTD25,'37474F',C.WH,true,10);
  ws.getCell(row,8).fill=fill(C.LG);
  dat(ws,row,14,tYTD26,'37474F',C.WH,true,10);
  applyTableBorders(ws,row,1,row,14); row++;
  // Delta row
  ws.getRow(row).height=15;
  dat(ws,row,1,'Delta (2026 vs 2025)',C.LG,C.DK,true,10,'left');
  for(let mo=1;mo<=5;mo++){
    const d=TYPES.reduce((s,t)=>s+get(ev26,2026,t,mo)-get(ev25,2025,t,mo),0);
    dlt(ws,row,mo+1,d); dlt(ws,row,mo+9,d);
  }
  dlt(ws,row,7,tYTD26-tYTD25); ws.getCell(row,8).fill=fill(C.LG); dlt(ws,row,14,tYTD26-tYTD25);
  applyTableBorders(ws,row,1,row,14); row++;

  // ── PART C — Prior-year Q4 ───────────────────────────────────────────────
  gapRow(ws,row,14); row++;
  sectionHdr(ws,row,'PART C — Prior-Year Q4 Planning Applications (Oct–Dec): The Earliest Demand Signal',13); row++;
  note(ws,row,'Q4 prior-year applications = the earliest indicator of next-year event volume. Compared: Q4 2024 (filing for 2025) vs Q4 2025 (filing for 2026).',13); row++;

  ws.getRow(row).height=28;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  hdr(ws,row,2,'Oct 2024','1A237E',C.WH,9); hdr(ws,row,3,'Nov 2024','1A237E',C.WH,9); hdr(ws,row,4,'Dec 2024','1A237E',C.WH,9); hdr(ws,row,5,'Q4-2024','1A237E',C.WH,9);
  ws.getCell(row,6).fill=fill(C.LG);
  hdr(ws,row,7,'Oct 2025',C.TL||'006064',C.WH,9); hdr(ws,row,8,'Nov 2025',C.TL||'006064',C.WH,9); hdr(ws,row,9,'Dec 2025',C.TL||'006064',C.WH,9); hdr(ws,row,10,'Q4-2025',C.TL||'006064',C.WH,9);
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
      const v25=get(ev25,2024,t,mo), v26=get(ev26,2025,t,mo);
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
  dat(ws,row,2,TYPES.reduce((s,t)=>s+get(ev25,2024,t,10),0),'37474F',C.WH,true,10);
  dat(ws,row,3,TYPES.reduce((s,t)=>s+get(ev25,2024,t,11),0),'37474F',C.WH,true,10);
  dat(ws,row,4,TYPES.reduce((s,t)=>s+get(ev25,2024,t,12),0),'37474F',C.WH,true,10);
  dat(ws,row,5,tQ425,'37474F',C.WH,true,10); ws.getCell(row,6).fill=fill(C.LG);
  dat(ws,row,7,TYPES.reduce((s,t)=>s+get(ev26,2025,t,10),0),'37474F',C.WH,true,10);
  dat(ws,row,8,TYPES.reduce((s,t)=>s+get(ev26,2025,t,11),0),'37474F',C.WH,true,10);
  dat(ws,row,9,TYPES.reduce((s,t)=>s+get(ev26,2025,t,12),0),'37474F',C.WH,true,10);
  dat(ws,row,10,tQ426,'37474F',C.WH,true,10); ws.getCell(row,11).fill=fill(C.LG);
  dlt(ws,row,12,tQ426-tQ425);
  dat(ws,row,13,`${((tQ426-tQ425)/tQ425*100).toFixed(1)}%`,tQ426>=tQ425?C.GBG:C.RBG,tQ426>=tQ425?C.GD:C.RD,true,10);
  applyTableBorders(ws,row,1,row,13); row++;

  // ── PART D — Key Findings ────────────────────────────────────────────────
  gapRow(ws,row,13); row++;
  sectionHdr(ws,row,'PART D — Key Findings',13); row++;

  const pipeline_findings = cm?.excel_pipeline_findings ?? {};
  const findings = [
    ['Adult Race',   C.LG,   C.DK,  C.DK,
     pipeline_findings['Adult Race'] || 'Prior-year Q4 apps: 431->409 (-22, -5.1%).  In-year Jan-May: 129->173 (+44, +34%).  Net applications essentially flat (816->814). Organizers are applying LATER, not less. No structural demand concern for races.'],
    ['Youth Race',   C.WH,   C.DK,  C.DK,
     pipeline_findings['Youth Race'] || 'Prior-year Q4 apps: 103->101 (-2).  In-year Jan-May: 69->91 (+22).  Application flow closely tracks active event count. Holding steady.'],
    ['Adult Clinic', C.RBG,  C.RD,  C.RD,
     'Prior-year Q4: identical (22 vs 22).  In-year Jan-May: identical (55 vs 55).  The -11 shortfall comes entirely from May-Dec late registrations: 2025 had 16 additional late apps; 2026 has 1 so far. Early planning demand is FLAT -- the risk is late-year spontaneous applications not materialising.'],
    ['Youth Clinic', C.GBG,  C.GD,  C.GD,
     'Prior-year Q4: up 50% (8->12).  In-year Jan-May: up 90% (10->19).  Both early and in-year pipelines are expanding. Growth is structural and front-loaded.'],
    ['Overall Pipeline', C.BBG || 'E3F2FD', '1565C0', '1565C0',
     'Total in-year apps through May 2026: 347 vs 299 in 2025 (+48, +16%).  If Jun-Dec 2026 follows 2025 pace (~64 more), final in-year total could reach ~411 vs 363 in 2025.  Year-end active event count is likely to be higher than the May snapshot suggests.'],
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
  sectionHdr(ws,row,'PART E — Highest-Probability Application Opportunities in the Current Window (May-Dec 2026)',13); row++;
  note(ws,row,'"Expected" = if 2026 follows 2025 May-Dec pace.  "Gap" = applications still likely to come in.',13); row++;

  ws.getRow(row).height=32;
  hdr(ws,row,1,'Event Type','4A148C',C.WH,10,'left');
  hdr(ws,row,2,'2025\nMay-Dec','1A237E',C.WH,9); hdr(ws,row,3,'2026 May\n(so far)','006064',C.WH,9);
  hdr(ws,row,4,'2026 Expected\nMay-Dec','006064',C.WH,9); hdr(ws,row,5,'Gap','37474F',C.WH,9);
  hdr(ws,row,6,'2026 YTD\nJan-May','006064',C.WH,9); hdr(ws,row,7,'2025 Full\nIn-Yr','1A237E',C.WH,9);
  hdr(ws,row,8,'2026 Projected\nFull In-Yr','006064',C.WH,9); hdr(ws,row,9,'vs 2025\nFull Yr','37474F',C.WH,9);
  hdr(ws,row,10,'Priority','37474F',C.WH,9);
  hdr(ws,row,11,'Why',C.DK,C.WH,9,'left',3);
  applyTableBorders(ws,row,1,row,13); row++;

  const PRIORITY = {
    'Adult Race':   ['High ***',   C.GBG, C.GD, 'Already +34% ahead in Jan-May. Jul-Sep historically adds 15-20 more apps. Keep application channel open and target prior-Aug race organizers.'],
    'Youth Race':   ['Medium **',  C.ABG||'FFF8E1', C.AM||'E65100', pipeline_findings['Youth Race'] || 'Pipeline healthy; late-year apps are small (2-3 events). Monitor.'],
    'Adult Clinic': ['Highest ***',C.RBG, C.RD, 'LARGEST GAP. Early pipeline identical to 2025 but all the 2025 advantage came from 16 late-year (May-Dec) apps. In 2026, only 1 so far. Proactive outreach May-Aug could recover 10-15 events and close most of the -12 gap.'],
    'Youth Clinic': ['Medium **',  C.GBG, C.GD, 'Already running well ahead (+90% Jan-May). Reinforce not rescue. Fast-track approvals to avoid processing delays.'],
  };
  for(const t of TYPES){
    const bg=TYPE_BG[t],fg=TYPE_FG[t],bold=t==='Adult Clinic'||t==='Youth Clinic';
    const md25=TYPES.includes(t)?[5,6,7,8,9,10,11,12].reduce((s,mo)=>s+get(ev25,2025,t,mo),0):0;
    const may26=get(ev26,2026,t,5);
    const ytd26=[1,2,3,4,5].reduce((s,mo)=>s+get(ev26,2026,t,mo),0);
    const full25=get(ev25,2025,t);
    const proj26=ytd26+md25;
    const [pr,prBg,prFg,why]=PRIORITY[t];
    ws.getRow(row).height=13;
    dat(ws,row,1,t,bg,fg,bold,10,'left');
    dat(ws,row,2,md25,bg,fg); dat(ws,row,3,may26,bg,fg);
    dat(ws,row,4,md25,bg,fg); dlt(ws,row,5,md25-may26);
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
  const ctas=[
    ['Adult Clinic -- Highest ROI', C.RBG, C.RD,
     'Target May-Aug outreach to potential clinic organizers. In 2025, 16 clinics were filed spontaneously after May. In 2026 only 1 has filed. Low effort / high impact: these organizers decide spontaneously and just need prompting.'],
    ['Adult Race -- Capture Late Registrants', C.LG, C.DK,
     'Jul-Sep historically brings 15-20 more Adult Race apps. 2026 is already +34% ahead Jan-May. Keep the application window open through September. No major intervention needed.'],
    ['Youth Clinic -- Reinforce the Growth', C.GBG, C.GD,
     'Pipeline is +90% ahead. Ensure event approval is fast-tracked so momentum is not lost to processing delays. Consider outreach to 2025 Youth Clinic organizers to encourage expansion.'],
    ['Youth Race -- Monitor Only', C.WH, C.DK,
     pipeline_findings['Youth Race'] || 'Application flow is healthy. No material outreach opportunity in the late window. Watch Aug/Sep applications to confirm trajectory holds.'],
  ];
  for(const [label,bg,fg,text] of ctas){
    ws.getRow(row).height=13;
    dat(ws,row,1,label,bg,fg,true,9.5,'left');
    ws.mergeCells(row,2,row,13);
    dat(ws,row,2,text,bg,fg,false,9.5,'left');
    applyTableBorders(ws,row,1,row,13); row++;
  }
};
