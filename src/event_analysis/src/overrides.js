/**
 * overrides.js — Manual event matching overrides (DB-backed).
 *
 * Reads from `event_analysis_overrides` in usat_sales_db and applies three
 * types of override:
 *
 *   force_match    — force two specific events to be matched (sid_baseline + sid_analysis)
 *   force_no_match — prevent a specific event from matching anything (sid_baseline or sid_analysis)
 *   force_segment  — override the segment classification of a matched/unmatched event
 *
 * Applied after automatic matching in analysis.js so manual decisions
 * always take precedence over the fuzzy algorithm.
 *
 * Year scoping: rows with NULL baseline_year + NULL analysis_year are treated
 * as "global" (apply to every comparison). Rows with matching baseline_year +
 * analysis_year apply only to that specific year pair.
 *
 * Lifecycle: only `active = 1` rows are read. `approved` is surfaced in the
 * returned rows so callers can decide what to do with unapproved overrides
 * (build_all.js currently surfaces a warning).
 */

'use strict';

const path   = require('path');
const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');

const VALID_SEGMENTS = new Set([
  'Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return',
]);

const TABLE_NAME = 'event_analysis_overrides';

// ── Event signature helpers (Step 6 — stale-approval detection) ─────────────
//
// At approve time we capture a signature of each targeted event:
//   `{name}|{month}|{type}|{status}`
// At build time we recompute the signature from the *current* event state and
// compare. A mismatch on an approved row flips approval_state to 'stale' and
// surfaces a warning. Pipe-delimited rather than hashed so a human reading
// the DB row can see exactly which field drifted.
function compute_event_signature(event) {
  if (!event) return null;
  const name   = (event.name ?? '').trim();
  const month  = event.month ?? '';
  const type   = event.type ?? '';
  const status = event.status ?? '';
  return `${name}|${month}|${type}|${status}`;
}

// ── Load overrides from DB ────────────────────────────────────────────────────

/**
 * Load active overrides for the given year pair from the DB.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.baseline_year]  — baseline (older) year of the comparison
 * @param {number}   [opts.analysis_year]  — analysis (newer) year of the comparison
 * @param {boolean}  [opts.silent=false]   — suppress console output on errors
 * @returns {Promise<{
 *   force_match:    Array<{ sid_baseline, sid_analysis, note, approved, approval_state, id }>,
 *   force_no_match: Array<{ sid_baseline, sid_analysis, note, approved, approval_state, id }>,
 *   force_segment:  Array<{ sid_baseline, sid_analysis, segment, note, approved, approval_state, id }>,
 *   stats: { total, approved, unapproved, global, scoped }
 * } | null>}
 */
async function load_overrides({ baseline_year, analysis_year, silent = false } = {}) {
  // Year scope filter:
  //   global   → baseline_year IS NULL AND analysis_year IS NULL
  //   scoped   → baseline_year = ?    AND analysis_year = ?
  // Globals always apply; scoped only apply when both years match.
  let rows;
  try {
    const cfg  = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      const sql = `
        SELECT id, override_type, sid_baseline, sid_analysis, segment, note,
               baseline_year, analysis_year, approved, approval_state,
               event_signature_baseline, event_signature_analysis
          FROM \`${TABLE_NAME}\`
         WHERE active = 1
           AND (
                 (baseline_year IS NULL AND analysis_year IS NULL)
              OR (baseline_year = ? AND analysis_year = ?)
           )
         ORDER BY id ASC
      `;
      [rows] = await conn.query(sql, [baseline_year ?? null, analysis_year ?? null]);
    } finally {
      await conn.end();
    }
  } catch (err) {
    if (!silent) console.warn(`  [overrides] DB read failed: ${err.message}`);
    return null;
  }

  const force_match    = [];
  const force_no_match = [];
  const force_segment  = [];

  let approved_count   = 0;
  let unapproved_count = 0;
  let global_count     = 0;
  let scoped_count     = 0;

  for (const r of rows) {
    const common = {
      id:             r.id,
      sid_baseline:   r.sid_baseline,
      sid_analysis:   r.sid_analysis,
      note:           r.note ?? '',
      approved:       !!r.approved,
      approval_state: r.approval_state ?? null,
      baseline_year:  r.baseline_year ?? null,
      analysis_year:  r.analysis_year ?? null,
      // Step 6 — signatures captured at approval time. Either may be NULL
      // (force_no_match touches only one side; un-approved rows have neither).
      event_signature_baseline: r.event_signature_baseline ?? null,
      event_signature_analysis: r.event_signature_analysis ?? null,
    };

    if (r.approved) approved_count++; else unapproved_count++;
    if (r.baseline_year === null && r.analysis_year === null) global_count++;
    else scoped_count++;

    if (r.override_type === 'force_match') {
      force_match.push(common);
    } else if (r.override_type === 'force_no_match') {
      force_no_match.push(common);
    } else if (r.override_type === 'force_segment') {
      force_segment.push({ ...common, segment: r.segment });
    }
  }

  return {
    force_match,
    force_no_match,
    force_segment,
    stats: {
      total:      rows.length,
      approved:   approved_count,
      unapproved: unapproved_count,
      global:     global_count,
      scoped:     scoped_count,
      // `stale` is computed by apply_overrides() once it can compare the
      // stored signatures against the current event state. load_overrides()
      // initialises it to 0 so callers can rely on the field's presence.
      stale:      0,
    },
  };
}

