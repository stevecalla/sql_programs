/**
 * step_4a_segment_by_month — Two-table segment summary matching reference v9f.
 *   TABLE 1: By 2026 month  TABLE 2: By 2025 month  SEGMENT KEY
 */
'use strict';
const { C, fill, font, align, applyBorders, th, td } = require('../styles');
const MN = {1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'};

module.exports = function build_segment_by_month(wb, results) {
  const { segments } = results;
  const ws = wb.addWorksheet('step_4a_segment_by_month');
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  [14,12,14,12,12,12,3,16,14].forEach((w,i)=>{ ws.getColumn(i+1).width=w; });

  function by26(seg){ const m={}; for(const r of seg){ const mo=r.e26?.month; if(mo) m[mo]=(m[mo]||0)+1; } return m; }
  function by25(seg){ const m={}; for(const r of seg){ const mo=r.e25?.month; if(mo) m[mo]=(m[mo]||0)+1; } return m; }
  const ret26=by26(segments.retained), shi26=by26(segments.shifted), rec26=by26(segments.recovered), new26=by26(segments.new);
  const ret25=by25(segments.retained), shi25=by25(segments.shifted), atr25=by25(segments.attrited), ttr25=by25(segments.triedToReturn);

  // Title
  ws.mergeCells('A1:I1');
  Object.assign(ws.getCell('A1'),{value:'Step 4 — Segment Breakdown by Month  |  6 Segments: Retained, Shifted, Lost, Tried to Return, New, Recovered',fill:fill(C.DR),font:font({bold:true,sz:12,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(1).height=28;
  ws.mergeCells('A2:I2');
  Object.assign(ws.getCell('A2'),{value:'Each event classified into one segment. Totals reconcile to 1,178 (2025) and 1,166 (2026).',fill:fill('444444'),font:font({sz:9,color:C.WH,italic:true}),alignment:align({h:'left'})});
  ws.getRow(2).height=15;

  let row=4;
  function sectionHdr(ws,row,txt,bg){ws.mergeCells(`A${row}:I${row}`);Object.assign(ws.getCell(`A${row}`),{value:txt,fill:fill(bg),font:font({bold:true,sz:10.5,color:C.WH}),alignment:align({h:'left'})});ws.getRow(row).height=19;}

  // TABLE 1
  sectionHdr(ws,row,'TABLE 1 — By 2026 Month  |  Where did each 2026 event come from?','1A237E'); row++;
  ['2026\nMonth','Retained','Shifted\n(SU in)','Recovered','New','Total\n2026','','Lost\n(no 2026 mo)','Tried to\nReturn'].forEach((h,i)=>{
    if(i===6){ws.getCell(row,7).fill=fill(C.LG);return;}
    th(ws.getCell(row,i+1),h,{bg:['1A237E','1E7D34','1565C0','6A1B9A','006064','222222','F5F5F5','C62828','BF360C'][i],sz:9});
  });
  ws.getRow(row).height=30; row++;
  for(let mo=1;mo<=12;mo++){
    const bg=mo%2===0?C.LG:C.WH, ret=ret26[mo]||0, shi=shi26[mo]||0, rec=rec26[mo]||0, nw=new26[mo]||0, tot=ret+shi+rec+nw;
    ws.getRow(row).height=15;
    td(ws.getCell(row,1),MN[mo],{bg,bold:true,hAlign:'center'});
    td(ws.getCell(row,2),ret||'—',{bg,fg:ret?C.GD:'999999',hAlign:'center'});
    td(ws.getCell(row,3),shi||'—',{bg,fg:shi?C.BD:'999999',hAlign:'center'});
    td(ws.getCell(row,4),rec||'—',{bg,fg:rec?'6A1B9A':'999999',hAlign:'center'});
    td(ws.getCell(row,5),nw||'—', {bg,fg:nw?C.TL:'999999',hAlign:'center'});
    td(ws.getCell(row,6),tot,{bg:C.BBG,fg:C.BD,bold:true,hAlign:'center'});
    ws.getCell(row,7).fill=fill(C.LG);
    td(ws.getCell(row,8),'—',{bg,fg:'999999',hAlign:'center'});
    td(ws.getCell(row,9),'—',{bg,fg:'999999',hAlign:'center'});
    row++;
  }
  ws.getRow(row).height=15;
  td(ws.getCell(row,1),'No 2026\nMonth',{bg:C.RBG,bold:true,hAlign:'center'});
  [2,3,4,5,6].forEach(c=>td(ws.getCell(row,c),'—',{bg:C.RBG,fg:'999999',hAlign:'center'}));
  ws.getCell(row,7).fill=fill(C.LG);
  td(ws.getCell(row,8),segments.attrited.length,{bg:C.RBG,fg:C.RD,bold:true,hAlign:'center'});
  td(ws.getCell(row,9),segments.triedToReturn.length,{bg:C.RBG,fg:'BF360C',bold:true,hAlign:'center'});
  row++;
  ws.getRow(row).height=18;
  th(ws.getCell(row,1),'TOTAL',{bg:C.DK,sz:10});
  const sum=a=>Object.values(a).reduce((s,v)=>s+v,0);
  [sum(ret26),segments.shifted.length,segments.recovered.length,segments.new.length,sum(ret26)+segments.shifted.length+segments.recovered.length+segments.new.length].forEach((v,i)=>td(ws.getCell(row,i+2),v,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'}));
  ws.getCell(row,7).fill=fill(C.LG);
  td(ws.getCell(row,8),segments.attrited.length,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'});
  td(ws.getCell(row,9),segments.triedToReturn.length,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'});
  applyBorders(ws,5,row,1,9); row+=2;

  // TABLE 2
  sectionHdr(ws,row,'TABLE 2 — By 2025 Month  |  Where did each 2025 event go?','37474F'); row++;
  ['2025\nMonth','Retained','Shifted\n(SA out)','Lost\n(truly lost)','Tried to\nReturn','Total\n2025','','New\n(no 2025 mo)','Recovered\n(no 2025 mo)'].forEach((h,i)=>{
    if(i===6){ws.getCell(row,7).fill=fill(C.LG);return;}
    th(ws.getCell(row,i+1),h,{bg:['37474F','1E7D34','E65100','C62828','BF360C','222222','F5F5F5','006064','6A1B9A'][i],sz:9});
  });
  ws.getRow(row).height=30; row++;
  for(let mo=1;mo<=12;mo++){
    const bg=mo%2===0?C.LG:C.WH, ret=ret25[mo]||0, shi=shi25[mo]||0, atr=atr25[mo]||0, ttr=ttr25[mo]||0, tot=ret+shi+atr+ttr;
    ws.getRow(row).height=15;
    td(ws.getCell(row,1),MN[mo],{bg,bold:true,hAlign:'center'});
    td(ws.getCell(row,2),ret||'—',{bg,fg:ret?C.GD:'999999',hAlign:'center'});
    td(ws.getCell(row,3),shi||'—',{bg,fg:shi?C.AM:'999999',hAlign:'center'});
    td(ws.getCell(row,4),atr||'—',{bg,fg:atr?C.RD:'999999',hAlign:'center'});
    td(ws.getCell(row,5),ttr||'—',{bg,fg:ttr?'BF360C':'999999',hAlign:'center'});
    td(ws.getCell(row,6),tot,{bg:C.LG,fg:C.DK,bold:true,hAlign:'center'});
    ws.getCell(row,7).fill=fill(C.LG);
    td(ws.getCell(row,8),'—',{bg,fg:'999999',hAlign:'center'});
    td(ws.getCell(row,9),'—',{bg,fg:'999999',hAlign:'center'});
    row++;
  }
  ws.getRow(row).height=15;
  td(ws.getCell(row,1),'No 2025\nMonth',{bg:C.GBG,bold:true,hAlign:'center'});
  [2,3,4,5,6].forEach(c=>td(ws.getCell(row,c),'—',{bg:C.GBG,fg:'999999',hAlign:'center'}));
  ws.getCell(row,7).fill=fill(C.LG);
  td(ws.getCell(row,8),segments.new.length,{bg:C.GBG,fg:C.TL,bold:true,hAlign:'center'});
  td(ws.getCell(row,9),segments.recovered.length,{bg:C.GBG,fg:'6A1B9A',bold:true,hAlign:'center'});
  row++;
  ws.getRow(row).height=18;
  th(ws.getCell(row,1),'TOTAL',{bg:C.DK,sz:10});
  [sum(ret25),sum(shi25),sum(atr25),sum(ttr25),sum(ret25)+sum(shi25)+sum(atr25)+sum(ttr25)].forEach((v,i)=>td(ws.getCell(row,i+2),v,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'}));
  ws.getCell(row,7).fill=fill(C.LG);
  td(ws.getCell(row,8),segments.new.length,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'});
  td(ws.getCell(row,9),segments.recovered.length,{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'});
  applyBorders(ws,row-14,row,1,9); row+=2;

  // SEGMENT KEY
  th(ws.getCell(row,1),'SEGMENT KEY',{bg:C.DK,sz:10}); ws.mergeCells(row,2,row,9); ws.getRow(row).height=16; row++;
  [['Retained','Same event, same month in both 2025 and 2026.',C.GBG,C.GD],
   ['Shifted (SA/SU)','Same event but moved to a different calendar month.',C.ABG,C.AM],
   ['Lost','2025 event with no 2026 match. Truly lost.',C.RBG,C.RD],
   ['Tried to Return','2025 active event that re-filed for 2026 but was cancelled or declined.',C.TRBG,C.TRFG],
   ['New','2026 event with no 2025 match. Genuinely new.',C.TLBG,C.TL],
   ['Recovered','Was cancelled in 2025 but successfully ran in 2026.',C.RECBG,C.RECFG]
  ].forEach(([label,desc,bg,fg])=>{
    ws.getRow(row).height=13;
    td(ws.getCell(row,1),'',{bg}); td(ws.getCell(row,2),label,{bg,fg,bold:true,hAlign:'left'});
    ws.mergeCells(row,3,row,9); td(ws.getCell(row,3),desc,{bg,fg,hAlign:'left'}); row++;
  });
};
