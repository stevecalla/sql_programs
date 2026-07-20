const ExcelJS=require('exceljs'); const fs=require('fs'); const path=require('path');
const base='/sessions/amazing-stoic-curie/mnt/outputs'; const hist=[{queue_id:1,source_key:'a|b',survivor_account:'001x',survivor_name:'Tester',loser_count:1,result:'restored',reason:'undeleted 1'}];
const fill=(wb)=>{const prev=wb.getWorksheet('Restores'); if(prev) wb.removeWorksheet(prev.id); const rs=wb.addWorksheet('Restores'); rs.addRow(['Restore run','rrun-x']); rs.addRow(['Status','done']); rs.addRow(['Sets',1]); rs.addRow(['Elapsed','00:00:05']); rs.addRow([]); rs.addRow(['#','queue_id','source_key','survivor','survivor_name','losers','result','reason']); hist.forEach((h,i)=>rs.addRow([i+1,h.queue_id,h.source_key,h.survivor_account,h.survivor_name,h.loser_count,h.result,h.reason]));};
(async()=>{
  // make a fake existing merge report
  const rep=path.join(base,'_probe_merge_report.xlsx'); const w0=new ExcelJS.Workbook(); w0.addWorksheet('Merges').addRow(['x']); await w0.xlsx.writeFile(rep);
  // append
  const w=new ExcelJS.Workbook(); await w.xlsx.readFile(rep); fill(w); await w.xlsx.writeFile(rep);
  const chk=new ExcelJS.Workbook(); await chk.xlsx.readFile(rep); console.log('appended tabs:', chk.worksheets.map(s=>s.name));
  // standalone fallback
  const sf=path.join(base,'_probe_restore_standalone.xlsx'); const w2=new ExcelJS.Workbook(); fill(w2); await w2.xlsx.writeFile(sf);
  const chk2=new ExcelJS.Workbook(); await chk2.xlsx.readFile(sf); console.log('standalone tabs:', chk2.worksheets.map(s=>s.name), 'rows:', chk2.getWorksheet('Restores').rowCount);
  fs.unlinkSync(rep); fs.unlinkSync(sf); console.log('WRITE LOGIC OK');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
