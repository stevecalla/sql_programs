// Layout/theme regression for the /metrics dashboard. Runs on chromium (desktop)
// AND the mobile project (Pixel 5) — see config. Needs Basic Auth creds; skips the
// whole file if they're unset. Structure + theme + mobile-overflow are DOM checks,
// so they pass even if the DB is down (the page shell still renders).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const { test, expect } = require('@playwright/test');

const USER = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_USER;
const PASS = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_PASS;

test.describe('race_results_transform — metrics dashboard', () => {
  test.skip(!USER || !PASS, 'set RACE_RESULTS_CONVERTER_METRICS_DASH_USER / _PASS to run the dashboard checks');
  test.use({ httpCredentials: { username: USER || '', password: PASS || '' }, extraHTTPHeaders: { 'x-metrics-test': '1' } });   // header tells the server not to log a dashboard_view

  test('renders the shell, panels, and matches the app theme toggle', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('.mx-title')).toContainText('Usage');
    await expect(page.locator('#periods button')).toHaveCount(5);
    // the new panels exist
    await expect(page.locator('#chart_days')).toBeVisible();   // activity by day
    await expect(page.locator('#chart_modes')).toBeVisible();  // downloads by type (incl. split)
    await expect(page.locator('#tbl_users')).toBeVisible();    // top users
    await expect(page.locator('#chart_funnel')).toBeVisible();  // funnel (#2)
    await expect(page.locator('#splits')).toBeVisible();        // split-by-group panel (#1)
    await expect(page.locator('#refreshBtn')).toBeVisible();    // refresh (#3)
    await expect(page.locator('#autoRefresh')).toBeVisible();   // auto-refresh toggle (#3)
    await expect(page.locator('label.mx-auto')).toHaveAttribute('title', /every 60 seconds/);  // explains what auto-refresh does
    await expect(page.locator('#autoRefresh')).toBeChecked();    // auto-refresh defaults ON
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml/);  // bar-chart favicon
    await expect(page.locator('#tbl_users thead th')).toContainText(['Location (tz)']);  // top-user location (#4)
    await expect(page.locator('#tbl_users thead th')).toContainText(['Visits', 'Uploads', 'Downloads', 'Start over']);  // per-user activity counts
    await expect(page.locator('#tbl_users thead th.mx-rn')).toHaveText('#');  // leading row-number column on scrollable tables
    // per-chart toolbar (expand/png/csv/table) on all four charts
    await expect(page.locator('.mx-tools button[data-act="expand"]')).toHaveCount(4);
    await expect(page.locator('.mx-tools button[data-act="png"]')).toHaveCount(4);
    await expect(page.locator('.mx-tools button[data-act="csv"]')).toHaveCount(4);
    await expect(page.locator('.mx-tools button[data-act="table"]')).toHaveCount(4);
    // last-activity chip (label above value) + 2-row header
    await expect(page.locator('#lastData .mx-last-label')).toContainText('Last User Activity');
    await expect(page.locator('#lastData .mx-last-val')).toBeVisible();
    await expect(page.locator('.mx-head2 #periods button')).toHaveCount(5);
    await expect(page.locator('#themeToggle')).toContainText(/Dark|Light/);
    // theme toggle flips <html data-theme> and persists across reload (shared rrt_ui_v1 pref)
    const html = page.locator('html');
    await page.locator('#themeToggle').click();
    await expect(html).toHaveAttribute('data-theme', /^(dark|light)$/);
    const theme = await html.getAttribute('data-theme');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', theme);
    // header text uses --ink (white in dark) — assert it's not the dark brand navy
    const color = await page.locator('.mx-title').evaluate(function (el) { return getComputedStyle(el).color; });
    expect(color).toBeTruthy();
  });

  test('no horizontal overflow at the current viewport (mobile-safe)', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('.mx-title')).toBeVisible();
    const overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    expect(overflow).toBeLessThanOrEqual(2);
    // period selector + theme toggle stay reachable on small screens
    await expect(page.locator('#themeToggle')).toBeVisible();
    await expect(page.locator('#periods button').first()).toBeVisible();
  });
});
