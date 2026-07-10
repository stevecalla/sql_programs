'use strict';
// Smoke layer: every map view loads and renders with no build error overlay and no runtime/console errors.
// This is the automated replacement for the manual "reload and check for the red Vite overlay" loop.
const { test, expect } = require('@playwright/test');

// Capture console errors + uncaught page errors so a runtime failure fails the test.
function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mapdiv')).toBeVisible();   // payload loaded + map drawn
});

test('participation-maps loads clean', async ({ page }) => {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Opportunity', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Events' })).toBeVisible();   // bottom tabs present
});

// Plotly geo views (Flows is deck.gl/WebGL — covered separately, flakier headless).
for (const view of ['Heatmap', 'Pins', 'YoY', 'Regions', 'Opportunity']) {
  test(`view "${view}" renders without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.getByRole('button', { name: view, exact: true }).first().click();
    await expect(page.locator('.mapdiv')).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors, 'no console / runtime errors').toEqual([]);
  });
}
