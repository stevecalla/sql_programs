// Tier (analytics): the app fires a /api/event beacon on page load (page_view)
// and again after an upload. No DB needed — the request is observed client-side.
const { test, expect } = require('@playwright/test');
const { reset_steps, SINGLE_XLSX } = require('./helpers');

test.describe('race_results_transform — usage beacon', () => {
  test('fires /api/event on load and on upload', async ({ page }) => {
    reset_steps();
    const events = [];
    page.on('request', function (r) { if (r.url().indexOf('/api/event') >= 0) events.push(r.url()); });
    await page.goto('/');
    await expect.poll(function () { return events.length; }, { timeout: 8000 }).toBeGreaterThan(0);   // page_view
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect.poll(function () { return events.length; }, { timeout: 8000 }).toBeGreaterThan(1);     // file_uploaded / conversion_completed
  });
});
