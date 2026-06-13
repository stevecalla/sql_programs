// From Folder tab — OPT-IN browser test. Drives the webkitdirectory fallback input directly
// (the native showDirectoryPicker can't be scripted), then runs the picked files through the SAME
// Files queue as the Salesforce flow: pick → list (in #sfTable) → load → open → convert → download.
// (The standalone "Convert files from a folder" card was removed; this is now the only folder intake.)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./helpers');
const { step, reset_steps, SINGLE_XLSX, SINGLE_CSV } = h;

// A webkitdirectory input needs a DIRECTORY path (not individual files), so build a temp folder
// holding exactly two spreadsheets and hand setInputFiles that directory.
function make_folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrt-folder-'));
  fs.copyFileSync(SINGLE_XLSX, path.join(dir, 'race_a_FAKE.xlsx'));
  fs.copyFileSync(SINGLE_CSV, path.join(dir, 'race_b_FAKE.csv'));
  return dir;
}

test.describe('race_results_transform — From Folder tab', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    // open the From Folder tab inside the "Get Race Results" card
    await page.locator('#sfSourceSeg [data-src="folder"]').click();
    await expect(page.locator('#sfFolderChoose')).toBeVisible();
  });

  test('pick files → list → load → Files queue → open → convert', async ({ page }) => {
    await step(page, 'Choosing a folder (webkitdirectory fallback)');
    // setInputFiles with a directory drives the same code path as a real folder pick
    await page.setInputFiles('#sfFolderInput', make_folder());
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await expect(page.locator('#sfCount')).toContainText('2');
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(2);
    // the chosen-folder label reuses the original "Folder:" styling
    await expect(page.locator('#sfFolderPickName')).toContainText('Folder:');

    await step(page, 'Loading the selected files into the queue');
    await page.locator('#sfFolderLoadBtn').click();
    await expect(page.locator('#filesTab')).toBeVisible();
    await expect(page.locator('.sf-q-trow')).toHaveCount(2);
    // folder queue shows File name + Modified (no Program/Owner)
    await expect(page.locator('.sf-q-table thead')).toContainText('Modified');
    await expect(page.locator('.sf-q-table thead')).not.toContainText('Program');

    await step(page, 'Opening a queued file converts it');
    const row = page.locator('.sf-q-trow').first();
    await row.click();
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(2);   // Uploaded + Converted

    await step(page, 'Downloading the converted file → Downloaded');
    await page.locator('#downloadBtn').click();
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await pop.locator('[data-fmt="xlsx"]').click();   // Excel download is proven across browsers
    await Promise.all([page.waitForEvent('download'), pop.locator('#dlGo').click()]);
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(3);
    await step(page, 'Folder file: Uploaded → Converted → Downloaded ✓');
  });

  test('search filters the folder list, Max caps selection, and Reset clears it', async ({ page }) => {
    await page.setInputFiles('#sfFolderInput', make_folder());
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await page.locator('#sfSearch').fill('.csv');
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(1);
    await page.locator('#sfSearch').fill('');
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    // Max caps the auto-selection like the SF tabs: cap of 1 → only 1 row checked
    await page.locator('#sfLimit').fill('1');
    await page.locator('#sfLimit').dispatchEvent('change');
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(1);
    await page.locator('#sfFolderReset').click();
    await expect(page.locator('#sfTableWrap')).toBeHidden();
  });
});
