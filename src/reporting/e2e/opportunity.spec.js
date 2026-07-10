'use strict';
// UX flows specific to the Opportunity view: on-map key, band modes, the collapsible state card, and the
// ranking tab. Assertions are structural (presence/behaviour), not exact numbers, so they hold against live
// data.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mapdiv')).toBeVisible();
  await page.getByRole('button', { name: 'Opportunity', exact: true }).first().click();
});

test('on-map key + band modes switch cleanly', async ({ page }) => {
  await expect(page.getByText(/Home penetration \/ 1k/)).toBeVisible();          // on-map key
  await expect(page.getByRole('button', { name: 'National-relative' })).toBeVisible();
  await page.getByRole('button', { name: 'Statistical' }).click();
  await expect(page.getByRole('button', { name: 'Quantile' })).toBeVisible();     // stat sub-controls appear
  await page.getByRole('button', { name: 'Absolute' }).click();
  await page.getByRole('button', { name: 'National-relative' }).click();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('state card collapses and expands', async ({ page }) => {
  await expect(page.getByRole('button', { name: /collapse/ })).toBeVisible();     // card open -> "collapse" handle
  await page.getByRole('button', { name: /collapse/ }).click();
  await expect(page.getByRole('button', { name: /state card/ })).toBeVisible();   // collapsed -> "state card" handle
  await page.getByRole('button', { name: /state card/ }).click();
  await expect(page.getByRole('button', { name: /collapse/ })).toBeVisible();     // expanded again
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('map key collapses', async ({ page }) => {
  const key = page.getByRole('button', { name: /Home penetration \/ 1k/ });
  await expect(page.getByText(/Leader/)).toBeVisible();     // band rows visible
  await key.click();                                        // collapse the key
  await expect(page.getByText(/Leader ≥/)).toHaveCount(0);  // band rows hidden
  await key.click();                                        // expand
});

test('ranking tab shows the sortable table', async ({ page }) => {
  // The bottom "Opportunity" tab (ranking) is the last button with that name.
  await page.getByRole('button', { name: 'Opportunity', exact: true }).last().click();
  await expect(page.getByText(/State ranking/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Penetration \/1k/ })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
