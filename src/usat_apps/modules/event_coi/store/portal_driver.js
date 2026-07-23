'use strict';
// portal_driver.js — the "real" driver run_control uses to talk to the CSR24 portal: a thin adapter
// over portal_session (login/open) + fill_certificate (fill/submit). run_control depends only on this
// interface, so tests can swap in a fake driver and exercise the loop with no browser. Each method
// takes/returns a small session handle { browser, context, page }.
const session = require('./portal_session');
const { fillCertificate, submitCertificate } = require('./fill_certificate');

module.exports = {
  async open({ headless = true } = {}) {
    const { browser, context, page } = await session.launch({ headless });
    return { browser, context, page };
  },
  async login(s) { await session.login(s.page); },
  async openForm(s) { await session.openCertificateForm(s.page); },
  async fill(s, request, holder) { await fillCertificate(s.page, request, holder); },
  async screenshot(s) {
    const buf = await session.fullPageShot(s.page);   // expands inner scroll containers so the WHOLE form is captured
    return 'data:image/png;base64,' + buf.toString('base64');
  },
  // Click Submit and confirm success by the confirmation URL (/mvc/FormGenerator/FormSubmitted). On
  // anything else (validation error, timeout), return the visible error text so the run can log it.
  async submit(s) {
    try {
      await submitCertificate(s.page);
      await s.page.waitForURL(/FormSubmitted/i, { timeout: 20000 });
      // The portal issues no confirmation number — reaching FormSubmitted IS the acknowledgment.
      const confirmation = 'Request Submitted';
      // Screenshot of the confirmation page (proof of submission) for the log's confirmation link.
      let confirmShot = null;
      try { confirmShot = 'data:image/png;base64,' + (await session.fullPageShot(s.page)).toString('base64'); } catch (_) { /* ignore */ }
      return { ok: true, confirmation, confirmShot };
    } catch (e) {
      let error = 'submission did not reach the confirmation page';
      try {
        const t = await s.page.locator('.field-validation-error, .validation-summary-errors, .error, [class*="error"]').first().innerText({ timeout: 1000 });
        if (t && t.trim()) error = t.trim().replace(/\s+/g, ' ').slice(0, 200);
      } catch (_) { /* no visible error text */ }
      return { ok: false, error };
    }
  },
  async close(s) { try { await s.browser.close(); } catch (_) { /* already gone */ } },
};
