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
  // Fill by input type (robust regardless of how the labels are associated).
  const pass = page.locator('input[type="password"]').first();
  await page.locator('input[type="text"]').first().fill(USER());
  await pass.fill(PW());
  // IMPORTANT: the control that actually submits is an <input type="submit">. The element that carries
  // the "Login" button role is a wrapper and clicking it does NOT submit — so target the input (or Enter).
  const submit = page.locator('input[type="submit"], button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await pass.press('Enter');
  // Success lands on the portal home; wait for that, else surface a clear error.
  try {
    await page.waitForURL(/\/mvc\/Portal\/Index/, { timeout: 30000 });
  } catch (e) {
    throw new Error('Login did not reach the portal home — check INSURANCE_PORTAL_USER / _PW in .env, or the login form changed.');
  }
}

async function openCertificateForm(page) {
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
  // The generated form loads its fields asynchronously — wait for the Holder Name field to exist.
  await page.waitForSelector('[name="0-0-45"]', { timeout: 30000 });
}

// The CSR24 form sits inside an inner scrolling container, so page.screenshot({fullPage}) only grabs
// one viewport of it. Expand every real scroll container to its full height first, then capture — so
// the whole form (banner to Submit) lands in one image. Returns a PNG Buffer.
async function fullPageShot(page) {
  const original = page.viewportSize();
  try {
    // Tall viewport so a viewport-height scroll container reveals the whole form.
    await page.setViewportSize({ width: (original && original.width) || 1440, height: 3200 });
    await page.evaluate(() => {
      const de = document.documentElement, bd = document.body;
      [de, bd].forEach((el) => { if (el) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } });
      // Un-clip the scroll WRAPPERS only. Skip table elements so the form's table-based layout (which
      // holds the coverage/contract/delivery sections) is left intact.
      const SKIP = { TABLE: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1 };
      for (const el of document.querySelectorAll('body *')) {
        if (SKIP[el.tagName]) continue;
        const st = getComputedStyle(el);
        const clips = /(auto|scroll|hidden)/.test(st.overflow) || /(auto|scroll|hidden)/.test(st.overflowY);
        if (clips && el.scrollHeight > el.clientHeight + 4) {
          el.style.overflow = 'visible';
          el.style.overflowY = 'visible';
          el.style.height = 'auto';
          el.style.maxHeight = 'none';
        }
      }
      // Dismiss the portal's field-help tooltips (the "(ie: Name of Park…)" hint bubbles from the "?"
      // icons). They pop on focus/hover and get caught in the capture at random. Blur the active field
      // and force-hide anything tooltip-like so it never bleeds into the screenshot.
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) { /* ignore */ }
      const style = document.createElement('style');
      style.textContent = '[role="tooltip"],.tooltip,.ui-tooltip,.qtip,.popover,.bubble,.tipsy,[class*="tooltip"],[class*="Tooltip"],[id*="tooltip"]{display:none !important;visibility:hidden !important;opacity:0 !important;}';
      document.documentElement.appendChild(style);
    });
    await page.mouse.move(0, 0);     // pull the cursor off any "?" so no hover-tooltip re-appears
    await page.waitForTimeout(250); // let layout settle + tooltips fade
    const form = page.locator('form').first();
    if (await form.count()) return await form.screenshot();
    return await page.screenshot({ fullPage: true });
  } catch (e) {
    return page.screenshot({ fullPage: true });
  } finally {
    try { if (original) await page.setViewportSize(original); } catch (_) { /* ignore */ }
  }
}

module.exports = { launch, login, openCertificateForm, fullPageShot, LOGIN_URL, FORM_URL };
