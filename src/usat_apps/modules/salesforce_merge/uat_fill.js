'use strict';
// UAT AUTO-FILL — runs the Tier-1 UAT scenario suite (tests/uat_scenarios.test.js), captures each
// tab's pass/fail plus its individual assertion lines, stamps an "Automated verification" block onto
// a COPY of the UAT workbook, and writes it to the shared data folder
// (<data root>/usat_salesforce_merge_uat/).  Two files each run: a timestamped copy + an
// "..._autofilled_latest.xlsx" that always points at the newest.
//
// SCOPE: only the code-controlled outcomes are auto-verified (the calls the tool makes + the decisions
// it takes). The Salesforce-native steps in each tab — does the loser actually land in the Recycle Bin,
// does undelete restore the original id, etc. — still require the MANUAL UAT pass. Every stamped block
// says so, so nobody mistakes a green Tier-1 run for a full sign-off.
//
//   node src/usat_apps/modules/salesforce_merge/uat_fill.js            # -> data folder
//   node src/usat_apps/modules/salesforce_merge/uat_fill.js --out-dir /tmp/x --template path.xlsx
//
// The human template stays pristine: this reads a repo copy (uat/USAT_Salesforce_Merge_UAT_template.xlsx)
// and never writes the tester's Pass/Fail or Actual columns — the automated verdict goes in its own block.

const path = require('path');
const fs = require('fs');
const { run } = require('node:test');
const ExcelJS = require('exceljs');
const { determineOSPath } = require('../../../../utilities/determineOSPath');

const TEST_FILE = path.join(__dirname, 'tests', 'uat_scenarios.test.js');
const DEFAULT_TEMPLATE = path.join(__dirname, 'uat', 'USAT_Salesforce_Merge_UAT_template.xlsx');
const OUT_SUBDIR = 'usat_salesforce_merge_uat';
const GREEN = 'FF107C41';
const RED = 'FFC0392B';
const BAND = 'FFF2F2F2';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function pretty() { return new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour12: false }) + ' MT'; }
function tab_key(name) { const m = /Test\s+(\d+)/i.exec(name || ''); return m ? 'Test ' + m[1] : null; }

// Run the scenario suite (fakes only — no SF/DB/browser) and collect per-tab results by walking the
// TestsStream: a describe-block completion arrives at nesting 0; its inner test() assertions arrive
// first at nesting 1, so we buffer them and attach on the suite's close event.
async function run_suite() {
  const suites = {}; let pending = [];
  const stream = run({ files: [TEST_FILE] });
  for await (const evt of stream) {
    if (evt.type !== 'test:pass' && evt.type !== 'test:fail') continue;
    const ok = evt.type === 'test:pass';
    const name = evt.data && evt.data.name;
    const nesting = (evt.data && evt.data.nesting) || 0;
    const key = tab_key(name);
    if (nesting === 0 && key) { suites[key] = { name, pass: ok, children: pending }; pending = []; }
    else if (nesting >= 1) { pending.push({ name, pass: ok }); }
  }
  return suites;
}

function put(ws, row, label, value, opts = {}) {
  const a = ws.getCell('A' + row); const b = ws.getCell('B' + row);
  a.value = label; b.value = value;
  a.font = { name: 'Arial', size: 10, bold: !!opts.boldLabel };
  b.font = { name: 'Arial', size: 10, bold: !!opts.boldValue, color: opts.color ? { argb: opts.color } : undefined };
  b.alignment = { wrapText: true, vertical: 'top' };
  if (opts.band) { a.fill = b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }; }
  return row + 1;
}

