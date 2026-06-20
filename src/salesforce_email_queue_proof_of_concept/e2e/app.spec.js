'use strict';
// Browser E2E for the single-page UI. All /api/* calls are stubbed via route interception, so the
// test needs no Salesforce connection or AI key - it exercises the UI behavior only.
const { test, expect } = require('@playwright/test');

const QUEUE = { id: '00GX', name: 'Coaching', open_count: 3 };
const CASES = [{ case_id: '500A', case_number: '00012345', subject: 'Pre-Race Clinic question', status: 'New', message_count: 2, has_attachment: true, modified_mtn: 'Jun 18, 2026 10:00 AM MDT' }];
const THREAD = [
  { id: 'm1', incoming: true, automated: false, from_address: 'coach@example.com', message_date_mtn: 'Jun 18 09:00', text_new: 'Do I need to renew?', text_raw: 'Do I need to renew?', attachments: [] },
  { id: 'm2', incoming: false, automated: false, from_address: 'noreply@usat.org', message_date_mtn: 'Jun 18 09:30', text_new: 'Thanks for reaching out.', text_raw: 'Thanks for reaching out.', attachments: [] }
];

async function stub(page) {
  await page.route('**/api/**', function (route) {
    const u = route.request().url();
    function json(o) { return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); }
    if (u.includes('/api/login')) return json({ ok: true, user: 'e2e' });
    if (u.includes('/api/me')) return json({ ok: true, user: 'e2e' });
    if (u.includes('/api/queues')) return json({ ok: true, queues: [QUEUE] });
    if (u.includes('/api/statuses')) return json({ ok: true, statuses: ['New', 'Working', 'Closed'] });
    if (u.includes('/api/status-counts')) return json({ ok: true, by_status: { New: 3, Closed: 1 } });
    if (u.includes('/api/cases')) return json({ ok: true, cases: CASES });
    if (u.includes('/api/thread')) return json({ ok: true, thread: THREAD });
    if (u.includes('/api/context')) return json({ ok: true, files: [] });
    return json({ ok: true });
  });
}

async function login(page) {
  await stub(page);
  await page.goto('/');
  await page.fill('#u', 'e2e'); await page.fill('#p', 'e2e');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.app-header')).toContainText('USAT Email Queue Assistant');
}

test('login renders the 3-pane shell', async function ({ page }) {
  await login(page);
  await expect(page.locator('#left')).toBeVisible();
  await expect(page.locator('#mid')).toBeVisible();
  await expect(page.locator('#right')).toBeVisible();
});

test('selecting a queue lists a numbered case with chips', async function ({ page }) {
  await login(page);
  await page.selectOption('#left select', QUEUE.id);
  const row = page.locator('#caseList .row').first();
  await expect(row).toContainText('00012345') ;
  await expect(row.locator('.num')).toHaveText('1');
  await expect(row).toContainText('attachment');
});

test('opening a case shows the sticky header and AI cards (only Draft expanded)', async function ({ page }) {
  await login(page);
  await page.selectOption('#left select', QUEUE.id);
  await page.locator('#caseList .row .body').first().click();
  await expect(page.locator('.thread-head')).toContainText('Case 00012345');
  // Draft card body visible; the other cards start collapsed.
  await expect(page.locator('#right')).toContainText('AI suggested response');
  const collapsed = page.locator('#right .card.collapsed .cardhead');
  await expect(collapsed).toContainText(['Ask a question']);
});

test('theme toggle sets data-theme', async function ({ page }) {
  await login(page);
  await page.locator('[data-theme-toggle]').first().click();
  const t = await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
  expect(['light', 'dark']).toContain(t);
});
