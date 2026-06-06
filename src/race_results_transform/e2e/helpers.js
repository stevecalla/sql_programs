// Shared E2E helpers: narrated step banners (with a numbered counter + optional
// pause), click highlighting, and fixture builders/readers. Imported by every
// *.spec.js so the watch/step/highlight behaviour is identical across files.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');

// Headed when --headed OR the Inspector (--debug / PWDEBUG) is on.
const HEADED = process.argv.includes('--headed') || !!process.env.PWDEBUG;
const STEP_PAUSE = 4000;                        // ms held on each step in --headed auto runs

const FIXTURE_DIR = path.join(__dirname, '..', 'examples', 'sample');
const SINGLE_XLSX = path.join(FIXTURE_DIR, 'sample_race_results_FAKE.xlsx');
const SINGLE_CSV = path.join(FIXTURE_DIR, 'sample_race_results_FAKE.csv');

let step_n = 0;
function reset_steps() { step_n = 0; }           // call in beforeEach so each test counts from 1

// Banner describing the current step (bright amber, navy text, red underline),
// narrated in the terminal, then a pause: manual under --debug, timed under --headed.
async function step(page, label) {
  step_n += 1;
  const tag = 'Step ' + step_n + ' — ' + label;
  try {
    await page.evaluate(function (text) {
      var el = document.getElementById('e2e_banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'e2e_banner';
        el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;' +
          'background:#ffd400;color:#15284e;font:800 20px/1.5 system-ui,Arial,sans-serif;' +
          'padding:14px 18px;text-align:center;letter-spacing:.3px;' +
          'border-bottom:5px solid #e4002b;box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:none';
        document.documentElement.appendChild(el);
      }
      el.textContent = '▶  ' + text;
    }, tag);
  } catch (e) { /* page not navigated yet — ignore */ }
  console.log('   • ' + tag);
  if (process.env.PWDEBUG) { await page.pause(); }
  else if (HEADED) { await page.waitForTimeout(STEP_PAUSE); }
}

// Draw a red border on the element we're about to interact with.
async function highlight(page, locator) {
  try {
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate(function (el) {
      el.style.outline = '4px solid #e4002b';
      el.style.outlineOffset = '2px';
      el.style.boxShadow = '0 0 0 6px rgba(228,0,43,.45)';
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
  } catch (e) { /* detached/non-DOM — skip */ }
  if (HEADED && !process.env.PWDEBUG) await page.waitForTimeout(900);
}

async function highlight_click(page, locator, label) {
  await step(page, label);
  await highlight(page, locator);
  await locator.click();
}

async function make_multisheet() {
  const head = ['Usat', 'Last Name', 'First Name', 'Sex', 'Birthdate', 'Email',
    'Address', 'City', 'State', 'Zip', 'Category', 'Finish'];
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Youth 11-15');
  a.addRow(head); a.addRow(['100', 'Smith', 'John', 'M', '2012-01-02', 'j@example.com', '1 A St', 'Reno', 'NV', '89501', 'Elite', '01:00:00']);
  const b = wb.addWorksheet('Youth 7-10');
  b.addRow(head); b.addRow(['101', 'Doe', 'Jane', 'F', '2016-05-05', 'd@example.com', '2 B St', 'Reno', 'NV', '89502', 'Open', '01:30:00']);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rrt-e2e-')), 'two_sheets_FAKE.xlsx');
  await wb.xlsx.writeFile(out);
  return out;
}

async function read_xlsx(file_path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file_path);
  return wb;
}

module.exports = {
  HEADED, STEP_PAUSE, FIXTURE_DIR, SINGLE_XLSX, SINGLE_CSV,
  reset_steps, step, highlight, highlight_click, make_multisheet, read_xlsx
};
