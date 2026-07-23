'use strict';
// submit_check.js — READ-ONLY diagnostic. Logs in, opens + fills the form, then INSPECTS the Submit
// button, the <form>, and the anti-forgery tokens — WITHOUT ever clicking Submit. Use this to confirm
// the runner is targeting the real submit control and the form is POST-ready, without sending anything.
//
//   node src/usat_apps/modules/event_coi/submit_check.js            # headless
//   HEADLESS=0 node src/usat_apps/modules/event_coi/submit_check.js # watch the browser
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
const session = require('./store/portal_session');
const { fillCertificate } = require('./store/fill_certificate');

const REQ = {
  event: { sanctionId: '123456', eventName: 'Summit Trail Test Race', eventLocationName: 'Riverside Test Park', eventAddress: '123 Example Avenue, Testville, CO 80000', eventStartDate: '08/16/2026', eventEndDate: '08/21/2026' },
  requestor: { name: 'Test Requestor', email: 'callasteven@gmail.com', phone: '555-010-2026' },
  options: { additionalInsured: true, waiverOfSubrogation: true, contract: 'yes', relationship: 'landlord', additionalInfo: 'SUBMIT CHECK - do not submit.', delivery: 'requestor' },
};
const HOLDER = { name: 'Jane Testerson', address: '100 Sample Street', city: 'Testville', state: 'CO', zip: '80000', email: 'callasteven@gmail.com' };

async function inspectSubmit(page, label) {
  const sub = page.getByRole('button', { name: 'Submit' });
  const count = await sub.count();
  console.log('\n  [' + label + "] getByRole('button', { name: 'Submit' }) matched " + count + ' element(s):');
  for (let i = 0; i < count; i++) {
    const el = sub.nth(i);
    const tag = await el.evaluate((n) => n.tagName);
    const type = await el.evaluate((n) => n.getAttribute('type'));
    const text = ((await el.textContent()) || '').trim().slice(0, 40);
    const visible = await el.isVisible();
    const enabled = await el.isEnabled();
    const inForm = await el.evaluate((n) => !!n.closest('form'));
    console.log('     #' + i + ': <' + tag + ' type=' + type + '> "' + text + '"  visible=' + visible + ' enabled=' + enabled + ' insideForm=' + inForm);
  }
  return count;
}

(async () => {
  const headless = process.env.HEADLESS !== '0';
  console.log('event_coi SUBMIT CHECK - login -> open form -> fill -> INSPECT submit (NO submit click)\n');
  const { browser, page } = await session.launch({ headless });
  try {
    await session.login(page); console.log('  logged in:', page.url());
    await session.openCertificateForm(page); console.log('  opened form:', page.url());
    await fillCertificate(page, REQ, HOLDER); console.log('  filled test holder (NOT submitted)');

    await inspectSubmit(page, 'after fill');

    const dom = await page.evaluate(() => {
      const arr = (sel) => Array.from(document.querySelectorAll(sel));
      const btns = arr('button').map((b) => ({ type: b.type, text: (b.textContent || '').trim().slice(0, 40), id: b.id, visible: !!b.offsetParent, disabled: b.disabled }));
      const ins = arr('input[type=submit],input[type=button],input[type=image]').map((i) => ({ type: i.type, value: i.value, id: i.id, visible: !!i.offsetParent }));
      const forms = arr('form').map((f) => ({ id: f.id, action: f.getAttribute('action'), method: (f.getAttribute('method') || 'get') }));
      const tok = document.querySelector('input[name="__RequestVerificationToken"]');
      const fk = document.querySelector('input[name="FormKey"], input[name*="FormKey"], input[id*="FormKey"]');
      return { btns, ins, forms, token: tok ? { present: true, len: (tok.value || '').length } : { present: false }, formKey: fk ? { present: true, name: fk.name, value: (fk.value || '').slice(0, 24) } : { present: false } };
    });
    console.log('\n  --- all <button> ---'); dom.btns.forEach((b) => console.log('     <button type=' + b.type + '> "' + b.text + '"  id=' + (b.id || '') + ' visible=' + b.visible + ' disabled=' + b.disabled));
    console.log('  --- all <input type=submit|button|image> ---'); if (!dom.ins.length) console.log('     (none)'); dom.ins.forEach((i) => console.log('     <input type=' + i.type + ' value="' + i.value + '"> id=' + (i.id || '') + ' visible=' + i.visible));
    console.log('  --- <form>(s) ---'); dom.forms.forEach((f) => console.log('     form id=' + (f.id || '') + ' method=' + f.method + ' action=' + (f.action || '(none / JS handler)')));
    console.log('  --- anti-forgery / form key ---');
    console.log('     __RequestVerificationToken:', dom.token.present ? 'present (len ' + dom.token.len + ')' : 'MISSING');
    console.log('     FormKey:', dom.formKey.present ? 'present (' + dom.formKey.name + '=' + dom.formKey.value + '...)' : 'MISSING');

    // Replicate the real run: take the full-page screenshot (which injects the tooltip-hide <style>),
    // then re-check the submit button is still visible/clickable (catches any accidental hide).
    try { await session.fullPageShot(page); } catch (_) { /* ignore */ }
    await inspectSubmit(page, 'after screenshot (real-run sequence)');

    console.log('\n  SUBMIT CHECK complete. Nothing was submitted.');
    console.log('  Expected: exactly 1 match -> <BUTTON type=submit> "Submit", visible=true enabled=true insideForm=true,');
    console.log('  a <form> with a POST action, and __RequestVerificationToken present. Share this output if anything differs.');
  } catch (e) {
    console.error('\n  SUBMIT CHECK failed:', e.message);
    process.exitCode = 1;
  } finally {
    if (headless) await browser.close();
    else console.log('\n  (browser left open - inspect, then close it)');
  }
})();