// ── Apply overrides to segments ───────────────────────────────────────────────

function apply_overrides(segments, baseline_active, analysis_active, overrides) {
  if (!overrides) return { segments, applied: [], warnings: [], stale_ids: [], stale_warnings: [] };

  const applied        = [];
  const warnings       = [];
  const stale_ids      = [];
  const stale_warnings = [];

  // Helper: find event by sanction ID
  const find_25 = sid => baseline_active.find(e => e.sanctionId === sid || e.sanction_id === sid);
  const find_26 = sid => analysis_active.find(e => e.sanctionId === sid || e.sanction_id === sid);

  // Step 6 — stale detection. Returns { stale: bool, details: string|null }
  // by comparing the override's stored signatures against fresh signatures
  // computed from the current events. Returns stale=false for un-approved
  // overrides (no baseline to drift from) and for rows with no stored sig
  // (haven't been approved yet — cmd_approve captures them at approval time).
  const detect_stale = (ov, e25, e26) => {
    if (!ov.approved) return { stale: false, details: null };
    const stored_b = ov.event_signature_baseline ?? null;
    const stored_a = ov.event_signature_analysis ?? null;
    if (stored_b === null && stored_a === null) return { stale: false, details: null };

    const fresh_b = e25 ? compute_event_signature(e25) : null;
    const fresh_a = e26 ? compute_event_signature(e26) : null;
    const diffs = [];
    if (stored_b !== null && stored_b !== fresh_b) diffs.push(`baseline "${stored_b}" → "${fresh_b}"`);
    if (stored_a !== null && stored_a !== fresh_a) diffs.push(`analysis "${stored_a}" → "${fresh_a}"`);
    if (diffs.length === 0) return { stale: false, details: null };
    return { stale: true, details: diffs.join('; ') };
  };

  // Tag an applied record as stale and append a warning the build can surface.
  const flag_stale = (ov, applied_record, e25, e26) => {
    const { stale, details } = detect_stale(ov, e25, e26);
    if (!stale) return;
    applied_record.stale = true;
    if (!stale_ids.includes(ov.id)) stale_ids.push(ov.id);
    const sid_label = ov.sid_baseline ?? ov.sid_analysis;
    stale_warnings.push(`override #${ov.id} (${sid_label}) is stale: ${details}`);
  };

  // Helper: remove an event from all segment arrays
  const remove_from_all = (sid_baseline, sid_analysis) => {
    const keys = ['retained','shifted','attrited','new','recovered','triedToReturn'];
    for (const key of keys) {
      segments[key] = (segments[key] ?? []).filter(m => {
        const match_25 = sid_baseline ? m.e25?.sanctionId === sid_baseline || m.e25?.sanction_id === sid_baseline : false;
        const match_26 = sid_analysis ? m.e26?.sanctionId === sid_analysis || m.e26?.sanction_id === sid_analysis : false;
        return !match_25 && !match_26;
      });
    }
  };

  // ── 1. force_match ───────────────────────────────────────────────────────────
  for (const ov of (overrides.force_match ?? [])) {
    const e25 = find_25(ov.sid_baseline);
    const e26 = find_26(ov.sid_analysis);

    if (!e25) { warnings.push(`force_match: sid_baseline "${ov.sid_baseline}" not found in baseline active events`); continue; }
    if (!e26) { warnings.push(`force_match: sid_analysis "${ov.sid_analysis}" not found in analysis active events`); continue; }

    // Remove both events from any existing segment
    remove_from_all(ov.sid_baseline, ov.sid_analysis);

    // Determine segment: Retained (same month) or Shifted (different month)
    const seg = e25.month === e26.month ? 'Retained' : 'Shifted';
    const conf = 'Override';
    const record = { e25, e26, seg, conf, note: ov.note ?? '', override_id: ov.id, approved: ov.approved };

    if (seg === 'Retained') {
      segments.retained = segments.retained ?? [];
      segments.retained.push(record);
    } else {
      segments.shifted = segments.shifted ?? [];
      segments.shifted.push(record);
    }

    const applied_record = { type: 'force_match', sid_baseline: ov.sid_baseline, sid_analysis: ov.sid_analysis, result: seg, note: ov.note, approved: ov.approved, override_id: ov.id };
    flag_stale(ov, applied_record, e25, e26);
    applied.push(applied_record);
  }

  // ── 2. force_no_match ────────────────────────────────────────────────────────
  for (const ov of (overrides.force_no_match ?? [])) {
    const sid_baseline = ov.sid_baseline ?? null;
    const sid_analysis = ov.sid_analysis ?? null;

    if (!sid_baseline && !sid_analysis) { warnings.push('force_no_match entry has neither sid_baseline nor sid_analysis'); continue; }

    // Remove from all segments
    remove_from_all(sid_baseline, sid_analysis);

    // Re-add as Attrited (baseline event) or New (analysis-only event)
    if (sid_baseline) {
      const e25 = find_25(sid_baseline);
      if (e25) {
        segments.attrited = segments.attrited ?? [];
        segments.attrited.push({ e25, e26: null, seg: 'Lost', conf: 'Override', note: ov.note ?? '', override_id: ov.id, approved: ov.approved });
        const rec = { type: 'force_no_match', sid_baseline, result: 'Lost', note: ov.note, approved: ov.approved, override_id: ov.id };
        flag_stale(ov, rec, e25, null);
        applied.push(rec);
      } else {
        warnings.push(`force_no_match: sid_baseline "${sid_baseline}" not found in baseline active events`);
      }
    }
    if (sid_analysis) {
      const e26 = find_26(sid_analysis);
      if (e26) {
        segments.new = segments.new ?? [];
        segments.new.push({ e25: null, e26, seg: 'New', conf: 'Override', note: ov.note ?? '', override_id: ov.id, approved: ov.approved });
        const rec = { type: 'force_no_match', sid_analysis, result: 'New', note: ov.note, approved: ov.approved, override_id: ov.id };
        flag_stale(ov, rec, null, e26);
        applied.push(rec);
      } else {
        warnings.push(`force_no_match: sid_analysis "${sid_analysis}" not found in analysis active events`);
      }
    }
  }

  // ── 3. force_segment ─────────────────────────────────────────────────────────
  for (const ov of (overrides.force_segment ?? [])) {
    const target_seg = ov.segment;
    if (!VALID_SEGMENTS.has(target_seg)) {
      warnings.push(`force_segment: invalid segment "${target_seg}". Must be one of: ${[...VALID_SEGMENTS].join(', ')}`);
      continue;
    }

    const sid_baseline = ov.sid_baseline ?? null;
    const sid_analysis = ov.sid_analysis ?? null;

    // Find the current match record for this event
    let match_record = null;
    const all_segs = ['retained','shifted','attrited','new','recovered','triedToReturn'];
    for (const key of all_segs) {
      const found = (segments[key] ?? []).find(m =>
        (sid_baseline && (m.e25?.sanctionId === sid_baseline || m.e25?.sanction_id === sid_baseline)) ||
        (sid_analysis && (m.e26?.sanctionId === sid_analysis || m.e26?.sanction_id === sid_analysis))
      );
      if (found) { match_record = { ...found }; break; }
    }

    if (!match_record) {
      // Try to construct from raw events
      if (sid_baseline) {
        const e25 = find_25(sid_baseline);
        if (e25) match_record = { e25, e26: null, seg: target_seg, conf: 'Override', note: ov.note ?? '' };
      }
      if (sid_analysis && !match_record) {
        const e26 = find_26(sid_analysis);
        if (e26) match_record = { e25: null, e26, seg: target_seg, conf: 'Override', note: ov.note ?? '' };
      }
      if (!match_record) {
        warnings.push(`force_segment: could not find event with sid_baseline="${sid_baseline}" or sid_analysis="${sid_analysis}"`);
        continue;
      }
    }

    // Remove from current segment
    remove_from_all(sid_baseline, sid_analysis);

    // Update segment label and add to correct array
    match_record.seg  = target_seg;
    match_record.conf = match_record.conf === 'Override' ? 'Override' : `Override (was ${match_record.seg})`;
    match_record.note = ov.note ?? match_record.note ?? '';
    match_record.override_id = ov.id;
    match_record.approved    = ov.approved;

    const seg_key_map = {
      'Retained':        'retained',
      'Shifted':         'shifted',
      'Lost':            'attrited',
      'New':             'new',
      'Recovered':       'recovered',
      'Tried to Return': 'triedToReturn',
    };
    const target_key = seg_key_map[target_seg];
    segments[target_key] = segments[target_key] ?? [];
    segments[target_key].push(match_record);

    const fs_rec = { type: 'force_segment', sid_baseline, sid_analysis, result: target_seg, note: ov.note, approved: ov.approved, override_id: ov.id };
    flag_stale(ov, fs_rec, sid_baseline ? find_25(sid_baseline) : null, sid_analysis ? find_26(sid_analysis) : null);
    applied.push(fs_rec);
  }

  return { segments, applied, warnings, stale_ids, stale_warnings };
}

