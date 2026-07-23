// coverage.js — per-holder coverage model shared by the holder grid, exports, and run start.
// One column set (identity first, then Step-2 order), a display helper, and holderOptions() which turns
// a holder's flat coverage fields into the options object the server fill expects. Keep the field keys
// in sync with EMPTY_OPTS in Section.jsx and the parser in store/holder_parse.js.

export const CONTRACT_OPTS = [['', '—'], ['yes', 'Yes'], ['no', 'No']];
export const REL_OPTS = [['', '—'], ['landlord', 'Landlord / Venue'], ['stateGov', 'Gov / Permit Agency'], ['other', 'Other']];
export const DELIVERY_OPTS = [['', '—'], ['requestor', 'Requestor'], ['requestorAndHolder', 'Requestor & Holder'], ['other', 'Other']];

// Full grid column set — identity, then Step-2 order: coverage → contract → relationship → info → delivery.
export const HOLDER_COLUMNS = [
  { key: 'name', label: 'Holder Name', type: 'text', req: true, w: 220, maxLen: 100 },
  { key: 'address', label: 'Address', type: 'text', w: 150, maxLen: 100 },
  { key: 'city', label: 'City', type: 'text', w: 150, maxLen: 50 },
  { key: 'state', label: 'State', type: 'text', w: 56, maxLen: 2 },
  { key: 'zip', label: 'Zip', type: 'text', w: 72, maxLen: 7 },
  { key: 'email', label: 'Holder Email', type: 'text', req: true, w: 180, maxLen: 100 },
  { key: 'additionalInsured', label: "Add'l Insured", type: 'check', w: 96 },
  { key: 'aiPrimaryNonContrib', label: 'AI P&NC', type: 'check', w: 84 },
  { key: 'waiverOfSubrogation', label: 'Waiver of Subrog.', type: 'check', w: 110 },
  { key: 'noticeOfCancellation', label: 'Notice of Cancel', type: 'check', w: 108 },
  { key: 'coverageOtherText', label: 'Coverage – Other', type: 'text', w: 150, maxLen: 100 },
  { key: 'contract', label: 'Written Contract', type: 'select', w: 120, options: CONTRACT_OPTS },
  { key: 'relationship', label: 'Relationship', type: 'select', w: 160, options: REL_OPTS },
  { key: 'relationshipOtherText', label: 'Relationship – Other', type: 'text', w: 160, maxLen: 150 },
  { key: 'additionalInfo', label: 'Additional Info', type: 'text', w: 170, maxLen: 500 },
  { key: 'delivery', label: 'Delivery Method', type: 'select', w: 160, options: DELIVERY_OPTS },
  { key: 'deliveryOtherText', label: 'Delivery – Other', type: 'text', w: 140, maxLen: 100 },
];

// The coverage/relationship/delivery field keys (everything after the 6 identity columns).
export const COVERAGE_KEYS = HOLDER_COLUMNS.slice(6).map((c) => c.key);

// Does this holder carry any per-holder coverage data? Used to auto-pick per-holder mode on upload.
export function hasAnyCoverage(h) {
  return COVERAGE_KEYS.some((k) => { const v = h && h[k]; return v === true || (typeof v === 'string' && v.trim() !== ''); });
}
export function anyHolderHasCoverage(holders) { return (holders || []).some(hasAnyCoverage); }

// Display/search string for a column (label for selects, Yes/'' for checks, raw for text).
export function cellDisplay(h, col) {
  const v = h[col.key];
  if (col.type === 'check') return v ? 'Yes' : '';
  if (col.type === 'select') { const o = (col.options || []).find((x) => x[0] === (v || '')); return o && o[0] ? o[1] : ''; }
  return String(v == null ? '' : v);
}

// Flat holder coverage fields -> the options object the server fill_certificate expects.
export function holderOptions(h) {
  h = h || {};
  const t = (k) => String(h[k] == null ? '' : h[k]);
  return {
    additionalInsured: !!h.additionalInsured,
    aiPrimaryNonContrib: !!h.aiPrimaryNonContrib,
    waiverOfSubrogation: !!h.waiverOfSubrogation,
    noticeOfCancellation: !!h.noticeOfCancellation,
    coverageOther: !!t('coverageOtherText').trim(),
    coverageOtherText: t('coverageOtherText'),
    contract: t('contract'),
    relationship: t('relationship'),
    relationshipOtherText: t('relationshipOtherText'),
    additionalInfo: t('additionalInfo'),
    delivery: t('delivery'),
    deliveryOtherText: t('deliveryOtherText'),
  };
}
