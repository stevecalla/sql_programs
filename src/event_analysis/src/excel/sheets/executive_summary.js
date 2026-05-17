/**
 * executive_summary — self-contained briefing with Slack bullets + 4 analysis steps.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

module.exports = function build_executive_summary(wb, results, cm = null) {
  const { segSummary, organicByType, organicMonthly, calImpact, c25, c26, monthly } = results;
  const YA = results?.years?.year_a ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.year_b ?? new Date().getFullYear();
  const ws = wb.addWorksheet('executive_summary');
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  [3,20,14,12,12,12,12,14,14,14,14,14,14,14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const n25total = results.y25active.length;
  const n26total = results.y26active.length;

  function H(row, text, bg, sz = 11, h = 24) {
    ws.mergeCells(`A${row}:N${row}`);
    Object.assign(ws.getCell(`A${row}`), {
      value: text, font: font({ bold: true, sz, color: C.WH }),
      fill:      fill(bg), alignment: align({ h: 'left' }),
    });
    ws.getRow(row).height = h;
  }
  function N(row, text, bg = C.WH, fg = '333333', h = 22) {
    fillRow(ws, row, bg); ws.getRow(row).height = h;
    ws.getCell(row, 1).fill = fill(bg);
    ws.mergeCells(`B${row}:N${row}`);
    Object.assign(ws.getCell(row, 2), {
      value: text, font: font({ sz: 9, color: fg }),
      fill:      fill(bg), alignment: align({ h: 'left', wrap: true }),
    });
  }
  function TC(row, col, text, bg, span = 1, fg = C.WH, sz = 8) {
    if (span > 1) ws.mergeCells(`${cl(col)}${row}:${cl(col+span-1)}${row}`);
    Object.assign(ws.getCell(row, col), {
      value: text, font: font({ bold: true, sz, color: fg }),
      fill:      fill(bg), alignment: align({ h: 'center', wrap: true }),
    });
  }
  function gap(row, h = 6) { ws.getRow(row).height = h; fillRow(ws, row, C.WH); }

  H(1, `Sanctioned Events ${YA} vs ${YB} — Executive Summary  |  6-Segment Classification`, C.DR, 12, 30);
  H(2, 'Steps follow the order the analysis was built: count → type shifts → calendar → organic → event-level', '444444', 9, 18);
  gap(3, 6);

  // Slack summary
  H(4, '  📋  Slack Summary — 4 bullets', C.SLACK, 10, 20);
  const ar25 = Object.values(c25).reduce((s,m)=>s+(m['Adult Race']??0),0);
  const ar26 = Object.values(c26).reduce((s,m)=>s+(m['Adult Race']??0),0);
  const yr25 = Object.values(c25).reduce((s,m)=>s+(m['Youth Race']??0),0);
  const yr26 = Object.values(c26).reduce((s,m)=>s+(m['Youth Race']??0),0);
  const ac25 = Object.values(c25).reduce((s,m)=>s+(m['Adult Clinic']??0),0);
  const ac26 = Object.values(c26).reduce((s,m)=>s+(m['Adult Clinic']??0),0);
  const yc25 = Object.values(c25).reduce((s,m)=>s+(m['Youth Clinic']??0),0);
  const yc26 = Object.values(c26).reduce((s,m)=>s+(m['Youth Clinic']??0),0);
  const acOrgPct = (organicByType['Adult Clinic'].orgTotal / ac25 * 100).toFixed(1);
  const ycOrgPct = (organicByType['Youth Clinic'].orgTotal / yc25 * 100).toFixed(1);
  const junOrg   = organicMonthly.find(o=>o.month===6)?.orgTotal.toFixed(1);
  // Worst and best months (by net delta) for use in narrative bullets.
  const _M_arr = Object.entries(monthly ?? {}).map(([mo, d]) => ({ m: Number(mo), label: MN[Number(mo)], ...d }));
  const _worst2 = [..._M_arr].sort((a, b) => (a.netDelta ?? 0) - (b.netDelta ?? 0)).slice(0, 2);
  const _best2  = [..._M_arr].sort((a, b) => (b.netDelta ?? 0) - (a.netDelta ?? 0)).slice(0, 2);
  // Find the top decliner and grower types from organicByType.
  const _obt = Object.entries(organicByType ?? {}).map(([t, v]) => ({ type: t, ...v }));
  const _lag = [..._obt].sort((a, b) => (a.orgTotal ?? 0) - (b.orgTotal ?? 0))[0];
  const _lead = [..._obt].sort((a, b) => (b.orgTotal ?? 0) - (a.orgTotal ?? 0))[0];
  const _fmt = n => n > 0 ? `+${n}` : `${n}`;
  const slacks = cm?.excel_slack_bullets ?? [
    `${n26total} events in ${YB} vs ${n25total} in ${YA} (${_fmt(n26total-n25total)}, ${((n26total-n25total)/n25total*100).toFixed(1)}%). ${_lag?.type} is the structural decliner (organic ${(_lag?.orgTotal/(_lag?.tot25||1)*100).toFixed(1)}%); ${_lead?.type} the only organic growth story (+${(_lead?.orgTotal/(_lead?.tot25||1)*100).toFixed(1)}%).`,
    `Worst months by net change: ${_worst2.map(w => `${w.label} ${_fmt(w.netDelta)}`).join(', ')}. Best months: ${_best2.map(b => `${b.label} ${_fmt(b.netDelta)}`).join(', ')}.`,
    `Of ${n25total} ${YA} active events: ${segSummary['Lost']} truly did not return; ${segSummary['Tried to Return']} tried to return but were cancelled in ${YB} — actionable. ${segSummary['Recovered']} recovered from ${YA} cancellations.`,
    `${segSummary['New']} genuinely brand-new events joined ${YB}. See step_3_organic_performance and step_4_event_detail for the full picture.`,
  ];
  for (let i = 0; i < slacks.length; i++) {
    const row = 5 + i;
    ws.getRow(row).height = 30; fillRow(ws, row, 'E8F8F0');
    ws.getCell(row, 1).fill = fill('E8F8F0');
    ws.getCell(row, 2).value = '•';
    ws.getCell(row, 2).font  = font({ bold: true, sz: 11, color: C.SLACK });
    ws.getCell(row, 2).fill  = fill('E8F8F0');
    ws.getCell(row, 2).alignment = align({ h: 'center', v: 'top' });
    ws.mergeCells(`C${row}:N${row}`);
    Object.assign(ws.getCell(row, 3), { value: slacks[i], font: font({ sz: 9, color: '111111' }), fill: fill('E8F8F0'), alignment: align({ h: 'left', wrap: true }) });
  }
  applyBorders(ws, 4, 8, 1, 14); gap(9, 8);

  // Step 0
  H(10, `  STEP 0 — Total Event Count  |  ${n26total} vs ${n25total}  (${n26total-n25total > 0 ? '+' : ''}${n26total-n25total}, ${((n26total-n25total)/n25total*100).toFixed(1)}%)`, C.DK, 11, 22);
  N(11, cm?.slide_2_narrative || 'Adult Clinic accounts for the full net decline. Races roughly flat. Youth Clinic the bright spot. See step_1_event_type_by_month tab.', C.LG, '333333', 20);
  fillRow(ws, 12, C.DK); ws.getRow(12).height = 20;
  TC(12,1,'',C.DK); TC(12,2,'Type',C.DK); TC(12,3,String(YA),C.DK); TC(12,4,String(YB),C.DK); TC(12,5,'Δ',C.DK); TC(12,6,'Δ %',C.DK);
  ws.mergeCells('G12:H12');
  TC(12,9,'Key read',C.DK,6,C.WH,8);  // TC merges I12:N12 itself via span=6
  for (const [ri,[typ,n25,n26,bg,fg,obs]] of [
    ['Adult Race',ar25,ar26,C.GBG,C.GD,(cm?.excel_type_reads?.['Adult Race'] || 'Flat. Organic +0.2%. Race product stable.')],
    ['Youth Race',yr25,yr26,C.LG,'555555',(cm?.excel_type_reads?.['Youth Race'] || 'Mild. Organic −1.2%. Monitor.')],
    ['Adult Clinic',ac25,ac26,C.MRDBG,C.RD,(cm?.excel_type_reads?.['Adult Clinic'] || 'Full decline. Organic −10.3%. Key concern.')],
    ['Youth Clinic',yc25,yc26,C.MGBG,C.GD,(cm?.excel_type_reads?.['Youth Clinic'] || 'Only growth. Organic +19.4%.')],
    ['TOTAL',n25total,n26total,C.MG,C.DK,'Net decline; Adult Clinic the driver.'],
  ].entries()) {
    const row = 13 + ri;
    ws.getRow(row).height = 18; fillRow(ws, row, bg); ws.getCell(row,1).fill=fill(C.DK);
    td(ws.getCell(row,2),typ,{bg,fg,bold:typ==='TOTAL',hAlign:'left'});
    td(ws.getCell(row,3),n25,{bg,fg:'444444',fmt:'#,##0'}); td(ws.getCell(row,4),n26,{bg,fg,bold:typ==='TOTAL',fmt:'#,##0'});
    dv(ws.getCell(row,5),n26-n25,bg); dv(ws.getCell(row,6),(n26-n25)/n25,bg,{fmt:'+0.0%;-0.0%;"—"'});
    ws.mergeCells(`G${row}:H${row}`); ws.mergeCells(`I${row}:N${row}`);
    td(ws.getCell(row,9),obs,{bg,fg:'333333',hAlign:'left',bold:typ==='TOTAL'});
  }
  applyBorders(ws,12,17,1,14); gap(18,8);

  // Steps 1-4 condensed
  function stepTable(startRow, headerText, headerBg, narrativeBg, narrativeFg, narrative, tableHdrs, rows, obsCol) {
    H(startRow, headerText, headerBg, 11, 22);
    N(startRow+1, narrative, narrativeBg, narrativeFg, 20);
    fillRow(ws, startRow+2, headerBg); ws.getRow(startRow+2).height=20;
    tableHdrs.forEach(([txt,span,bg], i) => {
      const col = tableHdrs.slice(0,i).reduce((s,[,sp])=>s+sp,1);
      TC(startRow+2, col, txt, bg || headerBg, span);
    });
    for (let ri=0; ri<rows.length; ri++) {
      const row = startRow+3+ri; ws.getRow(row).height=18;
      rows[ri](ws, row);
    }
    applyBorders(ws, startRow+2, startRow+2+rows.length, 1, 14);
    return startRow+2+rows.length+2;
  }

  // Step 1 rows — pick the 2 worst + 2 best months by netDelta, plus an Annual
  // row from typeAnnual. All numbers computed from results, no hardcoded values.
  const _step1_months = (() => {
    const arr = Object.entries(monthly ?? {}).map(([mo, d]) => ({ m: Number(mo), label: MN[Number(mo)], ...d }));
    const worst = [...arr].sort((a, b) => (a.netDelta ?? 0) - (b.netDelta ?? 0)).slice(0, 2);
    const best  = [...arr].sort((a, b) => (b.netDelta ?? 0) - (a.netDelta ?? 0)).slice(0, 2);
    const seen = new Set();
    return [...worst, ...best]
      .filter(p => { if (seen.has(p.m)) return false; seen.add(p.m); return true; })
      .sort((a, b) => a.m - b.m);
  })();
  const _typeAnnual = results.typeAnnual ?? {};
  const _ar_d = _typeAnnual['Adult Race']?.actDelta ?? 0;
  const _yr_d = _typeAnnual['Youth Race']?.actDelta ?? 0;
  const _ac_d = _typeAnnual['Adult Clinic']?.actDelta ?? 0;
  const _yc_d = _typeAnnual['Youth Clinic']?.actDelta ?? 0;
  // Find the principal decliner / grower from the four type deltas.
  const _type_movers = [
    { type: 'Adult Race',   delta: _ar_d },
    { type: 'Youth Race',   delta: _yr_d },
    { type: 'Adult Clinic', delta: _ac_d },
    { type: 'Youth Clinic', delta: _yc_d },
  ];
  const top_decliner = [..._type_movers].sort((a, b) => a.delta - b.delta).find(d => d.delta < 0) ?? null;
  const top_grower   = [..._type_movers].sort((a, b) => b.delta - a.delta).find(d => d.delta > 0) ?? null;
  const _step1_make = (m) => {
    const ar = (c26[m.m]?.['Adult Race'] ?? 0) - (c25[m.m]?.['Adult Race'] ?? 0);
    const yr = (c26[m.m]?.['Youth Race'] ?? 0) - (c25[m.m]?.['Youth Race'] ?? 0);
    const ac = (c26[m.m]?.['Adult Clinic'] ?? 0) - (c25[m.m]?.['Adult Clinic'] ?? 0);
    const yc = (c26[m.m]?.['Youth Clinic'] ?? 0) - (c25[m.m]?.['Youth Clinic'] ?? 0);
    const tot = ar + yr + ac + yc;
    const decline = tot < 0;
    const bg = decline ? C.MRDBG : C.MGBG, fg = decline ? C.RD : C.GD;
    // Auto-generate an observation that names which types contributed most.
    const parts = [
      { t: 'Adult Race', v: ar }, { t: 'Youth Race', v: yr },
      { t: 'Adult Clinic', v: ac }, { t: 'Youth Clinic', v: yc },
    ].filter(p => p.v !== 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const obs = parts.length
      ? `${parts.slice(0, 2).map(p => `${p.t} ${p.v >= 0 ? '+' : ''}${p.v}`).join(', ')}${parts.length > 2 ? ', other types small' : ''}.`
      : 'No movement by type.';
    return [m.label, ar, yr, ac, yc, tot, bg, fg, obs];
  };
  const s1data = [
    ..._step1_months.map(_step1_make),
    ['Annual', _ar_d, _yr_d, _ac_d, _yc_d, _ar_d + _yr_d + _ac_d + _yc_d, C.MG, C.DK,
     `${top_decliner ? top_decliner.type + ' the principal mover' : 'Mixed type-level changes'}${top_grower ? '; ' + top_grower.type + ' is the growth story' : ''}.`],
  ];

  let nextRow = 19;
  // Auto-narrative for Step 1: name worst and best months from data.
  const _w_lbl = _step1_months.filter(m => (m.netDelta ?? 0) < 0).slice(0, 2).map(m => m.label);
  const _b_lbl = _step1_months.filter(m => (m.netDelta ?? 0) > 0).slice(0, 2).map(m => m.label);
  const _step1_narr =
    cm?.excel_step1_narrative
    ?? `Worst months: ${_w_lbl.join(' & ') || 'none'}. Best months: ${_b_lbl.join(' & ') || 'none'}. See step_1_event_type_by_month for the full table.`;
  nextRow = stepTable(nextRow,
    '  STEP 1 — Event Type Changes by Month  |  raw YoY Δ per type', '1565C0', C.BBG, '0D1B5E',
    _step1_narr,
    [['',1],['Month',1],['Adult Race Δ',1],['Youth Race Δ',1],['Adult Clinic Δ',1],['Youth Clinic Δ',1],['Total Δ',1],['',2],['',1],['Observation',5]],
    s1data.map(([mon,ar,yr,ac,yc,tot,bg,fg,obs]) => (ws2, row) => {
      fillRow(ws2, row, bg); ws2.getCell(row,1).fill=fill('1565C0');
      td(ws2.getCell(row,2),mon,{bg,fg,bold:mon==='Annual',hAlign:'left'});
      [ar,yr,ac,yc,tot].forEach((v,i)=>dv(ws2.getCell(row,3+i),v,bg,{bold:mon==='Annual'}));
      ws2.getCell(row,8).fill=fill(bg); ws2.getCell(row,9).fill=fill(bg);
      ws2.mergeCells(`H${row}:I${row}`); ws2.mergeCells(`J${row}:N${row}`);
      td(ws2.getCell(row,10),obs,{bg,fg:'333333',hAlign:'left',bold:mon==='Annual'});
    }),
  );

  // Step 2 rows — pick months with notable calendar effect (|cal| > 2) plus
  // the 2 worst organic months. All values computed from results.calImpact.
  const _step2_picks = (() => {
    const arr = (calImpact ?? []).filter(ci => ci && ci.month >= 1 && ci.month <= 12);
    const big_cal = arr.filter(ci => Math.abs(ci.calTotal ?? 0) > 2)
      .sort((a, b) => Math.abs(b.calTotal) - Math.abs(a.calTotal)).slice(0, 2);
    const worst_org = [...arr].sort((a, b) => (a.orgTotal ?? 0) - (b.orgTotal ?? 0)).slice(0, 2);
    const seen = new Set();
    return [...big_cal, ...worst_org]
      .filter(ci => { if (seen.has(ci.month)) return false; seen.add(ci.month); return true; })
      .sort((a, b) => a.month - b.month);
  })();
  const _wknd_label = (ci) => {
    if (!ci.dw || ci.dw === 0) return 'None';
    const parts = [];
    if (ci.ds) parts.push(`${ci.ds > 0 ? '+' : ''}${ci.ds} Sat`);
    if (ci.du) parts.push(`${ci.du > 0 ? '+' : ''}${ci.du} Sun`);
    return parts.join(', ') || `${ci.dw > 0 ? '+' : ''}${ci.dw} day${Math.abs(ci.dw) === 1 ? '' : 's'}`;
  };
  const s2data = _step2_picks.map(ci => {
    const cal = ci.calTotal ?? 0, act = ci.actDelta ?? 0, org = ci.orgTotal ?? 0;
    const decline = org < 0;
    const bg = decline ? C.MRDBG : C.MGBG, fg = decline ? C.RD : C.GD;
    let obs;
    if (Math.abs(cal) < 0.5) {
      obs = `Zero calendar effect. Full ${act >= 0 ? '+' : ''}${act} is organic.`;
    } else if (Math.sign(act) !== Math.sign(org) && Math.abs(cal) > 5) {
      obs = `Calendar ${cal > 0 ? 'gave' : 'cost'} ${Math.abs(Math.round(cal))} expected. Actual ${act >= 0 ? '+' : ''}${act} → organic ${org >= 0 ? '+' : ''}${org.toFixed(1)}.`;
    } else {
      obs = `Cal ${cal >= 0 ? '+' : ''}${cal.toFixed(1)} → actual ${act >= 0 ? '+' : ''}${act} → organic ${org >= 0 ? '+' : ''}${org.toFixed(1)}.`;
    }
    return [MN[ci.month], _wknd_label(ci), cal, act, org, bg, fg, obs];
  });
  // Dynamic Step 2 narrative.
  const _zero_cover_worst = _step2_picks.filter(ci => Math.abs(ci.calTotal ?? 0) < 0.5 && (ci.orgTotal ?? 0) < -5)
    .map(ci => MN[ci.month]);
  const _misleading = _step2_picks
    .filter(ci => Math.abs(ci.calTotal ?? 0) > 5 && Math.sign(ci.actDelta ?? 0) !== Math.sign(ci.orgTotal ?? 0))
    .map(ci => MN[ci.month]);
  const _step2_narr = cm?.excel_step2_narrative
    ?? (`${_zero_cover_worst.length ? _zero_cover_worst.join('/') + ' had zero weekend-day changes — declines are organic. ' : ''}${_misleading.length ? _misleading.join('/') + ' most distorted by calendar shifts. ' : ''}See step_2_calendar_impact.`);
  nextRow = stepTable(nextRow,
    '  STEP 2 — Calendar Impact by Type  |  weekend-day count shifts vs expected', '006064', C.TLBG, '003333',
    _step2_narr,
    [['',1],['Month',1],['Δ Wknd',1],['Cal Expected',1],['Actual Δ',1],['Organic Δ',1],['',3],['',1],['Interpretation',5]],
    s2data.map(([mon,wch,cal,act,org,bg,fg,obs]) => (ws2, row) => {
      fillRow(ws2, row, bg); ws2.getCell(row,1).fill=fill('006064');
      td(ws2.getCell(row,2),mon,{bg,fg,bold:org<-5,hAlign:'left'});
      td(ws2.getCell(row,3),wch,{bg:wch!=='None'?C.TLBG:bg,fg:wch!=='None'?C.TL:fg,hAlign:'center',sz:8,italic:true});
      dv(ws2.getCell(row,4),Math.round(cal*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:false});
      dv(ws2.getCell(row,5),act,bg); dv(ws2.getCell(row,6),Math.round(org*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:true});
      ws2.mergeCells(`G${row}:I${row}`); [7,8,9].forEach(c=>ws2.getCell(row,c).fill=fill(bg));
      ws2.mergeCells(`J${row}:N${row}`);
      td(ws2.getCell(row,10),obs,{bg,fg:'333333',hAlign:'left'});
    }),
  );

  // Step 3 rows — pick 5 most extreme organic months (by |orgTotal|).
  const _step3_months = (() => {
    const arr = (calImpact ?? []).filter(ci => ci && ci.month >= 1 && ci.month <= 12);
    return [...arr]
      .sort((a, b) => Math.abs(b.orgTotal ?? 0) - Math.abs(a.orgTotal ?? 0))
      .slice(0, 5)
      .sort((a, b) => a.month - b.month);
  })();
  const s3mdata = _step3_months.map(ci => {
    const cal = ci.calTotal ?? 0, raw = ci.actDelta ?? 0, org = ci.orgTotal ?? 0;
    const decline = org < 0;
    const bg = decline ? C.MRDBG : C.MGBG, fg = decline ? C.RD : C.GD;
    return [MN[ci.month], raw, cal, org, bg, fg];
  });
  // Step 3 type rows — computed from organicByType.
  const _obt_map = results.organicByType ?? {};
  const _type_row = (t) => {
    const v = _obt_map[t] ?? {};
    const org = v.orgTotal ?? 0;
    const pct = v.tot25 ? (org / v.tot25) : 0;
    let bg, fg, read;
    if (pct > 0.10)        { bg = C.MGBG; fg = C.GD; read = `Strong growth ${(pct*100).toFixed(1)}%`; }
    else if (pct > 0.02)   { bg = C.GBG;  fg = C.GD; read = `Solid gain +${(pct*100).toFixed(1)}%`; }
    else if (pct > -0.02)  { bg = C.LG;   fg = '555555'; read = `Flat ${pct >= 0 ? '+' : ''}${(pct*100).toFixed(1)}%`; }
    else if (pct > -0.08)  { bg = C.LG;   fg = '555555'; read = `Mild softness ${(pct*100).toFixed(1)}%`; }
    else                    { bg = C.MRDBG; fg = C.RD; read = `Contraction ${(pct*100).toFixed(1)}%`; }
    return [t, org, pct, bg, fg, read];
  };
  const s3tdata = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'].map(_type_row);
  // Dynamic Step 3 narrative.
  const _best_org = _step3_months.filter(ci => (ci.orgTotal ?? 0) > 5)
    .sort((a, b) => (b.orgTotal ?? 0) - (a.orgTotal ?? 0))[0];
  const _worst_org_m = _step3_months.filter(ci => (ci.orgTotal ?? 0) < -5)
    .sort((a, b) => (a.orgTotal ?? 0) - (b.orgTotal ?? 0))[0];
  const _mislead_org = _step3_months.filter(ci => Math.abs(ci.calTotal ?? 0) > 5
    && Math.sign(ci.actDelta ?? 0) !== Math.sign(ci.orgTotal ?? 0))[0];
  const _step3_narr_parts = [];
  if (_best_org)    _step3_narr_parts.push(`${MN[_best_org.month]} strongest organic (${(_best_org.orgTotal).toFixed(1)})${(_best_org.calTotal ?? 0) < -5 ? ' despite headwind' : ''}`);
  if (_mislead_org) _step3_narr_parts.push(`${MN[_mislead_org.month]} most misleading (${(_mislead_org.actDelta) >= 0 ? '+' : ''}${_mislead_org.actDelta} raw, ${(_mislead_org.orgTotal).toFixed(1)} organic)`);
  if (_worst_org_m) _step3_narr_parts.push(`${MN[_worst_org_m.month]} weakest organic (${(_worst_org_m.orgTotal).toFixed(1)})`);
  const _step3_narr = cm?.excel_step3_narrative
    ?? (_step3_narr_parts.join('. ') + (_step3_narr_parts.length ? '. ' : '') + 'See step_3_organic_performance.');
  nextRow = stepTable(nextRow,
    '  STEP 3 — Organic Performance  |  true signal after removing calendar noise', '4A148C', C.PBG, '4A148C',
    _step3_narr,
    [['',1],['Month',1],['Raw Δ',1],['Cal Effect',1],['Organic Δ',1],['Type',3],['',1],['Org Δ',1],['Org %',1],['',1],['Read',3]],
    s3mdata.map(([mon,raw,cal,org,bg,fg], ri) => (ws2, row) => {
      fillRow(ws2, row, bg); ws2.getCell(row,1).fill=fill('4A148C');
      td(ws2.getCell(row,2),mon,{bg,fg,bold:true,hAlign:'left'});
      dv(ws2.getCell(row,3),raw,bg); dv(ws2.getCell(row,4),Math.round(cal*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:false});
      dv(ws2.getCell(row,5),Math.round(org*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:true});
      if(ri<s3tdata.length){
        ws2.mergeCells(`F${row}:H${row}`);
        const[t,torg,tpct,tbg,tfg,tread]=s3tdata[ri];
        td(ws2.getCell(row,6),t,{bg:tbg,fg:tfg,bold:true,hAlign:'left'});
        dv(ws2.getCell(row,9),torg,tbg,{fmt:'+0.0;-0.0;"—"'}); dv(ws2.getCell(row,10),tpct,tbg,{fmt:'+0.0%;-0.0%;"—"'});
        ws2.mergeCells(`K${row}:N${row}`);
        td(ws2.getCell(row,11),tread,{bg:tbg,fg:'333333',hAlign:'left',sz:8});
      } else {
        ws2.mergeCells(`F${row}:N${row}`); ws2.getCell(row,6).fill=fill(bg);
      }
    }),
  );

  // Step 4
  H(nextRow, '  STEP 4 — Event-Level Disposition  |  6 segments', '37474F', 11, 22);
  const s4narr = `${segSummary.Retained} retained, ${segSummary.Shifted} shifted months, ${segSummary['Tried to Return']} tried to return (cancelled ${YB} — actionable!), ${segSummary.Lost} truly gone. ${segSummary.Recovered} recovered from ${YA} cancellations, ${segSummary.New} genuinely new. See step_4_event_detail & step_4_cancelled_cross_match tabs.`;
  N(nextRow+1, s4narr, C.MG, '222222', 28); ws.getRow(nextRow+1).height=32;

  // 6 stat boxes
  const boxes=[
    ['Retained',   segSummary.Retained,   `${Math.round(segSummary.Retained/n25total*100)}% of ${YA}`,C.GBG,C.GD],
    ['Shifted',    segSummary.Shifted,    `${Math.round(segSummary.Shifted/n25total*100)}% of ${YA}`,C.ABG,C.AM],
    ['Tried to Return',segSummary['Tried to Return'],`${Math.round(segSummary['Tried to Return']/n25total*100)}% of ${YA}`,C.TRBG,C.TRFG],
    ['Lost (true)',segSummary.Lost,`${Math.round(segSummary.Lost/n25total*100)}% of ${YA}`,C.MRDBG,C.RD],
    ['Recovered',  segSummary.Recovered,  `${Math.round(segSummary.Recovered/n26total*100)}% of ${YB}`,C.RECBG,C.RECFG],
    ['New (true)', segSummary.New,         `${Math.round(segSummary.New/n26total*100)}% of ${YB}`,C.BBG,C.BD],
  ];
  const colMap=[[2,5],[6,9],[10,13],[2,5],[6,9],[10,13]];
  const rowMap=[[nextRow+2,nextRow+3,nextRow+4],[nextRow+2,nextRow+3,nextRow+4],[nextRow+2,nextRow+3,nextRow+4],
                [nextRow+5,nextRow+6,nextRow+7],[nextRow+5,nextRow+6,nextRow+7],[nextRow+5,nextRow+6,nextRow+7]];
  for(let bi=0;bi<boxes.length;bi++){
    const[seg,n,pct,bg,fg]=boxes[bi];
    const[cs,ce]=colMap[bi]; const[r1,r2,r3]=rowMap[bi];
    ws.getRow(r1).height=22; ws.getRow(r2).height=22; ws.getRow(r3).height=14;
    for(const[row,val,fsz,bold,italic] of [[r1,seg,9,true,false],[r2,n,16,true,false],[r3,pct,8,false,true]]){
      ws.mergeCells(`${cl(cs)}${row}:${cl(ce)}${row}`);
      Object.assign(ws.getCell(row,cs),{value:val,font:font({sz:fsz,bold,italic,color:fg}),fill:fill(bg),alignment:align({h:'center',wrap:true})});
    }
    applyBorders(ws,r1,r3,cs,ce);
  }
  [nextRow+2,nextRow+3,nextRow+4,nextRow+5,nextRow+6,nextRow+7].forEach(r=>{
    ws.getCell(r,1).fill=fill(C.MG); ws.getCell(r,14).fill=fill(C.MG);
  });
  gap(nextRow+8, 5);

  // Step 4 detail table
  const s4start = nextRow+9;
  fillRow(ws, s4start, '37474F'); ws.getRow(s4start).height=26;
  ['',`Month`,String(YA),'Retained','SA out','Tried Ret','Lost','SU in','Recovered','New',String(YB),'Repl Rate','Key finding',''].forEach((h,i)=>{
    const c=ws.getCell(s4start,i+1); c.value=h; c.font=font({bold:true,sz:8,color:C.WH}); c.fill=fill('37474F'); c.alignment=align({h:'center',wrap:true});
  });
  ws.mergeCells(`M${s4start}:N${s4start}`); ws.getCell(s4start,13).value='Key finding'; ws.getCell(s4start,13).alignment=align({h:'left'});
  // Pick the 4 most-impactful months: 2 worst and 2 best by net delta. Each
  // row pulls counts from results.monthly[m] so this updates every build.
  const _detail_picks = (() => {
    const arr = Object.entries(monthly ?? {}).map(([mo, d]) => ({ m: Number(mo), ...d }));
    const worst = [...arr].sort((a, b) => (a.netDelta ?? 0) - (b.netDelta ?? 0)).slice(0, 2);
    const best  = [...arr].sort((a, b) => (b.netDelta ?? 0) - (a.netDelta ?? 0)).slice(0, 2);
    // Avoid double-counting if a month qualifies as both extremes.
    const seen = new Set();
    return [...worst, ...best]
      .filter(p => { if (seen.has(p.m)) return false; seen.add(p.m); return true; })
      .sort((a, b) => a.m - b.m);
  })();
  const detail4 = _detail_picks.map(p => {
    const repl = (p.attr ?? 0) > 0 ? (((p.new ?? 0) + (p.rec ?? 0)) / p.attr) : 0;
    const decline = (p.netDelta ?? 0) < 0;
    const bg = decline ? C.MRDBG : C.MGBG;
    const fg = decline ? C.RD    : C.GD;
    const obs = decline
      ? `${p.attr ?? 0} truly lost, ${p.new ?? 0} new${(p.rec ?? 0) ? ` + ${p.rec} recovered` : ''}${(p.ttr ?? 0) ? `. ${p.ttr} tried to return.` : '.'}`
      : `${p.attr ?? 0} truly lost, ${p.new ?? 0} new${(p.rec ?? 0) ? ` + ${p.rec} recovered` : ''}. Net ${(p.netDelta ?? 0) >= 0 ? '+' : ''}${p.netDelta ?? 0}.`;
    return [MN[p.m], p.n25 ?? 0, p.ret ?? 0, p.sa ?? 0, p.ttr ?? 0,
            p.attr ?? 0, p.su ?? 0, p.rec ?? 0, p.new ?? 0, p.n26 ?? 0,
            repl, bg, fg, obs];
  });
  for(let ri=0;ri<detail4.length;ri++){
    const[mon,n25t,ret,sa,ttr,attr,su,rec,newE,n26t,repl,bg,fg,obs]=detail4[ri];
    const row=s4start+1+ri; ws.getRow(row).height=22; fillRow(ws,row,bg); ws.getCell(row,1).fill=fill('37474F');
    td(ws.getCell(row,2),mon,{bg,fg,bold:true,hAlign:'left'});
    [n25t,ret,sa,ttr,attr,su,rec,newE,n26t].forEach((v,i)=>{
      const fg2=i===3?C.TRFG:i===6?C.RECFG:'444444';
      td(ws.getCell(row,3+i),v,{bg,fg:fg2,fmt:'#,##0',bold:i===3||i===6?v>0:false});
    });
    const rc=ws.getCell(row,12); rc.value=repl; rc.numFmt='0%';
    rc.font=font({bold:true,sz:9,color:repl>=0.9?C.GD:repl>=0.7?C.AM:C.RD});
    rc.fill=fill(bg); rc.alignment=align({h:'right'});
    ws.mergeCells(`M${row}:N${row}`); td(ws.getCell(row,13),obs,{bg,fg:'333333',hAlign:'left'});
  }
  applyBorders(ws,s4start,s4start+detail4.length,1,14); gap(s4start+detail4.length+1, 8);

  H(s4start+detail4.length+2, `  Methodology: Excl. Cancelled/Declined/Deleted. Fuzzy Jaccard ≥0.55 + date-proximity weighting. Cross-match: ${YA} active vs ${YB} excluded = Tried to Return; ${YA} excluded vs ${YB} active = Recovered.`, '607D8B', 8, 20);

  return ws;
};

function cl(n) { let s=''; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s; }
