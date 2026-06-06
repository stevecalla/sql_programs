// Tier 3: visual snapshot regression. Runs on chromium only (see config) so there
// is ONE committed baseline set. Generate/refresh baselines with:
//   npm run e2e:snap        (commits e2e/visual.spec.js-snapshots/*.png)
// The live footer clock is masked (it changes every second).
const { test, expect } = require('@playwright/test');
const { reset_steps, SINGLE_XLSX } = require('./helpers');

test.describe('race_results_transform — visual', () => {
  // Snapshot baselines are committed for win32 only (font rendering is platform-
  // specific). On other OSes, skip rather than fail — run `npm run e2e:snap` there
  // to generate + commit native baselines if you want visual coverage too.
  test.beforeEach(async ({ page }) => {
    test.skip(process.platform !== 'win32', 'visual baselines are win32-only on this repo');
    reset_steps();
    await page.goto('/');
  });

  test('upload card — light theme', async ({ page }) => {
    await expect(page.locator('#uploadCard')).toBeVisible();
    await expect(page).toHaveScreenshot('upload-light.png', { mask: [page.locator('#footerClock')], fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test('upload card — dark theme', async ({ page }) => {
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveScreenshot('upload-dark.png', { mask: [page.locator('#footerClock')], fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test('converted compare card', async ({ page }) => {
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();
    await expect(page.locator('#compareCard')).toHaveScreenshot('compare-card.png', { mask: [page.locator('#footerClock')], maxDiffPixelRatio: 0.02 });
  });
});
