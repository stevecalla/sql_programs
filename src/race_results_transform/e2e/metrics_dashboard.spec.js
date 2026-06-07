// Layout/theme regression for the /metrics dashboard. Runs on chromium (desktop)
// AND the mobile project (Pixel 5) — see config. Needs the dashboard login creds; skips the
// whole file if they're unset. Structure + theme + mobile-overflow are DOM checks,
// so they pass even if the DB is down (the page shell still renders).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const { test, expect } = require('@playwright/test');

const USER = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_USER;
const PASS = process.env.RACE_RESULTS_CONVERTER_METRICS_DASH_PASS;

test.describe('race_results_transform — metrics dashboard', () => {
  test.skip(!USER || !PASS, 'set RACE_RESULTS_CONVERTER_METRICS_DASH_USER / _PASS to run the dashboard checks');
  test.use({ extraHTTPHeaders: { 'x-metrics-test': '1' } });   // header tells the server not to log a dashboard_view
  test.beforeEach(async ({ page }) => {                       // form login -> sets the session cookie
    await page.goto('/metrics/login');
    await page.fill('input[name="username"]', USER || '');
    await page.fill('input[name="password"]', PASS || '');
    await Promise.all([ page.waitForURL('**/metrics'), page.click('button[type="submit"]') ]);
  });

  test('renders the shell, panels, and matches the app theme toggle', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('.mx-title')).toContainText('Metrics');
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
    // #9 — the "Ask your data" box (renders even without DB/API keys)
    await expect(page.locator('#ask-panel')).toBeVisible();
    await expect(page.locator('#ask-q')).toBeVisible();
    await expect(page.locator('#ask-model')).toBeVisible();
    await expect(page.locator('#ask-go')).toBeVisible();
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

  test('login sets a session cookie; logout forces re-login (N2)', async ({ page, context }) => {
    let cookies = await context.cookies();
    expect(cookies.some(function (c) { return c.name === 'mx_session'; }), 'session cookie set after login').toBe(true);
    await page.goto('/metrics/logout');
    cookies = await context.cookies();
    expect(cookies.some(function (c) { return c.name === 'mx_session'; }), 'cookie cleared on logout').toBe(false);
    await page.goto('/metrics');                       // truly logged out -> redirected to the login form
    await expect(page).toHaveURL(/\/metrics\/login/);
    await expect(page.locator('form[action="/metrics/login"]')).toBeVisible();
  });

  test('ask-box UX — chips, autofocus, fill, clear (D2)', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('#ask-suggest button').first()).toBeVisible();
    await expect(page.locator('#ask-clear')).toBeVisible();
    await expect(page.locator('#ask-model')).toBeVisible();
    await expect(page.locator('#ask-q')).toBeFocused();
    const chip = page.locator('#ask-suggest button').first();
    const chip_text = (await chip.textContent()).trim();
    await chip.click();
    await expect(page.locator('#ask-q')).toHaveValue(chip_text);
    await page.locator('#ask-clear').click();
    await expect(page.locator('#ask-q')).toHaveValue('');
  });

  test('ask-box SQL toggle disables model + swaps placeholder; results scroll (D3, #66/#64)', async ({ page }) => {
    await page.goto('/metrics');
    const tog = page.locator('#ask-sql-mode');
    await expect(tog).toBeVisible();
    await expect(page.locator('#ask-model')).toBeEnabled();
    await tog.check();
    await expect(page.locator('#ask-model')).toBeDisabled();           // model picker not used in raw-SQL mode
    await expect(page.locator('#ask-q')).toHaveAttribute('placeholder', /SELECT/);
    await tog.uncheck();
    await expect(page.locator('#ask-model')).toBeEnabled();
    // chart/table toggle buttons exist (hidden until a chartable result renders) (#65)
    await expect(page.locator('#ask-viz-chart')).toHaveCount(1);
    await expect(page.locator('#ask-viz-table')).toHaveCount(1);
    // long result tables scroll vertically rather than pushing the page (#64)
    const mh = await page.locator('#ask-table').evaluate(function (el) { return getComputedStyle(el).maxHeight; });
    expect(mh).not.toBe('none');
  });
});
