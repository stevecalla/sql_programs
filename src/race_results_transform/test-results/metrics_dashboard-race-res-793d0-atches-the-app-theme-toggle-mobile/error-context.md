# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: metrics_dashboard.spec.js >> race_results_transform — metrics dashboard >> renders the shell, panels, and matches the app theme toggle
- Location: e2e\metrics_dashboard.spec.js:16:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.mx-title')
Expected substring: "Usage"
Received string:    "📊 Race Results Converter — Metrics"
Timeout: 12000ms

Call log:
  - Expect "toContainText" with timeout 12000ms
  - waiting for locator('.mx-title')
    26 × locator resolved to <h1 class="mx-title">…</h1>
       - unexpected value "📊 Race Results Converter — Metrics"

```

```yaml
- heading "📊 Race Results Converter — Metrics" [level=1]
```

# Test source

```ts
  1  | // Layout/theme regression for the /metrics dashboard. Runs on chromium (desktop)
  2  | // AND the mobile project (Pixel 5) — see config. Needs Basic Auth creds; skips the
  3  | // whole file if they're unset. Structure + theme + mobile-overflow are DOM checks,
  4  | // so they pass even if the DB is down (the page shell still renders).
  5  | const path = require('path');
  6  | require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
  7  | const { test, expect } = require('@playwright/test');
  8  | 
  9  | const USER = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_USER;
  10 | const PASS = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_PASS;
  11 | 
  12 | test.describe('race_results_transform — metrics dashboard', () => {
  13 |   test.skip(!USER || !PASS, 'set RACE_RESULTS_CONVERTER_METRICS_DASH_USER / _PASS to run the dashboard checks');
  14 |   test.use({ httpCredentials: { username: USER || '', password: PASS || '' }, extraHTTPHeaders: { 'x-metrics-test': '1' } });   // header tells the server not to log a dashboard_view
  15 | 
  16 |   test('renders the shell, panels, and matches the app theme toggle', async ({ page }) => {
  17 |     await page.goto('/metrics');
> 18 |     await expect(page.locator('.mx-title')).toContainText('Usage');
     |                                             ^ Error: expect(locator).toContainText(expected) failed
  19 |     await expect(page.locator('#periods button')).toHaveCount(5);
  20 |     // the new panels exist
  21 |     await expect(page.locator('#chart_days')).toBeVisible();   // activity by day
  22 |     await expect(page.locator('#chart_modes')).toBeVisible();  // downloads by type (incl. split)
  23 |     await expect(page.locator('#tbl_users')).toBeVisible();    // top users
  24 |     await expect(page.locator('#chart_funnel')).toBeVisible();  // funnel (#2)
  25 |     await expect(page.locator('#splits')).toBeVisible();        // split-by-group panel (#1)
  26 |     await expect(page.locator('#refreshBtn')).toBeVisible();    // refresh (#3)
  27 |     await expect(page.locator('#autoRefresh')).toBeVisible();   // auto-refresh toggle (#3)
  28 |     await expect(page.locator('label.mx-auto')).toHaveAttribute('title', /every 60 seconds/);  // explains what auto-refresh does
  29 |     await expect(page.locator('#autoRefresh')).toBeChecked();    // auto-refresh defaults ON
  30 |     await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml/);  // bar-chart favicon
  31 |     await expect(page.locator('#tbl_users thead th')).toContainText(['Location (tz)']);  // top-user location (#4)
  32 |     await expect(page.locator('#tbl_users thead th')).toContainText(['Visits', 'Uploads', 'Downloads', 'Start over']);  // per-user activity counts
  33 |     await expect(page.locator('#tbl_users thead th.mx-rn')).toHaveText('#');  // leading row-number column on scrollable tables
  34 |     // per-chart toolbar (expand/png/csv/table) on all four charts
  35 |     await expect(page.locator('.mx-tools button[data-act="expand"]')).toHaveCount(4);
  36 |     await expect(page.locator('.mx-tools button[data-act="png"]')).toHaveCount(4);
  37 |     await expect(page.locator('.mx-tools button[data-act="csv"]')).toHaveCount(4);
  38 |     await expect(page.locator('.mx-tools button[data-act="table"]')).toHaveCount(4);
  39 |     // last-activity chip (label above value) + 2-row header
  40 |     await expect(page.locator('#lastData .mx-last-label')).toContainText('Last User Activity');
  41 |     await expect(page.locator('#lastData .mx-last-val')).toBeVisible();
  42 |     await expect(page.locator('.mx-head2 #periods button')).toHaveCount(5);
  43 |     await expect(page.locator('#themeToggle')).toContainText(/Dark|Light/);
  44 |     // theme toggle flips <html data-theme> and persists across reload (shared rrt_ui_v1 pref)
  45 |     const html = page.locator('html');
  46 |     await page.locator('#themeToggle').click();
  47 |     await expect(html).toHaveAttribute('data-theme', /^(dark|light)$/);
  48 |     const theme = await html.getAttribute('data-theme');
  49 |     await page.reload();
  50 |     await expect(html).toHaveAttribute('data-theme', theme);
  51 |     // header text uses --ink (white in dark) — assert it's not the dark brand navy
  52 |     const color = await page.locator('.mx-title').evaluate(function (el) { return getComputedStyle(el).color; });
  53 |     expect(color).toBeTruthy();
  54 |   });
  55 | 
  56 |   test('no horizontal overflow at the current viewport (mobile-safe)', async ({ page }) => {
  57 |     await page.goto('/metrics');
  58 |     await expect(page.locator('.mx-title')).toBeVisible();
  59 |     const overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  60 |     expect(overflow).toBeLessThanOrEqual(2);
  61 |     // period selector + theme toggle stay reachable on small screens
  62 |     await expect(page.locator('#themeToggle')).toBeVisible();
  63 |     await expect(page.locator('#periods button').first()).toBeVisible();
  64 |   });
  65 | });
  66 | 
```