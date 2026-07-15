'use strict';
// Restore diff / drift check — compares the pre-merge SNAPSHOT of a merged set's survivor against its
// CURRENT live Salesforce state, field by field, so a reviewer can see exactly what a restore would
// change (and whether anything drifted since the merge). Read-only: never writes to Salesforce.
//
//   · "match"   — current value already equals the snapshot (restore would make no change to this field)
//   · "differ"  — current value differs from the snapshot (restore would reset it to the snapshot value;
//                 or someone edited the field after the merge — the reviewer decides)
//   · "missing" — the survivor record couldn't be read live (deleted / inaccessible)
//
// v1 is all-or-nothing (restore resets every non-empty snapshot field), so the diff is scoped to exactly
// the fields restore would touch. Loser records are reported by recoverability state, not field diff
// (they're deleted by the merge; their "current" is the Recycle-Bin state).
const mqueue = require('./merge_queue');
const snapshot = require('./merge_snapshot');
const mrestore = require('./merge_restore');
const sfread = require('./salesforce_read');
const dashboard = require('./duplicates_read');

// Fields restore never touches (identity / system / person-account halves) — mirrors
// merge_restore.master_reset_fields so the diff shows only what a restore would actually change.
const SKIP = new Set(['account', 'contact', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate',
  'attributes', 'PersonContactId', 'IsPersonAccount', 'IsDeleted', 'MasterRecordId', 'SystemModstamp']);

// Normalize a value for equality: blank-ish -> '', ZIP/postal -> first 5 digits, else trimmed +
// whitespace-collapsed + lower-cased. So trivial formatting differences don't read as drift.
function norm(v, field) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (s === '') return '';
  const f = String(field || '').toLowerCase();
  if (f.includes('zip') || f.includes('postal')) return s.replace(/[^0-9]/g, '').slice(0, 5);
  return s.replace(/\s+/g, ' ').toLowerCase();
}
function values_equal(a, b, field) { return norm(a, field) === norm(b, field); }

// The snapshot fields a restore would reset: non-SKIP keys with a non-empty snapshot value.
function comparable_keys(master) {
  return Object.keys(master || {}).filter((k) =>
    !SKIP.has(k) && master[k] !== null && master[k] !== undefined && String(master[k]).trim() !== '');
}

// Pure: build the per-field survivor diff. `current` is the live record (object) or null when unreadable.
function build_master_diff(master, current) {
  const keys = comparable_keys(master);
  const hasCurrent = current && typeof current === 'object';
  let matched = 0, differ = 0, missing = 0;
  const rows = keys.map((k) => {
    const before = master[k];
    if (!hasCurrent) { missing += 1; return { field: k, before, after: null, state: 'missing' }; }
    const after = current[k] == null ? '' : current[k];
    const eq = values_equal(before, after, k);
    if (eq) matched += 1; else differ += 1;
    return { field: k, before, after, state: eq ? 'match' : 'differ' };
  });
  return { rows, summary: { matched, differ, missing, total: rows.length }, in_sync: differ === 0 && missing === 0 };
}

// Live diff for one queue entry (a merged set). Reads the snapshot + current survivor + loser states.
async function diff_for_entry(queueId, deps = {}) {
  const Q = deps.queue || mqueue;
  const SN = deps.snapshot || snapshot;
  const R = deps.restore || mrestore;
  const READ = deps.read || sfread;
  const dash = deps.dashboard || dashboard;
  const id = Number(queueId);
  if (!Number.isFinite(id)) return { error: 'invalid id' };

  const all = await Q.list(undefined, 'all');
  const e = (all || []).find((x) => Number(x.id) === id);
  if (!e) return { error: 'merge set not found' };

  const rows = await SN.list_for_entry(id);
  if (!rows || !rows.length) {
    return { queue_id: id, survivor_account: e.survivor_account, survivor_name: e.survivor_name,
      environment: e.environment, status: e.status, error: 'no pre-merge snapshot for this set',
      survivor: { rows: [], summary: { matched: 0, differ: 0, missing: 0, total: 0 }, in_sync: false }, losers: [] };
  }
  const { master, loserIds } = R.from_snapshot(rows, e.survivor_account);

  const ds = await dash.dataset_info().catch(() => null);
  const is_test = !ds || ds.environment !== 'Production';
  const keys = comparable_keys(master);

  // Current live survivor (only the fields we'd compare). Wrapped so a bad field/permission can't 500.
  let current = null; let fetch_error = null;
  try {
    const recs = await READ.fetch_accounts_by_ids([e.survivor_account], { is_test, fields: keys, connect: deps.connect });
    current = (recs && recs[0]) || null;
  } catch (err) { fetch_error = (err && err.message) || 'live fetch failed'; }

  const survivor = build_master_diff(master, current);

  // Loser recoverability state (deleted = recoverable from bin, live = already back, missing = purged).
  let losers = (loserIds || []).map((lid) => ({ id: lid, state: 'unknown' }));
  try {
    const conn = await (deps.connect || READ.default_connect)(is_test);
    const states = await R.account_states(conn, loserIds);
    losers = (loserIds || []).map((lid) => ({ id: lid, state: states[lid] || 'missing' }));
  } catch (err) { /* leave unknown — non-fatal for the field diff */ }

  return {
    queue_id: id, survivor_account: e.survivor_account, survivor_name: e.survivor_name,
    environment: e.environment, status: e.status,
    survivor, losers, survivor_missing: current == null, fetch_error,
    in_sync: survivor.in_sync,
  };
}

module.exports = { diff_for_entry, build_master_diff, comparable_keys, values_equal, norm, SKIP };
