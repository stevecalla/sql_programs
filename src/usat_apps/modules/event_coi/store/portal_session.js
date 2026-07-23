'use strict';
// portal_session.js — Playwright session against the EPIC/CSR24 portal. Launches Chromium, logs in with
// the .env credentials, and opens the Race Certificate Request form. Selectors verified in the recon
// (see plans_and_notes/insurance_coi/RECON_portal_form_map.md). Reads process.env (the platform server
// and the dry-run CLI both load the repo-root .env before requiring this).

const LOGIN_URL = process.env.INSURANCE_PORTAL_URL || 'https://portalv03.csr24.com/mvc/1239375044';
const FORM_URL = 'https://portalv03.csr24.com/mvc/Portal/Link/461492185'; // 302 -> FormGenerator/Display?FormKey=3
const USER = () => process.env.INSURANCE_PORTAL_USER || '';
const PW = () => process.env.INSURANCE_PORTAL_PW || '';

// The Chromium launcher — from `playwright` if present, else `@playwright/test` (a devDependency that
// re-exports it). Chromium itself is installed via `npx playwright install chromium`.
function getChromium() {
  try { return require('playwright').chromium; } catch (e) { /* try next */ }
  try { return require('@playwright/test').chromium; } catch (e) { /* neither */ }
  throw new Error('Playwright not found — run: npm i -D @playwright/test && npx playwright install chromium');
}

async function launch({ headless = true } = {}) {
  const browser = await getChromium().launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { browser, context, page };
}

async function login(page) {
  if (!USER() || !PW()) throw new Error('Missing INSURANCE_PORTAL_USER / INSURANCE_PORTAL_PW in .env');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Username').fill(USER());
  await page.getByLabel('Password').fill(PW());
  await page.getByRole('button', { name: 'Login' }).click();
  // Success lands on the portal home; wait for that, else surface a clear error.
  await page.waitForURL(/\/mvc\/Portal\/Index/, { timeout: 30000 }).catch(() => {
    throw new Error('Login did not reach the portal home — check the credentials in .env.');
  });
}

async function openCertificateForm(page) {
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
  // The generated form loads its fields asynchronously — wait for the Holder Name field to exist.
  await page.waitForSelector('[name="0-0-45"]', { timeout: 30000 });
}

module.exports = { launch, login, openCertificateForm, LOGIN_URL, FORM_URL };
