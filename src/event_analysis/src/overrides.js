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
               baseline_year, analysis_year, approved, approval_state
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
    },
  };
}

// ── Apply overrides to segments ───────────────────────────────────────────────

function apply_overrides(segments, baseline_active, analysis_active, overrides) {
  if (!overrides) return { segments, applied: [], warnings: [] };

  const applied  = [];
  const warnings = [];

  // Helper: find event by sanction ID
  const find_25 = sid => baseline_active.find(e => e.sanctionId === sid || e.sanction_id === sid);
  const find_26 = sid => analysis_active.find(e => e.sanctionId === sid || e.sanction_id === sid);

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

    applied.push({ type: 'force_match', sid_baseline: ov.sid_baseline, sid_analysis: ov.sid_analysis, result: seg, note: ov.note, approved: ov.approved, override_id: ov.id });
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
        applied.push({ type: 'force_no_match', sid_baseline, result: 'Lost', note: ov.note, approved: ov.approved, override_id: ov.id });
      } else {
        warnings.push(`force_no_match: sid_baseline "${sid_baseline}" not found in baseline active events`);
      }
    }
    if (sid_analysis) {
      const e26 = find_26(sid_analysis);
      if (e26) {
        segments.new = segments.new ?? [];
        segments.new.push({ e25: null, e26, seg: 'New', conf: 'Override', note: ov.note ?? '', override_id: ov.id, approved: ov.approved });
        applied.push({ type: 'force_no_match', sid_analysis, result: 'New', note: ov.note, approved: ov.approved, override_id: ov.id });
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

    applied.push({ type: 'force_segment', sid_baseline, sid_analysis, result: target_seg, note: ov.note, approved: ov.approved, override_id: ov.id });
  }

  return { segments, applied, warnings };
}

// ── Summary for logging / output ──────────────────────────────────────────────

function summarise_overrides(applied, warnings, stats) {
  if (!applied.length && !warnings.length && !stats) return null;
  return {
    total_applied: applied.length,
    applied,
    warnings,
    stats: stats ?? null,
  };
}

module.exports = { load_overrides, apply_overrides, summarise_overrides };
