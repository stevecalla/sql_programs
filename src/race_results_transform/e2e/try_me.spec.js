// "Try me (fake data)" — the dropdown on the served app at /. OPT-IN browser test
// (part of the Playwright suite, NOT `npm test`). Verifies: the button + menu render,
// "Load sample data" loads the built-in fixture and reaches the Compare card, the
// "sample data" badge shows while viewing, the upload card (with the Try-me button)
// hides once loaded, and Start over clears the badge + restores the button.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');
const { step, reset_steps } = h;

test.describe('race_results_transform — Try me (fake data)', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
    await expect(page.locator('#uploadCard')).toBeVisible();
  });

  test('the Try-me dropdown exposes both paths', async ({ page }) => {
    await expect(page.locator('#tryMeBtn')).toBeVisible();
    await expect(page.locator('#tryMeMenu')).toBeHidden();              // collapsed by default
    await page.locator('#tryMeBtn').click();
    await expect(page.locator('#tryMeMenu')).toBeVisible();             // opens on click
    await expect(page.locator('#tryMeLoad')).toBeVisible();             // load-it-for-me
    await expect(page.locator('#tryMeGet')).toHaveAttribute('href', /\/sample\/sample_race_results_FAKE\.xlsx$/);
    await expect(page.locator('#tryMeGet')).toHaveAttribute('download', '');  // download-to-upload
  });

  test('"Load sample data" loads the fixture, shows the sample badge, hides the button', async ({ page }) => {
    await step(page, 'Opening the Try-me menu');
    await page.locator('#tryMeBtn').click();
    await step(page, 'Clicking "Load sample data"');
    await page.locator('#tryMeLoad').click();

    await step(page, 'Waiting for the Compare card from the fake data');
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');

    // sample-data indicator is visible; the upload card (with the Try-me button) is gone
    await expect(page.locator('#demoBadge')).toBeVisible();
    await expect(page.locator('#demoBadge')).toContainText('sample test data');
    await expect(page.locator('#uploadCard')).toBeHidden();
    await expect(page.locator('#tryMeBtn')).toBeHidden();

    await step(page, 'Start over clears the badge and restores the button');
    await page.locator('#clearBtn').click();
    await expect(page.locator('#demoBadge')).toBeHidden();
    await expect(page.locator('#uploadCard')).toBeVisible();
    await expect(page.locator('#tryMeBtn')).toBeVisible();
  });
});
