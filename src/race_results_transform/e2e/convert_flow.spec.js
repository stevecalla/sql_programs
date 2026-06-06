// End-to-end smoke of the SERVED app in a real browser: load → convert → download
// → split-by-column → combine, plus the "did corruption blank the page" canaries.
// Watch/step/highlight behaviour lives in helpers.js (shared with the other specs).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');
const { step, highlight, highlight_click, make_multisheet, read_xlsx, reset_steps, SINGLE_XLSX } = h;

test.describe('race_results_transform — served app', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
    await expect(page.locator('#uploadCard')).toBeVisible();
  });

  test('page shell loads (theme toggle + footer clock — corruption canaries)', async ({ page }) => {
    await step(page, 'Checking the theme toggle rendered (init ran)');
    await expect(page.locator('#themeToggle')).not.toBeEmpty();
    await step(page, 'Checking the live footer clock shows … MTN');
    await expect(page.locator('#footerClock')).toContainText('MTN');
  });

  test('upload → convert → download a 12-column .xlsx', async ({ page }) => {
    await step(page, 'Uploading the sample race-results .xlsx');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await step(page, 'Waiting for the Compare card + converted table');
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table thead')).toContainText('Member Number');
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();

    await step(page, 'Clicking Download and capturing the .xlsx');
    await highlight(page, page.locator('#downloadBtn'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#downloadBtn').click()
    ]);
    const wb = await read_xlsx(await download.path());
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);
    await step(page, 'Downloaded file has the 12-column template ✓');
  });

  test('split-by-column downloads one file per group', async ({ page }) => {
    await step(page, 'Uploading the sample file');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await highlight_click(page, page.locator('#compareSeg button[data-view="mapping"]'), 'Opening the Mapping tab');
    const panel = page.locator('.rrt-split');
    await expect(panel).toBeVisible();
    const converted = panel.locator('[data-basis="converted"]');
    if (await converted.count()) { await highlight_click(page, converted.first(), 'Grouping by the converted Category value'); }

    const downloads = [];
    page.on('download', function (d) { downloads.push(d); });
    await step(page, 'Clicking Download — one .xlsx per group');
    await highlight(page, panel.locator('.split-go'));
    await panel.locator('.split-go').click();
    await expect.poll(function () { return downloads.length; }, { timeout: 10000 }).toBeGreaterThan(0);
    const wb = await read_xlsx(await downloads[0].path());
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);
    await step(page, 'Got ' + downloads.length + ' per-group file(s) ✓');
  });

  test('multi-sheet: sheet bar appears and Combined merges into one file', async ({ page }) => {
    const multi = await make_multisheet();
    await step(page, 'Uploading a 2-sheet workbook');
    await page.setInputFiles('#fileInput', multi);
    await expect(page.locator('#compareCard')).toBeVisible();
    await step(page, 'Checking the multi-sheet tab bar appeared');
    await expect(page.locator('#sheetBar')).toBeVisible();

    await highlight_click(page, page.locator('#downloadBtn'), 'Opening the Download picker');
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await highlight_click(page, pop.locator('[data-mode="combined"]'), 'Switching to the Combined option');
    await step(page, 'Downloading the combined workbook');
    await highlight(page, pop.locator('#dlGo'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pop.locator('#dlGo').click()
    ]);
    const wb = await read_xlsx(await download.path());
    expect(wb.worksheets.length).toBe(1);
    expect(wb.worksheets[0].rowCount).toBe(3);
    await step(page, 'Combined into one worksheet with both sheets’ rows ✓');
  });
});
