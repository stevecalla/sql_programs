// Tier 3: a bad/unreadable file must fail gracefully — show an error, keep the
// upload screen, and NOT blank the page or show a (broken) compare card.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { step, reset_steps } = require('./helpers');

function bad_file() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rrt-bad-')), 'not_really_FAKE.xlsx');
  fs.writeFileSync(p, Buffer.from('this is not a spreadsheet — just text bytes'));
  return p;
}

test.describe('race_results_transform — error handling', () => {
  test('an unreadable file shows an error and does not blank the page', async ({ page }) => {
    reset_steps();
    const dialogs = [];
    page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
    await page.goto('/');
    await expect(page.locator('#uploadCard')).toBeVisible();
    await step(page, 'Uploading a file that is not a real spreadsheet');
    await page.setInputFiles('#fileInput', bad_file());
    await step(page, 'App should warn and stay on the upload screen');
    await expect.poll(function () { return dialogs.length; }, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.locator('#uploadCard')).toBeVisible();
    await expect(page.locator('#compareCard')).toBeHidden();
    // the page shell survived (theme toggle + clock still there)
    await expect(page.locator('#themeToggle')).not.toBeEmpty();
    await expect(page.locator('#footerClock')).toContainText('MTN');
  });
});
