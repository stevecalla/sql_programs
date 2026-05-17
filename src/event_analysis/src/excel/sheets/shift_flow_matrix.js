/**
 * step_4b_shift_flow_matrix — Complete shift analysis: Part A (month×type), Part B (flow matrix), Part C (event list).
 * Matches reference v9f step_4b_shift_flow_matrix exactly (162 rows, 31 cols).
 */
'use strict';
const { C, fill, font, align, applyBorders, fillRow, th, td, dv } = require('../styles');
const TYPES=['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const MN={1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'};
function colLet(n){let s='';while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s;}

module.exports = function build_shift_flow_matrix(wb, results) {
  const YA = results?.years?.year_a ?? (new Date().getFullYear() - 1);
  const YB = results?.years?.year_b ?? new Date().getFullYear();
  const { monthly, shiftFlow, segments, c25, c26, retMt, saMt, suMt, attrMt, newMt } = results;
  const ws = wb.addWorksheet('step_4b_shift_flow_matrix');
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  ws.getColumn(1).width = 10;
  const endCol = 1 + TYPES.length * 7 + 2;  // 31

  // ── Title ──────────────────────────────────────────────────────
  ws.mergeCells(`A1:${colLet(endCol)}1`);
  Object.assign(ws.getCell('A1'),{value:'Event Shift Flow by Month & Type — Where Did Shifted Events Come From and Go?',fill:fill(C.DR),font:font({bold:true,sz:12,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(1).height=28;
  ws.mergeCells(`A2:${colLet(endCol)}2`);
  Object.assign(ws.getCell('A2'),{value:`SA=Shifted Away (left this month in ${YB}) | SU=Shifted Into (arrived in ${YB}) | Net=SU−SA | Attr=truly lost | New=genuinely new | Retained=same month both years`,fill:fill('444444'),font:font({sz:9,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(2).height=18;

  // ── PART A ─────────────────────────────────────────────────────
  ws.mergeCells(`A4:${colLet(endCol)}4`);
  Object.assign(ws.getCell('A4'),{value:`PART A — Complete Month × Type Breakdown  (${YA} → ${YB})`,fill:fill(C.DK),font:font({bold:true,sz:11,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(4).height=20;

  const TYPE_BG={'Adult Race':'1A237E','Youth Race':'37474F','Adult Clinic':'455A64','Youth Clinic':'546E7A'};
  let col=2;
  ws.getCell(5,1).fill=fill(C.DK);
  for(const t of TYPES){
    ws.mergeCells(`${colLet(col)}5:${colLet(col+6)}5`);
    th(ws.getCell(5,col),t,{bg:TYPE_BG[t],sz:9}); col+=7;
  }
  ws.mergeCells(`${colLet(col)}5:${colLet(col+1)}5`);
  th(ws.getCell(5,col),'TOTAL',{bg:C.DK,sz:9});
  ws.getRow(5).height=16;

  th(ws.getCell(6,1),'Month',{bg:C.DK,sz:9});
  col=2;
  for(const t of TYPES){
    const bg=TYPE_BG[t];
    [String(YA),'SA\n(out)','SU\n(in)','Net\nShift','Attr\n(lost)','New\n(add)',String(YB)].forEach((h,i)=>{
      th(ws.getCell(6,col+i),h,{bg,sz:9});
      ws.getColumn(col+i).width=i===0||i===6?9:8;
    });
    col+=7;
  }
  ['Net Δ','Net Shift\nSU−SA'].forEach((h,i)=>{ th(ws.getCell(6,col+i),h,{bg:C.DK,sz:9}); ws.getColumn(col+i).width=11; });
  ws.getRow(6).height=32;

  for(let ri=0;ri<12;ri++){
    const m=ri+1, row=ri+7, md=monthly[m];
    ws.getRow(row).height=18;
    const diff=md.netDelta, bg=diff>0?C.GBG:diff<0?C.RBG:C.LG;
    td(ws.getCell(row,1),MN[m],{bg,bold:true,hAlign:'center'});
    col=2;
    for(const t of TYPES){
      const n25t=c25[m]?.[t]??0, n26t=c26[m]?.[t]??0, rett=retMt[m]?.[t]??0,
            sat=saMt[m]?.[t]??0, sut=suMt[m]?.[t]??0, attrt=attrMt[m]?.[t]??0,
            newt=newMt[m]?.[t]??0, net=sut-sat;
      const tbg=ri%2===0?C.LG:C.WH;
      td(ws.getCell(row,col),n25t,{bg:tbg,fmt:'#,##0'});
      td(ws.getCell(row,col+1),sat||null,{bg:sat>0?C.ABG:tbg,fg:sat>0?C.AM:'999999',fmt:'#,##0',bold:sat>0});
      td(ws.getCell(row,col+2),sut||null,{bg:sut>0?C.BBG:tbg,fg:sut>0?C.BD:'999999',fmt:'#,##0',bold:sut>0});
      td(ws.getCell(row,col+3),net||null,{bg:net>0?C.GBG:net<0?C.RBG:tbg,fg:net>0?C.GD:net<0?C.RD:'999999',fmt:'+#,##0;-#,##0;"—"'});
      td(ws.getCell(row,col+4),attrt||null,{bg:attrt>5?C.RBG:tbg,fg:attrt>5?C.RD:'666666',fmt:'#,##0'});
      td(ws.getCell(row,col+5),newt||null,{bg:newt>5?C.GBG:tbg,fg:newt>5?C.GD:'666666',fmt:'#,##0'});
      td(ws.getCell(row,col+6),n26t,{bg:tbg,bold:true,fmt:'#,##0'});
      col+=7;
    }
    dv(ws.getCell(row,col),diff,bg,{bold:true});
    dv(ws.getCell(row,col+1),md.netShift,bg,{fmt:'+#,##0;-#,##0;"—"',bold:false});
  }
  const tr=19; fillRow(ws,tr,C.DK,1,col+1); ws.getRow(tr).height=18;
  th(ws.getCell(tr,1),'TOTAL',{bg:C.DK,sz:10});
  for(let c=2;c<=col+1;c++){
    const cell=ws.getCell(tr,c);
    cell.value={formula:`=SUM(${colLet(c)}7:${colLet(c)}18)`};
    cell.numFmt=c>=col?'+#,##0;-#,##0;"—"':'#,##0';
    cell.font=font({bold:true,sz:9,color:C.WH}); cell.fill=fill(C.DK); cell.alignment=align({h:'right'});
  }
  applyBorders(ws,5,tr,1,col+1);

  // ── PART B ─────────────────────────────────────────────────────
  const bStart=tr+2;
  ws.mergeCells(`A${bStart}:N${bStart}`);
  Object.assign(ws.getCell(`A${bStart}`),{value:`PART B — Shift Destination Matrix  (row = ${YA} origin month, col = ${YB} destination month)`,fill:fill('1A237E'),font:font({bold:true,sz:11,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(bStart).height=20;
  const bHdr=bStart+1;
  th(ws.getCell(bHdr,1),`${YA} ↓\n${YB} →`,{bg:'37474F',sz:9});
  for(let m=1;m<=12;m++){ th(ws.getCell(bHdr,m+1),MN[m],{bg:'37474F',sz:9}); ws.getColumn(m+1).width=Math.max(ws.getColumn(m+1).width||0,7); }
  th(ws.getCell(bHdr,14),'Shifted In',{bg:'37474F',sz:9}); ws.getColumn(14).width=10;
  ws.getRow(bHdr).height=26;

  for(let fm=1;fm<=12;fm++){
    const row=bHdr+fm, bgR=fm%2===0?C.LG:C.WH; let rowTotal=0;
    td(ws.getCell(row,1),MN[fm],{bg:bgR,bold:true,hAlign:'center'});
    for(let tm=1;tm<=12;tm++){
      const v=shiftFlow[fm]?.[tm]??0; rowTotal+=v;
      const c=ws.getCell(row,tm+1);
      if(v>0){c.value=v;c.font=font({bold:v>=3,sz:9,color:C.AM});c.fill=fill(C.ABG);c.alignment=align({h:'center'});}
      else{c.value='—';c.font=font({sz:9,color:'DDDDDD'});c.fill=fill(bgR);c.alignment=align({h:'center'});}
    }
    const rtCell=ws.getCell(row,14);
    rtCell.value=rowTotal||'—'; rtCell.font=font({bold:rowTotal>0,sz:9,color:rowTotal>0?C.RD:'999999'});
    rtCell.fill=fill(rowTotal>0?C.RBG:bgR); rtCell.alignment=align({h:'center'}); ws.getRow(row).height=18;
  }
  const suRow=bHdr+13; fillRow(ws,suRow,C.DK,1,14); ws.getRow(suRow).height=18;
  td(ws.getCell(suRow,1),'Shifted In',{bg:C.DK,fg:C.WH,bold:true,hAlign:'center'});
  for(let tm=1;tm<=12;tm++){
    const v=Object.values(shiftFlow).reduce((s,row)=>s+(row[tm]??0),0);
    const c=ws.getCell(suRow,tm+1);
    c.value=v||'—'; c.font=font({bold:v>0,sz:9,color:v>0?C.WH:'888888'});
    c.fill=fill(v>0?C.BD:C.DK); c.alignment=align({h:'center'});
  }
  const totalShifts=segments.shifted.length;
  Object.assign(ws.getCell(suRow,14),{value:totalShifts,font:font({bold:true,sz:9,color:C.WH}),fill:fill(C.DK),alignment:align({h:'center'})});
  applyBorders(ws,bHdr,suRow,1,14);

  // ── PART C ─────────────────────────────────────────────────────
  const cStart=suRow+2;
  ws.mergeCells(`A${cStart}:J${cStart}`);
  Object.assign(ws.getCell(`A${cStart}`),{value:`PART C — All ${totalShifts} Shifted Events Detail  (sorted by ${YA} month, then ${YB} month, then type)`,fill:fill(C.DK),font:font({bold:true,sz:11,color:C.WH}),alignment:align({h:'left'})});
  ws.getRow(cStart).height=20;
  const cHdrs=[[`${YA}\nMonth`,12],[`${YB}\nMonth`,12],['Direction\n(months)',14],['Type',14],[`${YA} Sanctioning ID`,24],[`${YA} Date`,14],[`${YA} Event Name`,46],[`${YB} Sanctioning ID`,24],[`${YB} Date`,14],[`${YB} Event Name`,46]];
  cHdrs.forEach(([h,w],i)=>{ th(ws.getCell(cStart+1,i+1),h,{bg:C.MR,sz:9}); ws.getColumn(i+1).width=Math.max(ws.getColumn(i+1).width||0,w); });
  ws.getRow(cStart+1).height=28;

  const sorted=[...segments.shifted].sort((a,b)=>{
    if(a.e25.month!==b.e25.month)return a.e25.month-b.e25.month;
    if(a.e26.month!==b.e26.month)return a.e26.month-b.e26.month;
    return a.e25.type<b.e25.type?-1:1;
  });
  for(let i=0;i<sorted.length;i++){
    const r=sorted[i], row=cStart+2+i, bg=i%2===0?C.LG:C.WH;
    const delta=r.e26.month-r.e25.month, dir=`${delta>0?'Later':'Earlier'} (${Math.abs(delta)} mo)`;
    ws.getRow(row).height=18;
    td(ws.getCell(row,1),MN[r.e25.month],{bg,bold:true,hAlign:'center'});
    td(ws.getCell(row,2),MN[r.e26.month],{bg,bold:true,hAlign:'center',fg:delta>0?C.BD:C.AM});
    Object.assign(ws.getCell(row,3),{value:dir,font:font({bold:true,sz:9,color:delta>0?C.BD:C.AM}),fill:fill(delta>0?C.BBG:C.ABG),alignment:align({h:'center'})});
    td(ws.getCell(row,4),r.e25.type,{bg,hAlign:'left',sz:9});
    td(ws.getCell(row,5),r.e25.sanctionId,{bg,hAlign:'left',sz:8});
    td(ws.getCell(row,6),r.e25.startDate?r.e25.startDate.toISOString().slice(0,10):'',{bg,hAlign:'center',sz:9});
    td(ws.getCell(row,7),r.e25.name,{bg,hAlign:'left',sz:9});
    td(ws.getCell(row,8),r.e26.sanctionId,{bg,hAlign:'left',sz:8});
    td(ws.getCell(row,9),r.e26.startDate?r.e26.startDate.toISOString().slice(0,10):'',{bg,hAlign:'center',sz:9});
    td(ws.getCell(row,10),r.e26.name,{bg,hAlign:'left',sz:9});
  }
  applyBorders(ws,cStart+1,cStart+1+sorted.length,1,10);
  ws.autoFilter={from:{row:cStart+1,column:1},to:{row:cStart+1+sorted.length,column:10}};
};
