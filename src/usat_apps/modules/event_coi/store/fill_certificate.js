'use strict';
// fill_certificate.js — fill the Race Director & Sanctioned Events Certificate Form for ONE holder,
// using the once-entered request (event + requestor + coverage/delivery options) plus the holder row.
// Field `name` attributes are from the recon (RECON_portal_form_map.md) and are stable per FormKey=3.
// fillCertificate() never submits; submitCertificate() is called separately (Phase 4) after review.

// Text inputs (unique name attrs).
const TEXT = {
  sanctionId: '0-0-56', eventName: '0-0-37', eventLocationName: '0-0-38', eventAddress: '0-0-39',
  eventStartDate: '0-0-41', eventEndDate: '0-0-58',
  reqName: '0-0-59', reqEmail: '0-0-60', reqPhone: '0-0-61',
  holderName: '0-0-45', holderAddress: '0-0-46', holderCity: '0-0-48', holderState: '0-0-49',
  holderZip: '0-0-50', holderEmail: '0-0-62',
  additionalInfo: '0-0-55',
  coverageOtherText: '0-4-51-text', relationshipOtherText: '0-2-53-text', deliveryOtherText: '0-0-54-text',
};
// Coverage checkboxes (unique name attrs).
const COVERAGE = { additionalInsured: '0-0-51', aiPrimaryNonContrib: '0-1-51', waiverOfSubrogation: '0-2-51', noticeOfCancellation: '0-3-51', coverageOther: '0-4-51' };
// Relationship "check only 1" checkboxes (unique name attrs).
const REL = { landlord: '0-0-53', stateGov: '0-1-53', other: '0-2-53' };
// Radio groups share one name; select by option order. Written contract: 0-0-52 [Yes, No].
const CONTRACT_IDX = { yes: 0, no: 1 };
// Delivery: 0-0-54 [Deliver to Requestor, Deliver to Requestor & Certificate Holder, Other].
const DELIVERY_IDX = { requestor: 0, requestorAndHolder: 1, other: 2 };

async function setText(page, name, value) {
  if (value == null || value === '') return;
  const el = page.locator(`[name="${name}"]`).first();
  if (await el.count()) await el.fill(String(value));
}
async function setCheckbox(page, name, checked) {
  if (!checked) return;
  const el = page.locator(`input[name="${name}"]`).first();
  if (await el.count()) await el.check().catch(() => {});
}
async function checkRadioNth(page, name, idx) {
  if (idx == null) return;
  const els = page.locator(`input[name="${name}"]`);
  if (await els.count() > idx) await els.nth(idx).check().catch(() => {});
}

async function fillCertificate(page, request, holder) {
  const e = (request && request.event) || {};
  const r = (request && request.requestor) || {};
  // Per-holder coverage: use this holder's own options when present (per-holder mode); otherwise the
  // once-entered request.options (same-for-all mode).
  const o = (holder && holder.options) || (request && request.options) || {};

  // Event
  await setText(page, TEXT.sanctionId, e.sanctionId);
  await setText(page, TEXT.eventName, e.eventName);
  await setText(page, TEXT.eventLocationName, e.eventLocationName);
  await setText(page, TEXT.eventAddress, e.eventAddress);
  await setText(page, TEXT.eventStartDate, e.eventStartDate);
  await setText(page, TEXT.eventEndDate, e.eventEndDate);
  // Requestor
  await setText(page, TEXT.reqName, r.name);
  await setText(page, TEXT.reqEmail, r.email);
  await setText(page, TEXT.reqPhone, r.phone);
  // Holder
  await setText(page, TEXT.holderName, holder.name);
  await setText(page, TEXT.holderAddress, holder.address);
  await setText(page, TEXT.holderCity, holder.city);
  await setText(page, TEXT.holderState, holder.state);
  await setText(page, TEXT.holderZip, holder.zip);
  await setText(page, TEXT.holderEmail, holder.email);
  // Coverage
  await setCheckbox(page, COVERAGE.additionalInsured, o.additionalInsured);
  await setCheckbox(page, COVERAGE.aiPrimaryNonContrib, o.aiPrimaryNonContrib);
  await setCheckbox(page, COVERAGE.waiverOfSubrogation, o.waiverOfSubrogation);
  await setCheckbox(page, COVERAGE.noticeOfCancellation, o.noticeOfCancellation);
  if (o.coverageOther) { await setCheckbox(page, COVERAGE.coverageOther, true); await setText(page, TEXT.coverageOtherText, o.coverageOtherText); }
  // Written contract (radio)
  await checkRadioNth(page, '0-0-52', CONTRACT_IDX[o.contract]);
  // Relationship (checkbox)
  if (o.relationship && REL[o.relationship]) await setCheckbox(page, REL[o.relationship], true);
  if (o.relationship === 'other') await setText(page, TEXT.relationshipOtherText, o.relationshipOtherText);
  // Additional information
  await setText(page, TEXT.additionalInfo, o.additionalInfo);
  // Delivery method (radio)
  await checkRadioNth(page, '0-0-54', DELIVERY_IDX[o.delivery]);
  if (o.delivery === 'other') await setText(page, TEXT.deliveryOtherText, o.deliveryOtherText);
}

async function submitCertificate(page) {
  await page.getByRole('button', { name: 'Submit' }).click();
}

module.exports = { fillCertificate, submitCertificate, TEXT, COVERAGE, REL, CONTRACT_IDX, DELIVERY_IDX };
