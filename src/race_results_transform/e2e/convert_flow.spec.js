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
    // a dropzone upload must hide the OTHER intake cards (Salesforce + folder), like the queue flow does
    await expect(page.locator('#sfCard')).toBeHidden();
    await expect(page.locator('#folderCard')).toBeHidden();

    await step(page, 'Opening the Download picker and choosing Excel');
    await highlight_click(page, page.locator('#downloadBtn'), 'Opening the Download picker');
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await pop.locator('[data-fmt="xlsx"]').click();   // CSV is the default; pick Excel to validate the 12 columns
    await highlight(page, pop.locator('#dlGo'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pop.locator('#dlGo').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const wb = await read_xlsx(await download.path());
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);
    await step(page, 'Downloaded file has the 12-column template ✓');
  });

  test('download defaults to CSV and names the file from the builder', async ({ page }) => {
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await step(page, 'Opening the Download picker');
    await page.locator('#downloadBtn').click();
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('[data-fmt="csv"]')).toHaveClass(/active/);   // CSV is the default format
    await step(page, 'Filling the filename builder');
    await pop.locator('#dlId').fill('351003');
    await pop.locator('#dlType').selectOption('Duathlon');
    await pop.locator('#dlDist').selectOption('Intermediate');
    await pop.locator('#dlName').fill('Clash Mississippi');
    // live preview proves the CSV default + the "Sanction ID - Type - Distance - Race Name.csv" name
    await expect(pop.locator('.dl-preview')).toHaveText('351003 - Duathlon - Intermediate - Clash Mississippi.csv');
    await step(page, 'CSV default + builder filename preview ✓');
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

    await step(page, 'Opening the split picker and choosing Excel');
    await highlight(page, panel.locator('.split-go'));
    await panel.locator('.split-go').click();
    const sp = page.locator('#splitPop');
    await expect(sp).toBeVisible();
    await expect(sp.locator('.split-fname').first()).toBeVisible();   // each group has its own editable filename
    await sp.locator('[data-fmt="xlsx"]').click();   // validate the 12 columns from the .xlsx output
    const downloads = [];
    page.on('download', function (d) { downloads.push(d); });
    await step(page, 'Download — one file per group');
    await sp.locator('#splitGo2').click();
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

    await page.locator('#downloadBtn').click();
    await step(page, 'Opening the Download picker');
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await pop.locator('[data-fmt="xlsx"]').click();        // combined .xlsx so we can read the merged worksheet
    await pop.locator('[data-mode="combined"]').click();   // Combined mode hides the per-sheet rows (shorter popover)
    await step(page, 'Downloading the combined workbook');
    await pop.locator('#dlGo').scrollIntoViewIfNeeded();   // keep the button actionable on WebKit
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
