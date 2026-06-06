// Tier 3: phone-sized run (Pixel 5 ~ 393px). Guards against horizontal overflow
// and confirms the core convert flow still works on a small screen.
const { test, expect } = require('@playwright/test');
const { step, reset_steps, SINGLE_XLSX } = require('./helpers');

test.describe('race_results_transform — mobile', () => {
  test.beforeEach(async ({ page }) => { reset_steps(); await page.goto('/'); });

  test('upload screen fits the viewport (no horizontal overflow)', async ({ page }) => {
    await expect(page.locator('#uploadCard')).toBeVisible();
    await expect(page.locator('#themeToggle')).toBeVisible();
    await step(page, 'Checking the page does not scroll sideways');
    const overflow = await page.evaluate(function () {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(2);   // a couple px of rounding is fine
  });

  test('convert works on a phone-sized screen', async ({ page }) => {
    await step(page, 'Uploading on mobile');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();
    await step(page, 'Compare card still has no sideways scroll');
    const overflow = await page.evaluate(function () {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
