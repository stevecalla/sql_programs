'use strict';
// Smoke e2e: the shell renders, login works, the dashboard shows data, and dark mode toggles.
// /api/* is stubbed so no DB / Salesforce / real credentials are needed.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/me', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
  await page.route('**/api/login', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user: 'tester', role: 'admin' }) }));
  await page.route('**/api/dashboard', (r) =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          total_accounts: 700682, merge_id_accounts: 25, clusters: 10623,
          accounts_in_clusters: 25121, duplicate_pairs: 17398,
          buckets: [{ bucket: 'in_both', count: 16 }, { bucket: 'sf_only', count: 9 }],
          signal_breakdown: {
            accounts: { exact: 21500, fuzzy: 1400, nickname: 1900, multi: 321 },
            pairs: { exact: 14800, fuzzy: 1100, nickname: 1498 },
            clusters: { exact: 9100, fuzzy: 600, nickname: 800, multi: 123 },
          },
        },
      }),
    }));
  // "data as of" stamp + header refresh — keep deterministic (no DB in the e2e server).
  await page.route('**/api/dataset', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: null }) }));
});

async function sign_in(page) {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill('tester');
  await page.getByPlaceholder('Password').fill('pw');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('shows the login screen, then the dashboard with data after sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Account Merge Console' })).toBeVisible();

  await sign_in(page);

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // these figures can appear in more than one place (funnel + by-signal table), so match the first.
  await expect(page.getByText('700,682').first()).toBeVisible();   // total accounts, formatted
  await expect(page.getByText('17,398').first()).toBeVisible();    // duplicate pairs
});

test('dark mode toggle sets data-theme on <html>', async ({ page }) => {
  await sign_in(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('button', { name: /theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/);
});