function stamp_tab(ws, res, when) {
  let r = ws.rowCount + 2;
  const title = ws.getCell('A' + r);
  title.value = 'AUTOMATED VERIFICATION — Tier 1 backend scenario tests (auto-generated, do not edit)';
  title.font = { name: 'Arial', size: 10, bold: true };
  ws.mergeCells(`A${r}:E${r}`);
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  r += 1;
  const passed = res ? res.children.filter((c) => c.pass).length : 0;
  const total = res ? res.children.length : 0;
  const ok = res && res.pass;
  r = put(ws, r, 'Result', ok ? 'PASS' : (res ? 'FAIL' : 'NOT RUN'), { boldLabel: true, boldValue: true, color: ok ? GREEN : RED });
  r = put(ws, r, 'Assertions', `${passed} of ${total} passed`, { boldLabel: true });
  r = put(ws, r, 'Run at', when, { boldLabel: true });
  r = put(ws, r, 'Scope', 'Verifies the code-controlled outcomes for this scenario (the calls the tool makes and the decisions it takes). The Salesforce-native steps above — Recycle Bin, original-id restore, child re-parenting — still require the manual checks.', { boldLabel: true });
  if (res && res.children.length) {
    r += 0;
    const h = ws.getCell('A' + r); h.value = 'Checks'; h.font = { name: 'Arial', size: 10, bold: true }; r += 1;
    for (const c of res.children) {
      const a = ws.getCell('A' + r); const b = ws.getCell('B' + r);
      a.value = c.pass ? 'PASS' : 'FAIL';
      a.font = { name: 'Arial', size: 10, bold: true, color: { argb: c.pass ? GREEN : RED } };
      b.value = c.name; b.font = { name: 'Arial', size: 10 }; b.alignment = { wrapText: true, vertical: 'top' };
      ws.mergeCells(`B${r}:E${r}`);
      r += 1;
    }
  }
}

async function main() {
  const template = arg('--template', DEFAULT_TEMPLATE);
  if (!fs.existsSync(template)) { console.error('Template not found: ' + template); process.exit(1); }

  const suites = await run_suite();
  // Every tab that HAS an automated scenario suite (auto-detected — no longer hardcoded to Test 1-8), so
  // adding a new `describe('Test N …')` block automatically extends the auto-fill coverage. Tabs without a
  // suite are stamped "NOT RUN" (manual-only) and don't count against the pass tally.
  const keys = Object.keys(suites);
  const when = pretty();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(template);
  let tabsPass = 0;
  for (const ws of wb.worksheets) {
    const key = tab_key(ws.name);
    if (!key) continue;
    const res = suites[key];
    if (res && res.pass) tabsPass += 1;
    stamp_tab(ws, res, when);
  }

  // Overview summary line
  const ov = wb.getWorksheet('Overview');
  if (ov) {
    let r = ov.rowCount + 2;
    const t = ov.getCell('A' + r);
    t.value = 'AUTOMATED (Tier 1) LAST RUN';
    t.font = { name: 'Arial', size: 11, bold: true }; r += 1;
    const allGreen = tabsPass === keys.length;
    r = put(ov, r, 'Result', `${tabsPass} of ${keys.length} scenario tabs passed`, { boldLabel: true, boldValue: true, color: allGreen ? GREEN : RED });
    r = put(ov, r, 'Run at', when, { boldLabel: true });
    put(ov, r, 'Note', 'Tier 1 auto-checks the code-controlled outcomes only. The Salesforce-native steps in each tab still require the manual UAT pass.', { boldLabel: true });
  }

  const outDir = path.join(arg('--out-dir', '') || path.join(await determineOSPath(), OUT_SUBDIR));
  fs.mkdirSync(outDir, { recursive: true });
  const tsFile = path.join(outDir, `USAT_Salesforce_Merge_UAT_autofilled_${stamp()}.xlsx`);
  const latest = path.join(outDir, 'USAT_Salesforce_Merge_UAT_autofilled_latest.xlsx');
  await wb.xlsx.writeFile(tsFile);
  await wb.xlsx.writeFile(latest);

  console.log(`UAT auto-fill: ${tabsPass}/${keys.length} tabs passed`);
  console.log('  ' + tsFile);
  console.log('  ' + latest);
  if (tabsPass !== keys.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run_suite, tab_key };
