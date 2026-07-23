'use strict';
// pending_check.js — READ-ONLY. Logs in, opens the form, finds the real "Pending Requests" LINK in the
// nav drawer (reads its href), and navigates there with page.goto. Never clicks Submit / never submits.
//   HEADLESS=0 node src/usat_apps/modules/event_coi/pending_check.js
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
const session = require('./store/portal_session');

(async () => {
  const headless = process.env.HEADLESS !== '0';
  const { browser, page } = await session.launch({ headless });
  try {
    await session.login(page);
    console.log('  logged in:', page.url());
    await session.openCertificateForm(page);
    console.log('  form open:', page.url());

    // Find every element whose text/label mentions "Pending Requests" and expose its link target.
    const cands = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, [role="menuitem"], [data-url], [data-href]'));
      const url = (e) => e.getAttribute('href') || e.getAttribute('data-url') || e.getAttribute('data-href')
        || (e.getAttribute('onclick') && ((e.getAttribute('onclick').match(/['"]((?:https?:\/\/|\/)[^'"]+)['"]/) || [])[1]))
        || (e.getAttribute('formaction'));
      return els
        .filter((e) => /pending\s*requests/i.test(e.textContent || e.getAttribute('aria-label') || ''))
        .map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), url: url(e) }))
        .filter((c) => c.url && !/^#/.test(c.url))
        .slice(0, 10);
    });
    console.log('  Pending Requests link candidates:', JSON.stringify(cands));

    const target = cands.length ? cands[0].url : null;
    if (!target) {
      console.log('\n  Could not find a Pending Requests link URL automatically.');
      console.log('  The browser is logged in and left open — just click the ☰ menu (top-left) then "Pending Requests" to view it. No submit involved.');
    } else {
      const url = new URL(target, page.url()).href;
      console.log('  navigating (goto, no submit) ->', url);
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('  goto note:', e.message));
      await page.waitForTimeout(1500);
      console.log('  pending page:', page.url());
      const out = path.join(__dirname, 'dry_run_screens');
      fs.mkdirSync(out, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const p = path.join(out, stamp + '_pending_requests.png');
      fs.writeFileSync(p, await page.screenshot({ fullPage: true }));
      console.log('  screenshot ->', p);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('table tr')).map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 60));
      console.log('\n  --- Pending Requests rows ---');
      if (!rows.length) console.log('  (no table rows — see the screenshot / open window)');
      rows.forEach((r) => console.log('   ', r.slice(0, 180)));
    }
    console.log('\n  Done. Nothing was submitted.');
  } catch (e) {
    console.error('  failed:', e.message);
    process.exitCode = 1;
  } finally {
    if (headless) await browser.close();
    else console.log('\n  (browser left open — inspect, then close it)');
  }
})();
