'use strict';
// Merge module e2e (ported from src/salesforce_merge/e2e/app.spec.js). The standalone spec tested the
// merge app's OWN login screen; in the platform that's gone (the shared auth.setup.js signs in once and
// every test reuses that state), so this tests what the module actually owns: the drill-in rail + the
// dashboard render under /salesforce/merge, and the "no worker online" banner on Process. All
// /api/salesforce-merge/* calls are STUBBED so no DB / Salesforce / worker is needed.
//   npm run usat_apps_e2e   (after: npx playwright install chromium)
const { test, expect } = require('@playwright/test');

const DASH = {
  total_accounts: 700682, merge_id_accounts: 25, clusters: 10623,
  accounts_in_clusters: 25121, duplicate_pairs: 17398,
  buckets: [{ bucket: 'in_both', count: 16 }, { bucket: 'sf_only', count: 9 }],
  signal_breakdown: {
    accounts: { exact: 21500, fuzzy: 1400, nickname: 1900, multi: 321 },
    pairs: { exact: 14800, fuzzy: 1100, nickname: 1498 },
    clusters: { exact: 9100, fuzzy: 600, nickname: 800, multi: 123 },
  },
};

// One catch-all stub for the whole namespace so any page renders deterministically.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/salesforce-merge/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    let body = { ok: true, rows: [], data: null };
    if (p.endsWith('/dashboard')) body = { ok: true, data: DASH };
    else if (p.endsWith('/worker/health')) body = { ok: true, online: false, port: 8021 };
    else if (p.endsWith('/merge/status')) body = { ok: true, environment: 'Sandbox', safe_mode: true, data_as_of: null };
    else if (/whoami/.test(p)) body = { ok: true, username: 'e2e-tester', objects: { Account: { createable: true, updateable: true, deletable: true } } };
    else if (p.endsWith('/merge/progress')) body = { ok: true, run: null };
    else if (p.endsWith('/stamp-fields')) body = { ok: true, present: false, fields: [] };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

test('drill-in: /salesforce/merge shows merge\'s own rail with a back link', async ({ page }) => {
  await page.goto('/salesforce/merge');
  const rail = page.locator('nav.siderail[aria-label="Merge sections"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('link', { name: /USAT Apps/ })).toBeVisible();        // back link to the platform
  await expect(rail.getByRole('link', { name: /Process Merges/ })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('dashboard renders under the platform shell with data', async ({ page }) => {
  await page.goto('/salesforce/merge');
  await expect(page.locator('.sfmerge')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('700,682').first()).toBeVisible();   // total accounts, formatted
  await expect(page.getByText('17,398').first()).toBeVisible();    // duplicate pairs
});

test('Process shows the "no worker online" banner when :8021 is down', async ({ page }) => {
  await page.goto('/salesforce/merge/merge-process');
  await expect(page.getByRole('heading', { name: 'Process Merges' })).toBeVisible();
  await expect(page.getByText(/No merge worker online/i)).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
