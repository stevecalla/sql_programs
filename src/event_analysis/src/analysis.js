/**
 * analysis.js — compute all derived data from the matched events.
 *
 * Returns a single `results` object consumed by the Excel builder.
 */

'use strict';

const { matchEvents, crossMatch, reclassify } = require('./matcher');
const { buildCalendarImpact } = require('./calendar');
const { load_overrides, apply_overrides, summarise_overrides } = require('./overrides');

const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
const MN    = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec' };

/** Count raw events by month → type from an array. */
function countByMonthType(events) {
  const counts = {};
  for (let m = 1; m <= 12; m++) counts[m] = {};
  for (const e of events) {
    if (!e.month) continue;
    counts[e.month][e.type] = (counts[e.month][e.type] ?? 0) + 1;
  }
  return counts;
}

/** Total of a month in a count-map. */
function monthTotal(counts, month) {
  return Object.values(counts[month] ?? {}).reduce((s, v) => s + v, 0);
}

/** Segment counts from the match records by month. */
function segCounts(records, monthKey = 'e25') {
  const counts = {};
  for (let m = 1; m <= 12; m++) counts[m] = {};
  for (const r of records) {
    const ev = monthKey === 'e25' ? r.e25 : r.e26;
    if (!ev || !ev.month) continue;
    counts[ev.month][ev.type] = (counts[ev.month][ev.type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Run the complete analysis.
 * @param {object} loaded  — output of loadBothYears() / loadBothYearsFromRows().
 *                           May also carry `BASELINE_YEAR` and `ANALYSIS_YEAR`
 *                           when callers want year-scoped overrides.
 * @returns {Promise<object>}  — all computed data for Excel generation
 */
async function runAnalysis(loaded) {
  const { baseline_active, analysis_active, baseline_excluded, analysis_excluded } = loaded;

  // ── 1. Match events ──────────────────────────────────────────────────
  const segments = matchEvents(baseline_active, analysis_active);

  // ── 2. Cross-match cancelled events ─────────────────────────────────
  const { triedToReturn, recovered } = crossMatch(
    baseline_active, baseline_excluded, analysis_active, analysis_excluded,
  );
  reclassify(segments, triedToReturn, recovered);

  // ── Enrich TTR / Recovered with the cross-match excluded event ──────────
  // reclassify() only changes the seg label but leaves m.e26=null for TTR
  // and m.e25=null for Recovered. We attach the excluded event here.
  const ttr_map = new Map(triedToReturn.map(d => [d.sanctionId25, d]));
  for (const m of segments.triedToReturn) {
    if (m.e25 && !m.e26) {
      const cross = ttr_map.get(m.e25.sanctionId);
      if (cross) {
        m.e26 = {
          name: cross.name26, sanctionId: cross.sanctionId26,
          month: cross.month26, status: cross.status26,
          startDate: cross.date26, type: m.e25.type,
        };
      }
    }
  }
  const rec_map = new Map(recovered.map(d => [d.sanctionId26, d]));
  for (const m of segments.recovered) {
    if (m.e26 && !m.e25) {
      const cross = rec_map.get(m.e26.sanctionId);
      if (cross) {
        m.e25 = {
          name: cross.name25, sanctionId: cross.sanctionId25,
          month: cross.month25, status: cross.status25,
          startDate: cross.date25, type: m.e26.type,
        };
      }
    }
  }

  // ── 3. Apply manual overrides (loaded from event_analysis_overrides table) ──
  const baseline_year = loaded.BASELINE_YEAR
    ?? Number(process.env.BASELINE_YEAR)
    ?? null;
  const analysis_year = loaded.ANALYSIS_YEAR
    ?? Number(process.env.ANALYSIS_YEAR)
    ?? null;

  const overrides = await load_overrides({ baseline_year, analysis_year });
  let override_summary = null;
  if (overrides && (overrides.force_match.length || overrides.force_no_match.length || overrides.force_segment.length)) {
    const { applied, warnings } = apply_overrides(segments, baseline_active, analysis_active, overrides);
    override_summary = summarise_overrides(applied, warnings, overrides.stats);
    if (override_summary?.total_applied) {
      console.log(`  Overrides applied: ${override_summary.total_applied} (${applied.map(a => a.type).join(', ')})`);
    }
    if (overrides.stats?.unapproved > 0) {
      console.warn(`  ⚠ ${overrides.stats.unapproved} override(s) are unapproved (still applied; approve via ask.js).`);
    }
    if (override_summary?.warnings?.length) {
      override_summary.warnings.forEach(w => console.warn(`  [override warning] ${w}`));
    }
  } else if (overrides) {
    // No active overrides for this year scope — record stats so callers can report it.
    override_summary = summarise_overrides([], [], overrides.stats);
  }

  // ── 3. Raw counts by month/type ──────────────────────────────────────
  const c_baseline = countByMonthType(baseline_active);
  const c_analysis = countByMonthType(analysis_active);

  // ── 4. Segment counts by month/type ─────────────────────────────────
  const allMatches = [
    ...segments.retained, ...segments.shifted,
    ...segments.triedToReturn, ...segments.attrited,
    ...segments.recovered, ...segments.new,
  ];

  const retMt  = segCounts(segments.retained,      'e25');
  const attrMt = segCounts(segments.attrited,       'e25');
  const newMt  = segCounts(segments.new,            'e26');
  const ttrMt  = segCounts(segments.triedToReturn,  'e25');
  const recMt  = segCounts(segments.recovered,      'e26');
  const saMt   = segCounts(segments.shifted,        'e25');
  const suMt   = segCounts(segments.shifted,        'e26');

  // ── 5. Monthly summary ───────────────────────────────────────────────
  const monthly = {};
  for (let m = 1; m <= 12; m++) {
    const n_baseline  = monthTotal(c_baseline, m);
    const n_analysis  = monthTotal(c_analysis, m);
    const ret  = monthTotal(retMt,  m);
    const sa   = monthTotal(saMt,   m);
    const su   = monthTotal(suMt,   m);
    const ttr  = monthTotal(ttrMt,  m);
    const attr = monthTotal(attrMt, m);
    const rec  = monthTotal(recMt,  m);
    const newE = monthTotal(newMt,  m);

    monthly[m] = { n_baseline, n_analysis, ret, sa, su, ttr, attr, rec, new: newE,
                   netDelta: n_analysis - n_baseline, netShift: su - sa };
  }

  // ── 6. Annual totals by type ─────────────────────────────────────────
  const typeAnnual = {};
  for (const t of TYPES) {
    const tot25  = Object.values(c_baseline).reduce((s, mo) => s + (mo[t] ?? 0), 0);
    const tot26  = Object.values(c_analysis).reduce((s, mo) => s + (mo[t] ?? 0), 0);
    const actDelta = tot26 - tot25;
    typeAnnual[t] = { tot25, tot26, actDelta };
  }

  // ── 7. Calendar impact (Step 2) ──────────────────────────────────────
  const calImpact = buildCalendarImpact(c_baseline, c_analysis);

  // ── 8. Organic by month (Step 3) ─────────────────────────────────────
  const organicMonthly = calImpact.map(ci => ({
    month:    ci.month,
    tot25:    ci.tot25,
    tot26:    ci.tot26,
    actDelta: ci.actDelta,
    calTotal: ci.calTotal,
    orgTotal: ci.orgTotal,
  }));

  // ── 9. Organic by type (Step 3) ──────────────────────────────────────
  const organicByType = {};
  for (const t of TYPES) {
    const actDelta = typeAnnual[t].actDelta;
    const calTotal = calImpact.reduce((s, ci) => s + (ci.calByType[t] ?? 0), 0);
    organicByType[t] = {
      tot25:    typeAnnual[t].tot25,
      actDelta, calTotal,
      orgTotal: actDelta - calTotal,
    };
  }

  // ── 10. Shift flow matrix ─────────────────────────────────────────────
  const shiftFlow = {};
  for (let fm = 1; fm <= 12; fm++) {
    shiftFlow[fm] = {};
    for (let tm = 1; tm <= 12; tm++) shiftFlow[fm][tm] = 0;
  }
  for (const r of segments.shifted) {
    if (r.e25?.month && r.e26?.month) {
      shiftFlow[r.e25.month][r.e26.month]++;
    }
  }

  // ── 11. Segment summary counts ────────────────────────────────────────
  const segSummary = {
    Retained:        segments.retained.length,
    Shifted:         segments.shifted.length,
    'Tried to Return': segments.triedToReturn.length,
    Lost:        segments.attrited.length,
    Recovered:       segments.recovered.length,
    New:             segments.new.length,
  };

  return {
    // Raw
    baseline_active, analysis_active, baseline_excluded, analysis_excluded,
    // Segments
    segments, allMatches, triedToReturn, recovered,
    // Counts
    c_baseline, c_analysis, monthly, typeAnnual,
    // Analysis
    calImpact, organicMonthly, organicByType, shiftFlow,
    retMt, attrMt, newMt, ttrMt, recMt, saMt, suMt,
    segSummary,
    // Helpers
    TYPES, MN,
    monthTotal: (mt, m) => monthTotal(mt, m),
    // Overrides
    override_summary,
  };
}

module.exports = { runAnalysis, countByMonthType, monthTotal };
