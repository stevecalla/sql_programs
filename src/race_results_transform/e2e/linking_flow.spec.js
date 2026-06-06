// Tier 2: "Link tables" mirrors search across the two TableViews when ON, and
// stops mirroring when OFF.
const { test, expect } = require('@playwright/test');
const { step, highlight, highlight_click, reset_steps, SINGLE_XLSX } = require('./helpers');

test.describe('race_results_transform — linked tables', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
  });

  test('Link ON: searching the converted table mirrors to the original', async ({ page }) => {
    await expect(page.locator('#linkTables')).toBeChecked();           // default ON
    const result = page.locator('#resultGrid .tv-search');
    await highlight(page, result);
    await step(page, 'Typing a search in the converted table');
    await result.fill('Reno');
    await step(page, 'Original table search box should mirror it');
    await expect(page.locator('#originalGrid .tv-search')).toHaveValue('Reno');
  });

  test('Link OFF: searching one table does NOT touch the other', async ({ page }) => {
    await highlight_click(page, page.locator('#linkTables'), 'Unchecking “Link tables”');
    await expect(page.locator('#linkTables')).not.toBeChecked();
    await step(page, 'Typing a search in the converted table');
    await page.locator('#resultGrid .tv-search').fill('Reno');
    await step(page, 'Original search box should stay empty');
    await expect(page.locator('#originalGrid .tv-search')).toHaveValue('');
  });
});
