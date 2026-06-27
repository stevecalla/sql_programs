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
          total_accounts: 700682, merge_id_accounts: 25, clusters: 10623, duplicate_pairs: 17398,
          buckets: [{ bucket: 'in_both', count: 16 }, { bucket: 'sf_only', count: 9 }],
        },
      }),
    }));
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
  await expect(page.getByText('700,682')).toBeVisible();      // total accounts, formatted
  await expect(page.getByText('17,398')).toBeVisible();       // duplicate pairs
});

test('dark mode toggle sets data-theme on <html>', async ({ page }) => {
  await sign_in(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('button', { name: /theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/);
});
