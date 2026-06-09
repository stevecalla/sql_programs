// Local-folder intake — OPT-IN browser test. Drives the webkitdirectory fallback input directly
// (the native showDirectoryPicker can't be scripted), then runs the picked files through the SAME
// Files queue as the Salesforce flow: list → select → load → open → convert → download.
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

test.describe('race_results_transform — convert files from a folder', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await expect(page.locator('#folderCard')).toBeVisible();
  });

  test('pick files → list → load → Files queue → open → convert', async ({ page }) => {
    await step(page, 'Choosing a folder (webkitdirectory fallback)');
    // setInputFiles with a directory drives the same code path as a real folder pick
    await page.setInputFiles('#folderInput', make_folder());
    await expect(page.locator('#folderTable tbody tr')).toHaveCount(2);
    await expect(page.locator('#folderCount')).toContainText('2');
    await expect(page.locator('#folderTable tbody input.folder-pick:checked')).toHaveCount(2);

    await step(page, 'Loading the selected files into the queue');
    await page.locator('#folderLoadBtn').click();
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

  test('search filters the folder list and Reset clears it', async ({ page }) => {
    await page.setInputFiles('#folderInput', make_folder());
    await expect(page.locator('#folderTable tbody tr')).toHaveCount(2);
    await page.locator('#folderSearch').fill('.csv');
    await expect(page.locator('#folderTable tbody tr')).toHaveCount(1);
    await page.locator('#folderSearch').fill('');
    await expect(page.locator('#folderTable tbody tr')).toHaveCount(2);
    await page.locator('#folderResetBtn').click();
    await expect(page.locator('#folderTableWrap')).toBeHidden();
  });
});
