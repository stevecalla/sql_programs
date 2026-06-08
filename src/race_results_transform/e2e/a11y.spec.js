// Tier 3: automated accessibility scan (axe-core) of the home page and the main
// compare tabs. Gate is "no CRITICAL violations" — the strongest tier — so it
// flags real blockers without drowning in minor/moderate noise. Tighten the
// impact filter below (add 'serious') once the app is clean.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { step, reset_steps, SINGLE_XLSX } = require('./helpers');

async function scan(page, label) {
  await step(page, 'Accessibility scan — ' + label);
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(function (v) { return v.impact === 'critical'; });
  const summary = critical.map(function (v) { return v.id + ' (' + v.nodes.length + ')'; }).join(', ');
  expect(critical, 'critical a11y violations on ' + label + ': ' + summary).toEqual([]);
}

test.describe('race_results_transform — accessibility', () => {
  test('home + converted tabs have no critical a11y violations', async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await scan(page, 'home / upload');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await scan(page, 'Tables view');
    await page.locator('#compareSeg button[data-view="mapping"]').click();
    await expect(page.locator('.rrt-split')).toBeVisible();
    await scan(page, 'Mapping view');
  });

  test('Try-me dropdown (open) + sample-data badge have no critical a11y violations', async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await page.locator('#tryMeBtn').click();             // open the dropdown
    await expect(page.locator('#tryMeMenu')).toBeVisible();
    await scan(page, 'Try-me menu (open)');
    await page.locator('#tryMeLoad').click();            // load the built-in sample
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#demoBadge')).toBeVisible();
    await scan(page, 'sample-data view (badge shown)');
  });
});
