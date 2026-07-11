'use strict';
// Ported from src/reporting/e2e/opportunity.spec.js — only the route changed (the map now lives at
// /reporting/participation-maps inside the usat_apps shell). Test logic + selectors unchanged.
// UX flows specific to the Opportunity view: on-map key, band modes, the collapsible state card, and the
// ranking tab. Assertions are structural (presence/behaviour), not exact numbers, so they hold against live
// data.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/reporting/participation-maps');
  await expect(page.locator('.mapdiv')).toBeVisible();
  await page.getByRole('button', { name: 'Opportunity', exact: true }).first().click();
});

test('on-map key + band modes switch cleanly', async ({ page }) => {
  await expect(page.getByText(/penetration \/ 1k/i)).toBeVisible();              // on-map key (All-states penetration / 1k)
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
  const key = page.getByRole('button', { name: /penetration \/ 1k/i });
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
  // The 'all' tab shows both "All /1k" and "In /1k" headers — assert the first to avoid a
  // strict-mode multi-match; presence of a /1k column confirms the metric table rendered.
  await expect(page.getByRole('columnheader', { name: /\/1k/ }).first()).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('adult / youth age toggle', async ({ page }) => {
  // "Adult"/"Youth" appear in BOTH the map controls and the ranking header — use the first (map control).
  await expect(page.getByRole('button', { name: 'Adult', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Youth', exact: true }).first().click();
  await expect(page.getByText(/youth \(4–19\)/).first()).toBeVisible();   // card hero reflects the age group
  await page.getByRole('button', { name: 'Adult', exact: true }).first().click();
  await expect(page.getByText(/adults \(20\+\)/).first()).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('where-residents-race breakout is present and additive', async ({ page }) => {
  await expect(page.getByText('Where residents race')).toBeVisible();
  await expect(page.getByText(/Raced only in-state/)).toBeVisible();
  await expect(page.getByText(/Raced in-state and out/)).toBeVisible();
  await expect(page.getByText(/Raced only out-of-state/)).toBeVisible();
  await expect(page.getByText(/= All-states/)).toBeVisible();
});

test('map basis toggles all-states / in-state', async ({ page }) => {
  const key = page.getByRole('button', { name: /penetration \/ 1k/i });
  await expect(key).toHaveText(/All-states penetration/);   // default basis
  await page.getByRole('button', { name: 'In-state', exact: true }).click();
  await expect(key).toHaveText(/In-state penetration/);    // on-map key follows the toggle
  await page.getByRole('button', { name: 'All-states', exact: true }).click();
  await expect(key).toHaveText(/All-states penetration/);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
