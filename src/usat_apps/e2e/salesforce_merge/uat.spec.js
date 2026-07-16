'use strict';
// UAT UI e2e (Tier 2) — mirrors what the tester SEES when they land on each UAT tab's page, with every
// /api/salesforce-merge/* call STUBBED so no DB / Salesforce / worker is needed. This is the "does the
// surface render the controls the workbook tells the tester to use" layer; the decision logic behind
// those controls (survivorship, the drift gate, selective restore, bulk counts) is proven in the
// Tier-1 backend suite (modules/salesforce_merge/tests/uat_scenarios.test.js), and the Salesforce-native
// outcomes are the manual UAT pass. Tabs referenced below map to USAT_Salesforce_Merge_UAT.xlsx.
//   npm run usat_apps_e2e   (after: npx playwright install chromium)
const { test, expect } = require('@playwright/test');

// One completed merge so Restore's diff surface has a row to expand (UAT Test 1 step 8 / Test 5).
const COMPLETED = [{ id: 1, survivor: 'John Q Doe', account: '001A00', merged: '2026-07-15 10:00',
  source: 'merge_id', env: 'Sandbox', restorable: true }];

// Catch-all stub for the whole namespace so any merge page renders deterministically (mirrors smoke.spec.js).
test.beforeEach(async ({ page }) => {
  await page.route('**/api/salesforce-merge/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    let body = { ok: true, rows: [], data: null };
    if (p.endsWith('/dashboard')) body = { ok: true, data: { total_accounts: 700682, clusters: 10623, duplicate_pairs: 17398, merge_id_accounts: 25, accounts_in_clusters: 25121, buckets: [], signal_breakdown: { accounts: {}, pairs: {}, clusters: {} } } };
    else if (p.endsWith('/worker/health')) body = { ok: true, online: false, port: 8021 };
    else if (p.endsWith('/merge/status') || p.endsWith('/status')) body = { ok: true, environment: 'Sandbox', safe_mode: true, data_as_of: null };
    else if (/whoami/.test(p)) body = { ok: true, username: 'e2e-tester', objects: { Account: { createable: true, updateable: true, deletable: true } } };
    else if (p.endsWith('/merge/progress')) body = { ok: true, run: null };
    else if (p.endsWith('/stamp-fields')) body = { ok: true, present: false, fields: [] };
    else if (p.endsWith('/merge/restore')) body = { ok: true, rows: COMPLETED };   // GET completed merges
    else if (p.endsWith('/merge/recreate')) body = { ok: true, rows: [] };
    else if (p.endsWith('/merge-queue') || p.endsWith('/merge-groups') || p.endsWith('/duplicates')) body = { ok: true, rows: [], total: 0 };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

// UAT Test 1 / 2 / 6 entry surface + the "Add is disabled until you're ready" guard (Test 1 step 2).
test('Select Merges renders the filters and a disabled Add button', async ({ page }) => {
  await page.goto('/salesforce/merge/select-merges');
  await expect(page.getByRole('heading', { name: 'Select Merges' })).toBeVisible();
  // Filters render (Size is always shown; Signal/Tier are source-dependent) + the source toggle.
  await expect(page.getByText('Size', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate groups' })).toBeVisible();
  // Nothing selected yet -> the guard keeps "Add to merge queue" disabled.
  const add = page.getByRole('button', { name: 'Add to merge queue' });
  await expect(add).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// UAT Test 3 — the drift check is a first-class, visible step in the processing pipeline.
test('Process Merges shows the re-validate/drift step and Execute controls', async ({ page }) => {
  await page.goto('/salesforce/merge/merge-process');
  await expect(page.getByRole('heading', { name: 'Process Merges' })).toBeVisible();
  await expect(page.getByText('Re-validate & drift check').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// UAT Test 1 step 8 + Test 5 — Restore exposes the current-vs-snapshot diff expander and the recreate queue.
test('Restore shows completed merges with a diff expander and the recreate queue', async ({ page }) => {
  await page.goto('/salesforce/merge/restore');
  await expect(page.getByRole('heading', { name: 'Restore' })).toBeVisible();
  await expect(page.getByText(/Completed merges/)).toBeVisible();
  await expect(page.getByText(/Recreate queue/)).toBeVisible();
  // The stubbed completed row exposes the per-row diff toggle (current vs pre-merge snapshot).
  await expect(page.getByTitle('Diff current vs pre-merge snapshot')).toBeVisible();
  // Post-merge gate surface: the on-demand "check for edits since the merge" button (UAT Test 7).
  await expect(page.getByRole('button', { name: /Check post.merge changes/i })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
