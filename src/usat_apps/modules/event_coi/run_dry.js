'use strict';
// run_dry.js — Phase-3 DRY RUN. Logs into the CSR24 portal, opens the Race Certificate Request form,
// fills ONE test holder, screenshots each stage, and STOPS. Nothing is ever submitted.
//
//   node src/usat_apps/modules/event_coi/run_dry.js        # headless (screenshots only)
//   HEADLESS=0 node src/usat_apps/modules/event_coi/run_dry.js   # watch the browser live
//
// Screenshots land in modules/event_coi/dry_run_screens/. Use this to confirm the login + navigation +
// field selectors work against the live form before wiring the Phase-4 submit loop.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') }); // repo-root .env
const session = require('./store/portal_session');
const { fillCertificate } = require('./store/fill_certificate');

const TEST_REQUEST = {
  event: { sanctionId: '123456', eventName: 'Summit Trail Test Race', eventLocationName: 'Riverside Test Park', eventAddress: '123 Example Avenue, Testville, CO 80000', eventStartDate: '08/16/2026', eventEndDate: '08/21/2026' },
  requestor: { name: 'Test Requestor', email: 'callasteven@gmail.com', phone: '555-010-2026' },
  options: { additionalInsured: true, waiverOfSubrogation: true, contract: 'yes', relationship: 'landlord', additionalInfo: 'DRY RUN — do not submit.', delivery: 'requestor' },
};
const TEST_HOLDER = { name: 'Jane Testerson', address: '100 Sample Street', city: 'Testville', state: 'CO', zip: '80000', email: 'callasteven@gmail.com' };

(async () => {
  const headless = process.env.HEADLESS !== '0';
  const outDir = path.join(__dirname, 'dry_run_screens');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shot = async (page, name) => { const p = path.join(outDir, `${stamp}_${name}.png`); const buf = await session.fullPageShot(page); fs.writeFileSync(p, buf); console.log('  screenshot ->', p); };

  console.log('event_coi DRY RUN — login -> open form -> fill one holder -> STOP (no submit)\n');
  const { browser, page } = await session.launch({ headless });
  try {
    await session.login(page);
    console.log('  logged in:', page.url());
    await shot(page, '1_after_login');

    await session.openCertificateForm(page);
    console.log('  opened form:', page.url());
    await shot(page, '2_form_blank');

    await fillCertificate(page, TEST_REQUEST, TEST_HOLDER);
    console.log('  filled test holder (NOT submitted)');
    await shot(page, '3_form_filled');

    console.log('\n  DRY RUN complete. Nothing was submitted. Review the screenshots in:\n   ', outDir);
  } catch (e) {
    console.error('\n  DRY RUN failed:', e.message);
    try { await shot(page, 'error'); } catch (_) { /* ignore */ }
    process.exitCode = 1;
  } finally {
    if (headless) await browser.close();
    else console.log('\n  (browser left open so you can inspect — close it when done)');
  }
})();
