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
  // exact:true — the collapse-key button's label embeds the active mode name (e.g. "…· National-relative"),
  // so a loose match would collide with it.
  await expect(page.getByRole('button', { name: 'National-relative', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Statistical', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Quantile', exact: true })).toBeVisible();  // stat sub-controls appear
  await page.getByRole('button', { name: 'Absolute', exact: true }).click();
  await page.getByRole('button', { name: 'National-relative', exact: true }).click();
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
  // The toggle button's own title flips Collapse<->Expand — the deterministic signal. In the default
  // National-relative mode the key rows read "Under-penetrated below national" etc. (NOT a numeric cut;
  // the numeric "Leader ≥ 0.44" text lives in the bottom toolbar and is unrelated to this key), so we
  // match a row-only phrase to confirm the rows themselves appear/disappear.
  const bandRow = page.getByText(/below national/);
  await expect(key).toHaveAttribute('title', 'Collapse the key');  // starts expanded
  await expect(bandRow).toBeVisible();                             // band rows visible
  await key.click();                                               // collapse the key
  await expect(key).toHaveAttribute('title', 'Expand the key');    // toggled to collapsed
  await expect(bandRow).toBeHidden();                              // band rows removed
  await key.click();                                               // expand again
  await expect(key).toHaveAttribute('title', 'Collapse the key');
});

test('ranking tab shows the sortable table', async ({ page }) => {
  // The bottom "Opportunity" tab (ranking) is the last button with that name.
  await page.getByRole('button', { name: 'Opportunity', exact: true }).last().click();
  await expect(page.getByText(/State ranking/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Penetration \/1k/ })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
