// Slack intake (the "Slack Ironman" tab) — OPT-IN browser test (part of the Playwright suite, NOT
// npm test). All /api/slack/* calls are STUBBED (no real Slack, no token), and the File System Access
// API is disabled so the cross-browser server-folder fallback is exercised.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const h = require('./helpers');
const { step, reset_steps, SINGLE_XLSX } = h;

function make_slack_files(n) {
  const f = [];
  for (let i = 1; i <= n; i++) f.push({
    content_version_id: 'F' + i, file_id: 'F' + i,
    target_name: 'test_bot_uploader_' + i + '_race_' + i + '_f' + i + '.xlsx', name: 'race_' + i + '.xlsx',
    file_extension: 'xlsx', filetype: 'xlsx',
    created_ms: 1700000000000 + i * 100000, created_mtn: '06/0' + ((i % 9) + 1) + '/2026, 1:00:00 PM MDT',
    uploader_name: 'Uploader ' + i, owner_name: 'Uploader ' + i, channel_id: 'C0TEST'
  });
  return f;
}
const SLACK_FILES = { ok: true, count: 2, files: make_slack_files(2) };
const SLACK_CHANNELS = {
  ok: true,
  bot: { handle: 'membershipsalesbot', user_id: 'U01', team: 'USA Triathlon' },
  default_channel: 'C0TEST',
  channels: [{ id: 'C0TEST', name: 'test_bot', is_private: true }, { id: 'C0PUB', name: 'general', is_private: false }]
};
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('race_results_transform — Slack intake', () => {
  test.beforeEach(async ({ page }) => {
    reset_steps();
    await page.addInitScript(() => { try { delete window.showDirectoryPicker; } catch (e) { /* ignore */ } });
    await page.route('**/api/slack/channels**', (route) => route.fulfill(json(SLACK_CHANNELS)));
    await page.route('**/api/slack/files**', (route) => route.fulfill(json(SLACK_FILES)));
    await page.route('**/api/slack/save', (route) => route.fulfill(json({ ok: true, saved: [] })));
    await page.route('**/api/slack/file/**', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(SINGLE_XLSX) }));
    await page.goto('/');
    await page.locator('#sfSourceSeg [data-src="slack"]').click();
    await expect(page.locator('#sfSlackChannel')).toBeVisible();
  });

  test('channel picker + invite chip → list → download → queue → open → convert → download', async ({ page }) => {
    // the picker auto-populates from the channels the bot is in; the invite chip shows the real @handle
    await expect(page.locator('#sfSlackChannel option')).toHaveCount(2);
    await expect(page.locator('#sfSlackInvite')).toContainText('/invite @membership-sales-bot');

    await step(page, 'Listing Slack files for the channel');
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTable tbody tr')).toHaveCount(2);
    await expect(page.locator('#sfTable thead')).toContainText('Uploader');           // slack column set
    await expect(page.locator('#sfTable tbody input.sf-pick:checked')).toHaveCount(2); // newest auto-selected

    await step(page, 'Downloading via the server-folder fallback');
    await page.locator('#sfChooseFolder').click();
    await page.locator('#sfFolderPath').fill('C:/temp/slack_test');
    await expect(page.locator('#sfDownloadBtn')).toBeEnabled();
    await page.locator('#sfDownloadBtn').click();

    await step(page, 'Files queue opens → click a row → convert');
    await expect(page.locator('#filesTab')).toBeVisible();
    const row = page.locator('.sf-q-trow').first();
    await expect(row).toBeVisible();
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
    await step(page, 'Slack file: Uploaded → Converted → Downloaded ✓');
  });

  test('Refresh re-queries the bot channels; picking a channel resets a stale list', async ({ page }) => {
    await page.locator('#sfListBtn').click();
    await expect(page.locator('#sfTableWrap')).toBeVisible();
    // switching the channel clears the stale list (forces a fresh List)
    await page.locator('#sfSlackChannel').selectOption('C0PUB');
    await expect(page.locator('#sfTableWrap')).toBeHidden();
    // Refresh re-pulls the channel list (still 2 options from the stub)
    await page.locator('#sfSlackRefresh').click();
    await expect(page.locator('#sfSlackChannel option')).toHaveCount(2);
    // Public/Private filter narrows the cached list (stub has 1 private + 1 public)
    await page.locator('#sfSlackVis').selectOption('private');
    await expect(page.locator('#sfSlackChannel option')).toHaveCount(1);
    await page.locator('#sfSlackVis').selectOption('public');
    await expect(page.locator('#sfSlackChannel option')).toHaveCount(1);
    await page.locator('#sfSlackVis').selectOption('all');
    await expect(page.locator('#sfSlackChannel option')).toHaveCount(2);
  });
});