// ── Stale-approval mutation helper ─────────────────────────────────────────
//
// Called by build_all.js / analysis.js after apply_overrides() returns. Sets
// approval_state = 'stale' on the listed override ids. Pure function over an
// optional connection (so callers that already hold one can reuse it; tests
// can pass their own).
//
// Idempotent — re-running with the same ids is a no-op.
async function mark_overrides_stale(ids, { conn = null, silent = false } = {}) {
  if (!ids || ids.length === 0) return { updated: 0 };
  let own_conn = false;
  let c = conn;
  if (!c) {
    const cfg = await local_usat_sales_db_config();
    c = await mysqlP.createConnection(cfg);
    own_conn = true;
  }
  try {
    const placeholders = ids.map(() => '?').join(', ');
    const [r] = await c.query(
      `UPDATE \`${TABLE_NAME}\`
          SET approval_state = 'stale'
        WHERE id IN (${placeholders})
          AND active = 1
          AND approved = 1`,
      ids
    );
    if (r.affectedRows > 0 && !silent) {
      console.warn(`  ⚠ ${r.affectedRows} approved override(s) marked stale — events drifted since approval.`);
    }
    return { updated: r.affectedRows };
  } finally {
    if (own_conn) await c.end();
  }
}

// ── Summary for logging / output ──────────────────────────────────────────────

function summarise_overrides(applied, warnings, stats, stale_warnings = []) {
  if (!applied.length && !warnings.length && !stats && !stale_warnings?.length) return null;
  // Stats may not include the stale count yet — derive it from the applied
  // records so callers always see a consistent total.
  const stale_count = applied.filter(a => a.stale).length;
  return {
    total_applied:  applied.length,
    applied,
    warnings,
    stale_warnings: stale_warnings ?? [],
    stats: stats ? { ...stats, stale: stale_count } : null,
  };
}

module.exports = {
  load_overrides,
  apply_overrides,
  summarise_overrides,
  mark_overrides_stale,
  compute_event_signature,
};
