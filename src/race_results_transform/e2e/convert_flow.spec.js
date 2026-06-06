// End-to-end smoke of the SERVED app in a real browser: load → convert → download
// → split-by-column → combine, plus the "did corruption blank the page" canaries
// (theme toggle + footer clock). Uses exceljs (already in the repo) to (a) build a
// throwaway multi-sheet workbook and (b) verify downloaded .xlsx contents.
const { test, expect } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');

const FIXTURE_DIR = path.join(__dirname, '..', 'examples', 'sample');
const SINGLE_XLSX = path.join(FIXTURE_DIR, 'sample_race_results_FAKE.xlsx');

// Build a 2-sheet workbook in a temp dir (fake data) for the multi-sheet flows.
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

test.describe('race_results_transform — served app', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#uploadCard')).toBeVisible();
  });

  test('page shell loads (theme toggle + footer clock present — corruption canaries)', async ({ page }) => {
    await expect(page.locator('#themeToggle')).not.toBeEmpty();           // init ran
    await expect(page.locator('#footerClock')).toContainText('MTN');      // live clock ticking
  });

  test('upload → convert → download a 12-column .xlsx', async ({ page }) => {
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    const thead = page.locator('#resultGrid table thead');
    await expect(thead).toContainText('Member Number');
    await expect(thead).toContainText('Recorded Time');
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#downloadBtn').click()
    ]);
    const saved = await download.path();
    const wb = await read_xlsx(saved);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);   // 12-column template
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);                  // header + data
  });

  test('split-by-column downloads one file per group', async ({ page }) => {
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await page.locator('#compareSeg button[data-view="mapping"]').click();
    const panel = page.locator('.rrt-split');
    await expect(panel).toBeVisible();
    // group by the cleaned Category value (fewer, named groups)
    const converted = panel.locator('[data-basis="converted"]');
    if (await converted.count()) await converted.first().click();

    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await panel.locator('.split-go').click();
    await expect.poll(() => downloads.length, { timeout: 10000 }).toBeGreaterThan(0);
    const wb = await read_xlsx(await downloads[0].path());
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);
  });

  test('multi-sheet: sheet bar appears and Combined merges into one file', async ({ page }) => {
    const multi = await make_multisheet();
    await page.setInputFiles('#fileInput', multi);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#sheetBar')).toBeVisible();                 // multi-sheet detected

    await page.locator('#downloadBtn').click();
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await pop.locator('[data-mode="combined"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pop.locator('#dlGo').click()
    ]);
    const wb = await read_xlsx(await download.path());
    expect(wb.worksheets.length).toBe(1);                                  // combined = one sheet
    expect(wb.worksheets[0].rowCount).toBe(3);                             // header + 2 stacked rows
  });
});
