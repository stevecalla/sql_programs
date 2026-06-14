// "Get Race Results from Salesforce" intake — OPT-IN browser test (part of the Playwright suite,
// NOT npm test). All /api/sf/* + /api/login are STUBBED (no real Salesforce, no creds), and the
// File System Access API is disabled so the cross-browser server-folder fallback is exercised.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const h = require('./helpers');
const { step, reset_steps, SINGLE_XLSX } = h;

function make_files(n) {
  const f = [];
  for (let i = 1; i <= n; i++) f.push({
    content_version_id: 'cv' + i, target_name: 'race_' + i + '.xlsx',
    program_name: 'Prog ' + i, owner_name: 'Owner ' + i, modified_mtn_full: '06/0' + ((i % 9) + 1) + '/2026, 1:00:00 PM MDT'
  });
  return f;
}
const SF_FILES = { ok: true, count: 2, files: make_files(2) };
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('race_results_transform — Salesforce intake', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.addInitScript(() => { try { delete window.showDirectoryPicker; } catch (e) { /* ignore */ } });
    await page.route('**/api/sf/files**', (route) => route.fulfill(json(SF_FILES)));
    await page.route('**/api/sf/save', (route) => route.fulfill(json({ ok: true, saved: [] })));
    await page.route('**/api/sf/file/**', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(SINGLE_XLSX) }));
    await page.goto('/');
    await expect(page.locator('#sfCard')).toBeVisible();
    // the intake now defaults to the SF Email Queue tab — these tests cover the SF Upload Queue, so select it
    await page.locator('#sfSourceSeg [data-src="upload"]').click();
  });

  test('list → download → queue → open → convert → download updates statuses', async ({ page }) => {
    // From/To default to today
    await expect(page.locator('#sfFrom')).not.toHaveValue('');
    await expect(page.locator('#sfTo')).not.toHaveValue('');

    await step(page, 'Listing Salesforce files');
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await expect(page.locator('#sfCount')).toContainText('selected');
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(2);   // auto-selected

    await step(page, 'Sorting by a column header');
    await page.locator('#sfTable th.sf-sort[data-sort="program"]').click();
    await expect(page.locator('#sfTable th[data-sort="program"] .sf-arrow')).not.toBeEmpty();

    await step(page, 'Choosing a folder (fallback path) + downloading');
    await page.locator('#sfChooseFolder').click();
    await page.locator('#sfFolderPath').fill('C:/temp/sf_test');
    await expect(page.locator('#sfDownloadBtn')).toBeEnabled();
    await page.locator('#sfDownloadBtn').click();

    await step(page, 'Files queue tab opens (sortable table with Status)');
    await expect(page.locator('#filesTab')).toBeVisible();
    const row = page.locator('.sf-q-trow').first();
    await expect(row).toBeVisible();
    await expect(page.locator('.sf-q-table thead')).toContainText('Status');
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(0);

    await step(page, 'Clicking the row opens + converts the file');
    await row.click();
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(2);   // Uploaded + Converted

    await step(page, 'Downloading the converted output → Downloaded');
    await page.locator('#downloadBtn').click();
    const dlpop = page.locator('.dl-pop');
    await expect(dlpop).toBeVisible();
    await Promise.all([page.waitForEvent('download'), dlpop.locator('#dlGo').click()]);   // default CSV is fine
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(3);
  });

  test('Reload re-reads a queue file from disk and resets its status', async ({ page }) => {
    // stub the fallback read-back so Reload gets fresh bytes
    await page.route('**/api/sf/folder-file**', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(SINGLE_XLSX) }));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await page.locator('#sfChooseFolder').click();
    await page.locator('#sfFolderPath').fill('C:/temp/sf_test');
    await page.locator('#sfDownloadBtn').click();
    const row = page.locator('.sf-q-trow').first();
    await expect(row).toBeVisible();
    await row.click();   // open + convert
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');
    // download the converted output to reach Downloaded (3 stages)
    await page.locator('#downloadBtn').click();
    await Promise.all([page.waitForEvent('download'), page.locator('.dl-pop #dlGo').click()]);
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(3);
    // Reload → re-reads from disk, re-converts, and clears Downloaded
    await expect(row.locator('.sf-q-reload')).toBeVisible();
    await row.locator('.sf-q-reload').click();
    await expect(page.locator('#resultGrid table thead')).toContainText('Recorded Time');
    await page.locator('#compareSeg button[data-view="files"]').click();
    await expect(row.locator('.sf-q-stage.done')).toHaveCount(2);   // back to Uploaded + Converted
  });

  test('date defaults to yesterday → today, and a >14-day To auto-clamps', async ({ page }) => {
    await expect(page.locator('#sfFrom')).not.toHaveValue('');   // yesterday
    await expect(page.locator('#sfTo')).not.toHaveValue('');     // today
    // use past dates (well below the today ceiling) so the clamp is deterministic
    await page.locator('#sfFrom').fill('2025-06-01');
    await page.locator('#sfTo').fill('2025-06-30');
    await expect(page.locator('#sfTo')).toHaveValue('2025-06-15');   // clamped to From + 14
  });

  test('“Any date” greys out the From/To fields', async ({ page }) => {
    await page.locator('#sfAnyDate').check();
    await expect(page.locator('#sfFrom')).toBeDisabled();
    await expect(page.locator('#sfTo')).toBeDisabled();
  });

  test('inline login appears on 401, password toggles, then the list retries', async ({ page }) => {
    let authed = false;
    await page.route('**/api/sf/files**', (route) => route.fulfill(authed ? json(SF_FILES) : { status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not authenticated' }) }));
    await page.route('**/api/login', (route) => { authed = true; return route.fulfill(json({ ok: true })); });

    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfLogin')).toBeVisible();
    await page.locator('#sfLoginUser').fill('admin');
    await page.locator('#sfLoginPass').fill('secret');
    await page.locator('#sfLoginShow').click();
    await expect(page.locator('#sfLoginPass')).toHaveAttribute('type', 'text');   // show password
    await page.locator('#sfLoginBtn').click();
    await expect(page.locator('#sfLogin')).toBeHidden();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);   // retried after sign-in, no redirect
  });

  test('cap: newest 50 auto-selected; "Max files" raises it and clamps at 150', async ({ page }) => {
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 60, files: make_files(60) })));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(60);
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(50);   // default 50
    await expect(page.locator('#sfLimit')).toHaveClass(/sf-limit-hot/);                    // 60 available > 50 cap -> field glows

    await page.locator('#sfLimit').fill('60');
    await page.locator('#sfLimit').dispatchEvent('change');
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(60);    // raised to include all
    await expect(page.locator('#sfLimit')).not.toHaveClass(/sf-limit-hot/);                // nothing more to include -> no glow

    await page.locator('#sfLimit').fill('500');
    await page.locator('#sfLimit').dispatchEvent('change');
    await expect(page.locator('#sfLimit')).toHaveValue('150');                              // clamped to 150
  });

  test('search filters the files-found table', async ({ page }) => {
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 3, files: [
      { content_version_id: 'a', target_name: 'alpha_race.xlsx', file_extension: 'xlsx', program_name: 'Alpha', owner_name: 'Ann', modified_mtn_full: '06/01/2026, 1:00:00 PM MDT' },
      { content_version_id: 'b', target_name: 'beta_race.xlsx', file_extension: 'xlsx', program_name: 'Beta', owner_name: 'Bob', modified_mtn_full: '06/02/2026, 1:00:00 PM MDT' },
      { content_version_id: 'c', target_name: 'gamma_race.xlsx', file_extension: 'xlsx', program_name: 'Gamma', owner_name: 'Cleo', modified_mtn_full: '06/03/2026, 1:00:00 PM MDT' }
    ] })));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(3);
    await page.locator('#sfSearch').fill('beta');
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(1);
    await expect(page.locator('#sfTable tbody')).toContainText('Beta');
    await page.locator('#sfSearch').fill('');
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(3);
  });

  test('Sign out clears the session and resets the panel', async ({ page }) => {
    let logged_out = false;
    await page.route('**/api/logout', (route) => { logged_out = true; return route.fulfill(json({ ok: true })); });
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await page.locator('#sfLogoutBtn').click();
    await expect.poll(() => logged_out).toBe(true);
    await expect(page.locator('#sfTableWrap')).toBeHidden();
    await expect(page.locator('#sfStatus')).toContainText('Signed out');
  });

  test('Start over clears the Salesforce panel', async ({ page }) => {
    await page.locator('#sfListBtn').click();
    await page.locator('#sfChooseFolder').click();
    await page.locator('#sfFolderPath').fill('C:/temp/sf_test');
    await page.locator('#sfDownloadBtn').click();
    await expect(page.locator('#filesTab')).toBeVisible();
    await page.locator('.sf-q-trow').first().click();
    await expect(page.locator('#compareCard')).toBeVisible();
    await page.locator('#clearBtn').click();                         // Start over
    await expect(page.locator('#sfCard')).toBeVisible();
    await expect(page.locator('#sfTableWrap')).toBeHidden();         // SF list cleared
  });

  test('Cancel stops an in-progress download', async ({ page }) => {
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 6, files: make_files(6) })));
    // slow the per-file fetch so the download is reliably IN PROGRESS when Cancel is clicked
    // (otherwise a fast browser can finish before the cancel lands and the status reads "Saved").
    await page.route('**/api/sf/file/**', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(SINGLE_XLSX) });
    });
    await page.locator('#sfListBtn').click();
    await page.locator('#sfChooseFolder').click();
    await page.locator('#sfFolderPath').fill('C:/temp/sf_test');
    await page.locator('#sfDownloadBtn').click();
    await expect(page.locator('#sfProgress')).toBeVisible();   // download is underway
    // force-click: the animating progress bar can leave the Cancel button "not stable" for Playwright's
    // actionability check on WebKit, but it IS clickable.
    await page.locator('#sfCancelBtn').click({ force: true });
    await expect(page.locator('#sfStatus')).toContainText(/ancel/);   // "Cancelling…" / "cancelled"
  });

  test('legacy .xls files get a Type column, a highlighted row, and a re-save hint', async ({ page }) => {
    await page.route('**/vendor/xlsx.full.min.js', (route) => route.fulfill({ status: 404, body: '' }));   // force "SheetJS not available" → .xls is flagged
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 2, files: [
      { content_version_id: 'cx1', target_name: 'old_race_prog_owner_cx1.xls', file_extension: 'xls', program_name: 'Prog', owner_name: 'Owner', modified_mtn_full: '06/01/2026, 1:00:00 PM MDT' },
      { content_version_id: 'cv9', target_name: 'good_race_prog_owner_cv9.xlsx', file_extension: 'xlsx', program_name: 'Prog', owner_name: 'Owner', modified_mtn_full: '06/02/2026, 1:00:00 PM MDT' }
    ] })));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable thead')).toContainText('Type');
    await expect(page.locator('#sfTable tbody tr.sf-xls-row')).toHaveCount(1);
    await expect(page.locator('#sfTable tbody tr.sf-xls-row .sf-type.xls')).toContainText('xls');
    await expect(page.locator('#sfStatus')).toContainText('re-saved as .xlsx');
  });

  test('when SheetJS is available, .xls files are not flagged or warned', async ({ page }) => {
    await page.route('**/vendor/xlsx.full.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = { read: function () {}, utils: {} };' }));
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 1, files: [
      { content_version_id: 'cx1', target_name: 'old_race_cx1.xls', file_extension: 'xls', program_name: 'Prog', owner_name: 'Owner', modified_mtn_full: '06/01/2026, 1:00:00 PM MDT' }
    ] })));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(1);
    await expect(page.locator('#sfTable tbody tr.sf-xls-row')).toHaveCount(0);   // SheetJS can read it → no flag
    await expect(page.locator('#sfStatus')).not.toContainText('re-saved');
  });

  test('no files found is indicated, and Reset clears the panel', async ({ page }) => {
    await page.route('**/api/sf/files**', (route) => route.fulfill(json({ ok: true, count: 0, files: [] })));
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfCount')).toContainText('No files found');
    await expect(page.locator('#sfTableWrap')).toBeHidden();
    await page.locator('#sfResetBtn').click();
    await expect(page.locator('#sfCount')).toBeHidden();
  });
});
