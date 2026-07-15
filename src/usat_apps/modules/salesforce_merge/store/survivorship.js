'use strict';
// Single source of truth for merge SURVIVORSHIP — the value each field ends up with on the surviving
// (master) record. Shared so the Select Merges "Field survivorship" preview and the actual execute
// agree byte-for-byte (previously they diverged: the UI resolved overrides, the execute did not).
//
// CRITICAL: an entry in `overrides` is an ACCOUNT ID — "take THIS record's value for this field" —
// exactly what the Select Merges dropdown stores (its <option value> is the account id). It is NOT a
// literal field value. Writing the raw override as the value is the bug that put account ids into
// PersonEmail / member number.
//
// Precedence per field: override (chosen record's value) > survivor's own non-blank value >
// backfill from the first losing record with a non-blank value.

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
// Structural / system keys that are never survivorship fields.
const SKIP = new Set(['account', 'contact', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'attributes']);

// Resolve one field to { value, sourceId, status }. status: override | kept | conflict | filled | empty.
function resolve_value(accounts, survivorId, overrides, field) {
  const list = Array.isArray(accounts) ? accounts : [];
  const master = list.find((a) => a.account === survivorId) || {};
  const losers = list.filter((a) => a.account !== survivorId);
  const ovId = overrides ? overrides[field] : undefined;
  if (!blank(ovId)) {
    const donor = list.find((a) => a.account === ovId);
    return { value: donor ? donor[field] : '', sourceId: ovId, status: 'override' };
  }
  const mv = master[field];
  if (!blank(mv)) {
    const conflict = losers.some((l) => !blank(l[field]) && String(l[field]).trim() !== String(mv).trim());
    return { value: mv, sourceId: survivorId, status: conflict ? 'conflict' : 'kept' };
  }
  const fill = losers.find((l) => !blank(l[field]));
  return { value: fill ? fill[field] : '', sourceId: fill ? fill.account : null, status: fill ? 'filled' : 'empty' };
}

// The map of fields to WRITE onto the master before the merge: only fields whose resolved value is
// non-blank AND differs from the master's current value. (Blank/unchanged fields need no write.)
function resolve_master_fields(accounts, survivorId, overrides) {
  const list = Array.isArray(accounts) ? accounts : [];
  const master = list.find((a) => a.account === survivorId) || {};
  const fields = new Set();
  for (const a of list) for (const k of Object.keys(a)) if (!SKIP.has(k)) fields.add(k);
  const out = {};
  for (const f of fields) {
    const { value } = resolve_value(list, survivorId, overrides, f);
    if (blank(value)) continue;
    const cur = master[f] === undefined || master[f] === null ? '' : master[f];
    if (String(value) !== String(cur)) out[f] = value;
  }
  return out;
}

module.exports = { resolve_value, resolve_master_fields, blank, SKIP };
