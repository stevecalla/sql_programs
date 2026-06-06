// The usage beacon: fires to /api/event when allowed, and is MUTED under automated
// browsers by default (so the rest of the e2e suite never pollutes the analytics
// table). Requests are intercepted + fulfilled locally (route), so this spec never
// writes to the DB. Chromium-only (route interception of sendBeacon is reliable there).
const { test, expect } = require('@playwright/test');
const { reset_steps, SINGLE_XLSX } = require('./helpers');

function capture(page, sink) {
  return page.route('**/api/event', function (route) { sink.push(route.request().url()); route.fulfill({ status: 204, body: '' }); });
}

test.describe('race_results_transform — usage beacon', () => {
  test('fires on load + upload when analytics is allowed', async ({ page }) => {
    reset_steps();
    await page.addInitScript(() => { window.METRICS_TEST_ALLOW = true; });   // opt back in under automation
    const hits = [];
    await capture(page, hits);
    await page.goto('/');
    await expect.poll(function () { return hits.length; }, { timeout: 8000 }).toBeGreaterThan(0);   // page_view
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect.poll(function () { return hits.length; }, { timeout: 8000 }).toBeGreaterThan(1);     // file_uploaded / conversion_completed
  });

  test('muted under automation by default (no beacon without opt-in)', async ({ page }) => {
    reset_steps();
    const hits = [];
    await capture(page, hits);
    await page.goto('/');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await page.waitForTimeout(1500);   // give any (unwanted) beacon time to fire
    expect(hits.length, 'automated runs must not emit analytics unless allowed').toBe(0);
  });
});
