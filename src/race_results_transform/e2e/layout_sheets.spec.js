// Tier 2: compare-layout switch (side/stacked/tabs), per-sheet tab data, and
// drag-and-drop upload (vs the file picker).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { step, highlight, highlight_click, reset_steps, SINGLE_XLSX, SINGLE_CSV, make_multisheet } = require('./helpers');

test.describe('race_results_transform — layout, sheets, drag-drop', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
  });

  test('layout switch toggles side / stacked / tabs', async ({ page }) => {
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    const grid = page.locator('#compareGrid');
    await highlight_click(page, page.locator('#layoutSwitch button[data-layout="stacked"]'), 'Switching to Stacked layout');
    await expect(grid).toHaveClass(/layout-stacked/);
    await highlight_click(page, page.locator('#layoutSwitch button[data-layout="tabs"]'), 'Switching to Tabs layout');
    await expect(grid).toHaveClass(/layout-tabs/);
    await expect(page.locator('#tabbar')).toBeVisible();
    await highlight_click(page, page.locator('#layoutSwitch button[data-layout="side"]'), 'Back to Side-by-side');
    await expect(grid).toHaveClass(/layout-side/);
  });

  test('sheet tabs switch between each sheet’s converted data', async ({ page }) => {
    const multi = await make_multisheet();
    await page.setInputFiles('#fileInput', multi);
    await expect(page.locator('#sheetBar')).toBeVisible();
    const body = page.locator('#resultGrid table tbody');
    await step(page, 'Sheet 1 should show Smith (member 100)');
    await expect(body).toContainText('Smith');
    await highlight_click(page, page.locator('#sheetBar .sheet-tab').nth(1), 'Switching to sheet 2');
    await step(page, 'Sheet 2 should show Doe (member 101)');
    await expect(body).toContainText('Doe');
    await highlight_click(page, page.locator('#sheetBar .sheet-tab').nth(0), 'Switching back to sheet 1');
    await step(page, 'Sheet 1 data should be intact');
    await expect(body).toContainText('Smith');
  });

  test('drag-and-drop a file onto the upload card converts it', async ({ page }) => {
    const bytes = Array.from(fs.readFileSync(SINGLE_CSV));
    await step(page, 'Dropping a .CSV onto the upload card (no file picker)');
    const dt = await page.evaluateHandle(function (args) {
      var dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(args.bytes)], 'dropped_FAKE.csv', { type: 'text/csv' }));
      return dt;
    }, { bytes: bytes });
    await page.dispatchEvent('#uploadCard', 'drop', { dataTransfer: dt });
    await step(page, 'It should convert just like an upload');
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();
  });
});
