// Tier 1 UX/UI regression guards for the interactive surface: theme persistence,
// CSV input, the approve flow, edit-clears-a-flag, value-map overrides, and the
// inline header remap. These are the bits that silently break on refactors.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');
const { step, highlight, highlight_click, read_xlsx, reset_steps, SINGLE_XLSX, SINGLE_CSV } = h;

// Pull the "<N> values in <M> rows to review" count out of the flag legend.
async function review_count(page) {
  const txt = await page.locator('#flagLegend').innerText();
  const m = txt.match(/(\d+)\s+values?\s+in/i);
  return m ? Number(m[1]) : 0;
}

test.describe('race_results_transform — UI interactions', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
  });

  test('theme toggle switches to dark and persists across reload', async ({ page }) => {
    const html = page.locator('html');
    await highlight_click(page, page.locator('#themeToggle'), 'Clicking the theme toggle');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await step(page, 'Reloading — the dark theme should stick');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#themeToggle')).toContainText('Light');   // button now offers "Light"
  });

  test('CSV upload converts and downloads a 12-column .xlsx', async ({ page }) => {
    await step(page, 'Uploading the sample .CSV (not xlsx)');
    await page.setInputFiles('#fileInput', SINGLE_CSV);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();
    await step(page, 'Opening the Download picker and choosing Excel');
    await page.locator('#downloadBtn').click();
    const pop = page.locator('.dl-pop');
    await expect(pop).toBeVisible();
    await pop.locator('[data-fmt="xlsx"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pop.locator('#dlGo').click()
    ]);
    const wb = await read_xlsx(await download.path());
    expect(wb.worksheets[0].getRow(1).values.slice(1).length).toBe(12);
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);
    await step(page, 'CSV → 12-column .xlsx ✓');
  });

  test('Approve all clears the review count to all-clear', async ({ page }) => {
    await step(page, 'Uploading the sample (it has flagged values)');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#flagLegend')).toBeVisible();
    expect(await review_count(page)).toBeGreaterThan(0);
    await highlight_click(page, page.locator('#approve_all'), 'Clicking “Approve all”');
    await step(page, 'Legend should now read “All values reviewed”');
    await expect(page.locator('#flagLegend')).toHaveClass(/allclear/);
    await expect(page.locator('#flagLegend')).toContainText('All values reviewed');
  });

  test('editing a flagged cell drops the review count', async ({ page }) => {
    await step(page, 'Uploading the sample');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    const before = await review_count(page);
    expect(before).toBeGreaterThan(0);
    const cell = page.locator('#resultGrid td.flag[contenteditable="true"]').first();
    await highlight(page, cell);
    await step(page, 'Editing one highlighted cell to accept it');
    await cell.click();
    await cell.fill('EDITED');
    await page.locator('#resultMeta').click();          // blur the cell
    await step(page, 'Review count should have dropped');
    await expect.poll(function () { return review_count(page); }, { timeout: 5000 }).toBeLessThan(before);
  });

  test('value-map override applies and shows a reset control', async ({ page }) => {
    await step(page, 'Uploading the sample');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await highlight_click(page, page.locator('#compareSeg button[data-view="mapping"]'), 'Opening the Mapping tab');
    const vm = page.locator('.rrt-valmap select[data-src]').first();
    await expect(vm).toBeVisible();
    await highlight(page, vm);
    await step(page, 'Changing one value-map dropdown');
    const current = await vm.inputValue();
    const next = (await vm.locator('option').evaluateAll(function (os, cur) {
      var o = os.find(function (x) { return x.value && x.value !== cur; }); return o ? o.value : null;
    }, current));
    expect(next).toBeTruthy();
    await vm.selectOption(next);
    await step(page, 'A ↺ reset control should appear + table stays populated');
    await expect(page.locator('.rrt-valmap .vm-reset').first()).toBeVisible();
    // result grid lives on the (now-hidden) Tables tab — assert rows weren't wiped by count, not visibility
    await expect(page.locator('#resultGrid table tbody tr')).not.toHaveCount(0);
  });

  test('inline header remap re-renders the table without blanking it', async ({ page }) => {
    await step(page, 'Uploading the sample');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    const sel = page.locator('#resultGrid select.hmap').first();
    await expect(sel).toBeVisible();
    const before = await sel.inputValue();
    const next = await sel.locator('option').evaluateAll(function (os, cur) {
      var o = os.find(function (x) { return x.value !== cur; }); return o ? o.value : null;
    }, before);
    expect(next !== null).toBeTruthy();
    await highlight(page, sel);
    await step(page, 'Remapping a column via the in-header dropdown');
    await sel.selectOption(next);
    await step(page, 'Table should re-render (recompute), not go blank');
    await expect(page.locator('#resultGrid table tbody tr').first()).toBeVisible();
    await expect(page.locator('#resultGrid table thead')).toContainText('Member Number');
  });
});
