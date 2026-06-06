# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: table_view.spec.js >> race_results_transform — table view >> clicking a column header sorts (▲ then ▼) and enables Reset
- Location: e2e/table_view.spec.js:31:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#compareCard')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#compareCard')
    3 × locator resolved to <section id="compareCard" data-section="compare" class="card collapse-card hidden">…</section>
      - unexpected value "hidden"

```

```yaml
- banner:
  - heading "Race Results Spreadsheet Converter" [level=1]
  - button "Toggle light or dark theme": ☾ Dark
- region "Upload spreadsheet":
  - text: ⬆
  - strong: Drop a race-results .xlsx or .csv file here
  - text: or tap to choose — it is reformatted to the USAT template in your browser, nothing is uploaded
- heading "How it works" [level=2]
- list:
  - listitem:
    - text: 1 ⬇ Drop your file A race-results
    - code: .xlsx
    - text: or
    - code: .csv
    - text: — any column order or naming.
  - listitem: 2 ⚡ It auto-converts Reformatted to the USAT template right in your browser. Nothing is uploaded.
  - listitem: 3 ✎ Review the highlights Yellow cells are values the tool changed or guessed. Fix them in the table or the Mapping tab, then click a green ✓ Approve (or edit the cell) to clear them.
  - listitem: 4 ✓ Check Scorecard & Integrity Confirm every column mapped and that no athlete rows were lost.
  - listitem:
    - text: 5 ⤓ Download Save the template-ready
    - code: .xlsx
    - text: . Optionally Save mapping to auto-apply it to future files with the same headers.
- contentinfo: race results converter · runs entirely in your browser · calla codes makes it happen · Fri., 6/5/2026 10:58:46 PM MTN
```

# Test source

```ts
  1  | // Tier 2: the TableView surface — search filtering, header sort, and the flag
  2  | // filter (legend "Show rows") all wired through to the rendered rows.
  3  | const { test, expect } = require('@playwright/test');
  4  | const { step, highlight, reset_steps, SINGLE_XLSX } = require('./helpers');
  5  | 
  6  | const ROWS = '#resultGrid table tbody tr';
  7  | 
  8  | test.describe('race_results_transform — table view', () => {
  9  |   test.beforeEach(async ({ page }) => {
  10 |     reset_steps();
  11 |     await page.goto('/');
  12 |     await step(page, 'Opened the app');
  13 |     await page.setInputFiles('#fileInput', SINGLE_XLSX);
> 14 |     await expect(page.locator('#compareCard')).toBeVisible();
     |                                                ^ Error: expect(locator).toBeVisible() failed
  15 |     await expect(page.locator(ROWS).first()).toBeVisible();
  16 |   });
  17 | 
  18 |   test('search filters rows and clearing restores them', async ({ page }) => {
  19 |     const before = await page.locator(ROWS).count();
  20 |     expect(before).toBeGreaterThan(1);
  21 |     const search = page.locator('#resultGrid .tv-search');
  22 |     await highlight(page, search);
  23 |     await step(page, 'Searching for something that matches nothing');
  24 |     await search.fill('zzzzzznomatch');
  25 |     await expect(page.locator('#resultGrid .tv-empty')).toBeVisible();
  26 |     await step(page, 'Clearing the search restores every row');
  27 |     await search.fill('');
  28 |     await expect.poll(function () { return page.locator(ROWS).count(); }).toBe(before);
  29 |   });
  30 | 
  31 |   test('clicking a column header sorts (▲ then ▼) and enables Reset', async ({ page }) => {
  32 |     const th = page.locator('#resultGrid thead tr.tnames th[data-c]').nth(1);
  33 |     await highlight(page, th);
  34 |     await step(page, 'Clicking a column header to sort ascending');
  35 |     await th.click();
  36 |     await expect(th.locator('.ind')).toHaveText('▲');
  37 |     await expect(page.locator('#resultGrid .tv-reset')).toBeEnabled();
  38 |     await step(page, 'Clicking again flips to descending');
  39 |     await th.click();
  40 |     await expect(th.locator('.ind')).toHaveText('▼');
  41 |   });
  42 | 
  43 |   test('legend “Show rows” narrows the table to one highlight type', async ({ page }) => {
  44 |     const before = await page.locator(ROWS).count();
  45 |     const show = page.locator('#flagLegend .show-code').first();
  46 |     await highlight(page, show);
  47 |     await step(page, 'Clicking “Show rows” for one highlight code');
  48 |     await show.click();
  49 |     await step(page, 'Table should show fewer rows than the full set');
  50 |     await expect.poll(function () { return page.locator(ROWS).count(); }).toBeLessThan(before);
  51 |   });
  52 | });
  53 | 
```