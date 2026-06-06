// Tier 2: the TableView surface — search filtering, header sort, and the flag
// filter (legend "Show rows") all wired through to the rendered rows.
const { test, expect } = require('@playwright/test');
const { step, highlight, reset_steps, SINGLE_XLSX } = require('./helpers');

const ROWS = '#resultGrid table tbody tr';

test.describe('race_results_transform — table view', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator(ROWS).first()).toBeVisible();
  });

  test('search filters rows and clearing restores them', async ({ page }) => {
    const before = await page.locator(ROWS).count();
    expect(before).toBeGreaterThan(1);
    const search = page.locator('#resultGrid .tv-search');
    await highlight(page, search);
    await step(page, 'Searching for something that matches nothing');
    await search.fill('zzzzzznomatch');
    await expect(page.locator('#resultGrid .tv-empty')).toBeVisible();
    await step(page, 'Clearing the search restores every row');
    await search.fill('');
    await expect.poll(function () { return page.locator(ROWS).count(); }).toBe(before);
  });

  test('clicking a column header sorts (▲ then ▼) and enables Reset', async ({ page }) => {
    const th = page.locator('#resultGrid thead tr.tnames th[data-c]').nth(1);
    await highlight(page, th);
    await step(page, 'Clicking a column header to sort ascending');
    await th.click();
    await expect(th.locator('.ind')).toHaveText('▲');
    await expect(page.locator('#resultGrid .tv-reset')).toBeEnabled();
    await step(page, 'Clicking again flips to descending');
    await th.click();
    await expect(th.locator('.ind')).toHaveText('▼');
  });

  test('legend “Show rows” narrows the table to one highlight type', async ({ page }) => {
    const before = await page.locator(ROWS).count();
    const show = page.locator('#flagLegend .show-code').first();
    await highlight(page, show);
    await step(page, 'Clicking “Show rows” for one highlight code');
    await show.click();
    await step(page, 'Table should show fewer rows than the full set');
    await expect.poll(function () { return page.locator(ROWS).count(); }).toBeLessThan(before);
  });
});
