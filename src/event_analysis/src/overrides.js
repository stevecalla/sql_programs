/**
 * overrides.js — Manual event matching overrides.
 *
 * Reads data/overrides.json and applies three types of override:
 *
 *   force_match    — force two specific events to be matched (sid_baseline + sid_analysis)
 *   force_no_match — prevent a specific event from matching anything (sid_baseline or sid_analysis)
 *   force_segment  — override the segment classification of a matched/unmatched event
 *
 * Applied after automatic matching in analysis.js so manual decisions
 * always take precedence over the fuzzy algorithm.
 *
 * Override record shape (data/overrides.json):
 * {
 *   "force_match":    [{ "sid_baseline": "...", "sid_analysis": "...", "note": "..." }],
 *   "force_no_match": [{ "sid_baseline": "...",                 "note": "..." }],
 *   "force_segment":  [{ "sid_baseline": "..." | "sid_analysis": "...", "segment": "Retained|Shifted|Lost|New|Recovered|Tried to Return", "note": "..." }]
 * }
 *
 * Fields starting with "_" are treated as comments and ignored.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const VALID_SEGMENTS = new Set([
  'Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return',
]);

// ── Load overrides file ───────────────────────────────────────────────────────

function load_overrides(overrides_path) {
  if (!fs.existsSync(overrides_path)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(overrides_path, 'utf8'));
    // Strip comment-only entries (keys starting with _)
    const clean = entry => {
      if (!entry || typeof entry !== 'object') return null;
      const clean_entry = {};
      for (const [k, v] of Object.entries(entry)) {
        if (!k.startsWith('_')) clean_entry[k] = v;
      }
      return Object.keys(clean_entry).length ? clean_entry : null;
    };
    return {
      force_match:    (raw.force_match    ?? []).map(clean).filter(Boolean),
      force_no_match: (raw.force_no_match ?? []).map(clean).filter(Boolean),
      force_segment:  (raw.force_segment  ?? []).map(clean).filter(Boolean),
    };
  } catch (err) {
    console.warn(`  [overrides] Could not parse overrides.json: ${err.message}`);
    return null;
  }
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

    if (!e25) { warnings.push(`force_match: sid_baseline "${ov.sid_baseline}" not found in 2025 active events`); continue; }
    if (!e26) { warnings.push(`force_match: sid_analysis "${ov.sid_analysis}" not found in 2026 active events`); continue; }

    // Remove both events from any existing segment
    remove_from_all(ov.sid_baseline, ov.sid_analysis);

    // Determine segment: Retained (same month) or Shifted (different month)
    const seg = e25.month === e26.month ? 'Retained' : 'Shifted';
    const conf = 'Override';
    const record = { e25, e26, seg, conf, note: ov.note ?? '' };

    if (seg === 'Retained') {
      segments.retained = segments.retained ?? [];
      segments.retained.push(record);
    } else {
      segments.shifted = segments.shifted ?? [];
      segments.shifted.push(record);
    }

    applied.push({ type: 'force_match', sid_baseline: ov.sid_baseline, sid_analysis: ov.sid_analysis, result: seg, note: ov.note });
  }

  // ── 2. force_no_match ────────────────────────────────────────────────────────
  for (const ov of (overrides.force_no_match ?? [])) {
    const sid_baseline = ov.sid_baseline ?? null;
    const sid_analysis = ov.sid_analysis ?? null;

    if (!sid_baseline && !sid_analysis) { warnings.push('force_no_match entry has neither sid_baseline nor sid_analysis'); continue; }

    // Remove from all segments
    remove_from_all(sid_baseline, sid_analysis);

    // Re-add as Attrited (2025 event) or New (2026-only event)
    if (sid_baseline) {
      const e25 = find_25(sid_baseline);
      if (e25) {
        segments.attrited = segments.attrited ?? [];
        segments.attrited.push({ e25, e26: null, seg: 'Lost', conf: 'Override', note: ov.note ?? '' });
        applied.push({ type: 'force_no_match', sid_baseline, result: 'Lost', note: ov.note });
      } else {
        warnings.push(`force_no_match: sid_baseline "${sid_baseline}" not found in 2025 active events`);
      }
    }
    if (sid_analysis) {
      const e26 = find_26(sid_analysis);
      if (e26) {
        segments.new = segments.new ?? [];
        segments.new.push({ e25: null, e26, seg: 'New', conf: 'Override', note: ov.note ?? '' });
        applied.push({ type: 'force_no_match', sid_analysis, result: 'New', note: ov.note });
      } else {
        warnings.push(`force_no_match: sid_analysis "${sid_analysis}" not found in 2026 active events`);
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

    const seg_key_map = {
      'Retained':        'retained',
      'Shifted':         'shifted',
      'Lost':        'attrited',
      'New':             'new',
      'Recovered':       'recovered',
      'Tried to Return': 'triedToReturn',
    };
    const target_key = seg_key_map[target_seg];
    segments[target_key] = segments[target_key] ?? [];
    segments[target_key].push(match_record);

    applied.push({ type: 'force_segment', sid_baseline, sid_analysis, result: target_seg, note: ov.note });
  }

  return { segments, applied, warnings };
}

// ── Summary for logging / output ──────────────────────────────────────────────

function summarise_overrides(applied, warnings) {
  if (!applied.length && !warnings.length) return null;
  return {
    total_applied: applied.length,
    applied,
    warnings,
  };
}

module.exports = { load_overrides, apply_overrides, summarise_overrides };
