/**
 * executive_summary — self-contained briefing with Slack bullets + 4 analysis steps.
 */

'use strict';

const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');

const MN = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
             7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

module.exports = function build_executive_summary(wb, results, cm = null) {
  const { segSummary, organicByType, organicMonthly, calImpact, c25, c26 } = results;
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

  H(1, `Sanctioned Events 2025 vs 2026 — Executive Summary  |  6-Segment Classification`, C.DR, 12, 30);
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
  const slacks = cm?.excel_slack_bullets ?? [
    `${n26total} events in 2026 vs ${n25total} in 2025 (${n26total-n25total}, ${((n26total-n25total)/n25total*100).toFixed(1)}%). Adult Clinic accounts for the full net decline (${ac26-ac25}, organic ${acOrgPct}%); Adult Race essentially flat; Youth Race mildly soft; Youth Clinic the only growth story (+${ycOrgPct}% organic).`,
    `Summer declines concentrated in races: July −16 (both types −8), August −18 (Youth Race −9 worst). Calendar provides zero alibi — July and August had identical weekend-day counts both years. May is most misleading: +3 raw but −13 organic (extra Sunday handed it +16 expected it failed to fill).`,
    `Of ${n25total} 2025 active events: ${segSummary['Lost']} truly did not return; ${segSummary['Tried to Return']} tried to return but were cancelled in 2026 — actionable (specific race directors to follow up). ${segSummary['Recovered']} recovered from 2025 cancellations. July and August had the worst replacement rates.`,
    `June is the standout: lost a Sunday (calendar headwind −23) but delivered organic +${junOrg} growth — strongest month. ${segSummary['New']} genuinely brand-new events joined 2026. October gain (+11) largely explained by calendar and shifted events; organic only +4.`,
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
  TC(12,1,'',C.DK); TC(12,2,'Type',C.DK); TC(12,3,'2025',C.DK); TC(12,4,'2026',C.DK); TC(12,5,'Δ',C.DK); TC(12,6,'Δ %',C.DK);
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

  // Step 1 rows
  const s1data=[
    ['July',  -8,-8,  0,  0,-16,C.MRDBG,C.RD,'Both race types −8. Clinics flat. Broad organic decline.'],
    ['August',-6,-9,  0, -3,-18,C.MRDBG,C.RD,'Youth Race worst (−9). Youth Clinic fell. Deeper.'],
    ['June',  +1,+8, -3, +3,+10,C.MGBG, C.GD,'Youth Race best (+8). Youth Clinic up. Clinic drag.'],
    ['Oct',   +7,+3, +2, -1,+11,C.GBG,  C.GD,'Broad gains. Adult Clinic positive.'],
    ['Annual',-1,-4,-12, +5,-12,C.MG,   C.DK,'Races flat. Adult Clinic structural drag.'],
  ];
  let nextRow = 19;
  nextRow = stepTable(nextRow,
    '  STEP 1 — Event Type Changes by Month  |  raw YoY Δ per type', '1565C0', C.BBG, '0D1B5E',
    'Both race types decline in summer; Adult Clinic year-round; Youth Clinic growing. See step_1_event_type_by_month.',
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

  // Step 2 rows
  const s2data=[
    ['May','+1 Sun',+15.8,+3,-12.8,C.MRDBG,C.RD,'Extra Sunday gave +16 expected. Only +3 actual → −13 organic.'],
    ['June','−1 Sun',-23.2,+10,+33.2,C.MGBG,C.GD,'Lost Sunday (−23 expected). Actual +10 → organic +33.'],
    ['July','None',0,-16,-16,C.MRDBG,C.RD,'Zero calendar effect. Full −16 is organic. No alibi.'],
    ['August','None',0,-18,-18,C.MRDBG,C.RD,'Zero calendar effect. Full −18 is organic. Worst month.'],
  ];
  nextRow = stepTable(nextRow,
    '  STEP 2 — Calendar Impact by Type  |  weekend-day count shifts vs expected', '006064', C.TLBG, '003333',
    'Jul/Aug had zero weekend-day changes — full declines are organic. May/June most distorted. See step_2_calendar_impact.',
    [['',1],['Month',1],['Δ Wknd',1],['Cal Expected',1],['Actual Δ',1],['Organic Δ',1],['',3],['',1],['Interpretation',5]],
    s2data.map(([mon,wch,cal,act,org,bg,fg,obs]) => (ws2, row) => {
      fillRow(ws2, row, bg); ws2.getCell(row,1).fill=fill('006064');
      td(ws2.getCell(row,2),mon,{bg,fg,bold:'Jul'===mon||'Aug'===mon,hAlign:'left'});
      td(ws2.getCell(row,3),wch,{bg:wch!=='None'?C.TLBG:bg,fg:wch!=='None'?C.TL:fg,hAlign:'center',sz:8,italic:true});
      dv(ws2.getCell(row,4),Math.round(cal*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:false});
      dv(ws2.getCell(row,5),act,bg); dv(ws2.getCell(row,6),Math.round(org*10)/10,bg,{fmt:'+0.0;-0.0;"—"',bold:true});
      ws2.mergeCells(`G${row}:I${row}`); [7,8,9].forEach(c=>ws2.getCell(row,c).fill=fill(bg));
      ws2.mergeCells(`J${row}:N${row}`);
      td(ws2.getCell(row,10),obs,{bg,fg:'333333',hAlign:'left'});
    }),
  );

  // Step 3 rows
  const s3mdata=[
    ['June',+10,-23.2,+33.2,C.MGBG,C.GD],['March',+8,-5.4,+13.4,C.MGBG,C.GD],
    ['May',+3,+15.8,-12.8,C.MRDBG,C.RD],['July',-16,0,-16,C.MRDBG,C.RD],['August',-18,0,-18,C.MRDBG,C.RD],
  ];
  const s3tdata=[
    ['Adult Race',+1.4,0.002,C.GBG,C.GD,'Flat +0.2%'],
    ['Youth Race',-2.8,-0.012,C.LG,'555555','Mild −1.2%'],
    ['Adult Clinic',-10.0,-0.103,C.MRDBG,C.RD,'Contraction −10.3%'],
    ['Youth Clinic',+5.6,+0.193,C.MGBG,C.GD,'Growth +19.4%'],
  ];
  nextRow = stepTable(nextRow,
    '  STEP 3 — Organic Performance  |  true signal after removing calendar noise', '4A148C', C.PBG, '4A148C',
    'June strongest organic (+33 despite headwind). May most misleading (+3 raw, −13 organic). Jul/Aug zero cover. See step_3_organic_performance.',
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
  const s4narr = `${segSummary.Retained} retained, ${segSummary.Shifted} shifted months, ${segSummary['Tried to Return']} tried to return (cancelled 2026 — actionable!), ${segSummary.Lost} truly gone. ${segSummary.Recovered} recovered from 2025 cancellations, ${segSummary.New} genuinely new. See step_4_event_detail & step_4_cancelled_cross_match tabs.`;
  N(nextRow+1, s4narr, C.MG, '222222', 28); ws.getRow(nextRow+1).height=32;

  // 6 stat boxes
  const boxes=[
    ['Retained',   segSummary.Retained,   `${Math.round(segSummary.Retained/n25total*100)}% of 2025`,C.GBG,C.GD],
    ['Shifted',    segSummary.Shifted,    `${Math.round(segSummary.Shifted/n25total*100)}% of 2025`,C.ABG,C.AM],
    ['Tried to Return',segSummary['Tried to Return'],`${Math.round(segSummary['Tried to Return']/n25total*100)}% of 2025`,C.TRBG,C.TRFG],
    ['Lost (true)',segSummary.Lost,`${Math.round(segSummary.Lost/n25total*100)}% of 2025`,C.MRDBG,C.RD],
    ['Recovered',  segSummary.Recovered,  `${Math.round(segSummary.Recovered/n26total*100)}% of 2026`,C.RECBG,C.RECFG],
    ['New (true)', segSummary.New,         `${Math.round(segSummary.New/n26total*100)}% of 2026`,C.BBG,C.BD],
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
  ['','Month','2025','Retained','SA out','Tried Ret','Lost','SU in','Recovered','New','2026','Repl Rate','Key finding',''].forEach((h,i)=>{
    const c=ws.getCell(s4start,i+1); c.value=h; c.font=font({bold:true,sz:8,color:C.WH}); c.fill=fill('37474F'); c.alignment=align({h:'center',wrap:true});
  });
  ws.mergeCells(`M${s4start}:N${s4start}`); ws.getCell(s4start,13).value='Key finding'; ws.getCell(s4start,13).alignment=align({h:'left'});
  const detail4=[
    ['July',181,115,15,2,46,12,1,38,165,38/46,C.MRDBG,C.RD,'46 truly gone, 38 new (83%). 2 tried return. Youth Race worst.'],
    ['August',220,148,15,2,53,15,4,40,202,40/53,C.MRDBG,C.RD,'53 truly gone. 4 recovered. Worst absolute attrition month.'],
    ['June',209,125,26,4,49,18,10,63,219,63/49,C.MGBG,C.GD,'49 truly gone, 63 new + 10 recovered. Best acquisition. Organic +33.'],
    ['October',60,41,1,1,17,10,5,21,71,21/17,C.MGBG,C.GD,'Only 17 truly gone. 21 new + 5 recovered. Best retention.'],
  ];
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

  H(s4start+detail4.length+2, '  Methodology: Excl. Cancelled/Declined/Deleted. Fuzzy Jaccard ≥0.55 + date-proximity weighting. Cross-match: 2025 active vs 2026 excluded = Tried to Return; 2025 excluded vs 2026 active = Recovered.', '607D8B', 8, 20);

  return ws;
};

function cl(n) { let s=''; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s; }
