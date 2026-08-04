'use strict';
// Email Queue module e2e (ported from src/salesforce_email_queue_proof_of_concept/e2e/app.spec.js).
// The POC was a standalone vanilla SPA with its OWN login (#u/#p) and a #left/#mid/#right 3-pane shell;
// in the platform that login is gone — the shared auth.setup.js signs in once and every spec reuses that
// storageState (see e2e/playwright.config.js + e2e/auth.setup.js). So this tests what the React module
// actually owns under /salesforce/email-queue: the queue rail, listing a case, opening its thread + the
// AI response panel, and the shell theme toggle. All /api/salesforce-email-queue/* calls are STUBBED so
// no Salesforce / AI key / DB is needed. Structure mirrors e2e/salesforce_merge/smoke.spec.js.
//   npm run usat_apps_e2e   (after: npx playwright install chromium)
const { test, expect } = require('@playwright/test');

// Canned payloads mirror the POC's stub shapes (queue/statuses/status-counts/cases/thread) plus the
// config + ai/models the platform page needs on load (store.init() pulls config, queues, statuses,
// ai/models and corrections; selecting a queue pulls status-counts; View pulls cases; a case pulls thread).
const QUEUE = { id: '00GX', name: 'Coaching', open_count: 3 };
const STATUSES = ['New', 'Working', 'Closed'];
const BY_STATUS = { New: 3, Closed: 1 };
const CASES = [
  {
    case_id: '500A', case_number: '00012345', subject: 'Pre-Race Clinic question',
    status: 'New', message_count: 2, has_attachment: true, modified_mtn: 'Jun 18, 2026 10:00 AM MDT',
  },
];
const THREAD = [
  { id: 'm1', incoming: true, automated: false, from_address: 'coach@example.com', message_date_mtn: 'Jun 18 09:00', text_new: 'Do I need to renew?', text_raw: 'Do I need to renew?', attachments: [] },
  { id: 'm2', incoming: false, automated: false, from_address: 'noreply@usat.org', message_date_mtn: 'Jun 18 09:30', text_new: 'Thanks for reaching out.', text_raw: 'Thanks for reaching out.', attachments: [] },
];
const MODELS = [{ model: 'claude-e2e', label: 'Claude', provider: 'anthropic', is_default: true }];

// One catch-all stub for the whole namespace so any page renders deterministically. ai/models returns a
// bare JSON array (the client does `Array.isArray(list) ? list : []`); everything else is an object.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/salesforce-email-queue/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    let body = { ok: true };
    if (p.endsWith('/config')) body = { ok: true, sf_env: 'prod', show_test_banner: false };
    else if (p.endsWith('/queues')) body = { ok: true, queues: [QUEUE], instance_url: '' };
    else if (p.endsWith('/statuses')) body = { ok: true, statuses: STATUSES };
    else if (p.endsWith('/status-counts')) body = { ok: true, by_status: BY_STATUS };
    else if (p.endsWith('/cases')) body = { ok: true, cases: CASES };
    else if (p.endsWith('/thread')) body = { ok: true, thread: THREAD };
    else if (p.endsWith('/context')) body = { ok: true, files: [], knowledge_chars: 0 };
    else if (p.endsWith('/corrections')) body = { ok: true, corrections: [] };
    else if (p.endsWith('/ai/models')) body = MODELS;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

// POC "login renders the 3-pane shell" -> adapted: the module's OWN queue rail renders under the shell.
test('queue rail renders under the platform shell with a back link', async ({ page }) => {
  await page.goto('/salesforce/email-queue');
  const rail = page.locator('nav.siderail[aria-label="Email Queue"]');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('link', { name: /USAT Apps/ })).toBeVisible();        // back link to the platform
  await expect(rail.getByRole('heading', { name: /Queue & filters/ })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// POC "selecting a queue lists a numbered case with chips" -> adapted: pick queue, View, assert the row.
test('selecting a queue and clicking View lists a numbered case', async ({ page }) => {
  await page.goto('/salesforce/email-queue');
  const rail = page.locator('nav.siderail[aria-label="Email Queue"]');
  await rail.locator('select').first().selectOption(QUEUE.id);   // the Queue picker is the first rail select
  await rail.getByRole('button', { name: 'View', exact: true }).click();
  const row = page.locator('.eq-case').first();
  await expect(row).toContainText('Pre-Race Clinic question');   // subject
  await expect(row.locator('.eq-casenum')).toHaveText('1');      // numbered chip (POC's .num)
  await expect(row).toContainText('00012345');                   // case number (rendered as "· #00012345")
  await expect(row).toContainText('attachment');                 // attachment chip
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// POC "opening a case shows the sticky header and AI cards (only Draft expanded)" -> adapted to the React
// thread header (.eq-thead) + AI panel (.eq-ai): Card 1 expanded (Draft button shown), Ask card collapsed.
test('opening a case shows the thread header and the AI response panel', async ({ page }) => {
  await page.goto('/salesforce/email-queue');
  const rail = page.locator('nav.siderail[aria-label="Email Queue"]');
  await rail.locator('select').first().selectOption(QUEUE.id);
  await rail.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('.eq-casebody').first().click();            // open the case -> loads the thread
  await expect(page.locator('.eq-thead')).toContainText('Case 00012345');
  const ai = page.locator('.eq-ai');
  await expect(ai.getByRole('heading', { name: 'AI suggested response' })).toBeVisible();   // Card 1
  await expect(ai.getByRole('button', { name: /Draft reply/ })).toBeVisible();              // Card 1 body expanded
  await expect(ai.getByRole('heading', { name: 'Ask a question' })).toBeVisible();          // Card 2 head present
  await expect(page.getByPlaceholder('Ask a question about this case…')).toHaveCount(0);     // but Card 2 body collapsed
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// POC "theme toggle sets data-theme" -> carried over verbatim: the platform shell's ThemeToggle has the
// same [data-theme-toggle] hook and writes data-theme ('light'|'dark') on <html> (web/src/lib/theme.js).
test('theme toggle sets data-theme on <html>', async ({ page }) => {
  await page.goto('/salesforce/email-queue');
  await page.locator('[data-theme-toggle]').first().click();
  const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(t);
});
