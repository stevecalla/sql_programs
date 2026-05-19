/**
 * matcher.js — multi-pass greedy event matching + cancelled cross-match.
 *
 * Mirrors the Python matching logic exactly:
 *  Pass 1: exact normalised name, same month
 *  Pass 2: exact normalised name, different month (shifted)
 *  Pass 3: fuzzy Jaccard ≥ 0.55, combined score ≥ 0.50
 *
 * Then cross-matches excluded events:
 *  Scenario A: 2025 active → 2026 excluded  ("Tried to Return")
 *  Scenario B: 2025 excluded → 2026 active  ("Recovered")
 */

'use strict';

const { norm, tokens, jaccard, matchScore, sportConflict } = require('./normalizer');

const SCORE_THRESHOLD = 0.50;
const NAME_THRESHOLD  = 0.55;

/**
 * Enrich an event with its normalised name and token set.
 */
function enrich(events) {
  return events.map(e => ({
    ...e,
    normName: norm(e.name),
    tokenSet: tokens(e.name),
  }));
}

/**
 * Run the full three-pass greedy matcher on two active event arrays.
 * Returns { retained, shifted, attrited, new: newEvents, matchDetails }.
 *
 * matchDetails is an array of every match record with segment info.
 */
function matchEvents(baseline_active, analysis_active) {
  const ev25 = enrich(baseline_active);
  const ev26 = enrich(analysis_active);

  const used25 = new Array(ev25.length).fill(false);
  const used26 = new Array(ev26.length).fill(false);

  const retained  = [];   // same event, same month
  const shifted   = [];   // same event, different month
  const attrited  = [];   // 2025 only
  const newEvents = [];   // 2026 only

  // ── Pass 1: exact normalised name, same month ──────────────────────
  for (let i = 0; i < ev25.length; i++) {
    if (used25[i]) continue;
    for (let j = 0; j < ev26.length; j++) {
      if (used26[j]) continue;
      if (ev25[i].normName === ev26[j].normName && ev25[i].month === ev26[j].month) {
        retained.push({ seg: 'Retained', conf: 'Exact', score: 1, ns: 1, df: 1, e25: ev25[i], e26: ev26[j] });
        used25[i] = used26[j] = true;
        break;
      }
    }
  }

  // ── Pass 2: exact normalised name, different month (shifted) ───────
  for (let i = 0; i < ev25.length; i++) {
    if (used25[i]) continue;
    for (let j = 0; j < ev26.length; j++) {
      if (used26[j]) continue;
      if (ev25[i].normName === ev26[j].normName && ev25[i].month !== ev26[j].month) {
        const { dateScore: df } = matchScore(ev25[i].name, ev25[i].month, ev26[j].name, ev26[j].month);
        shifted.push({ seg: 'Shifted', conf: 'Exact-Shifted', score: 0.82 + 0.18 * df, ns: 1, df, e25: ev25[i], e26: ev26[j] });
        used25[i] = used26[j] = true;
        break;
      }
    }
  }

  // ── Pass 3: fuzzy ──────────────────────────────────────────────────
  // Build candidate pairs sorted by combined score (best first)
  const candidates = [];
  for (let i = 0; i < ev25.length; i++) {
    if (used25[i]) continue;
    for (let j = 0; j < ev26.length; j++) {
      if (used26[j]) continue;
      if (sportConflict(ev25[i].name, ev26[j].name)) continue;
      const { score, nameScore: ns, dateScore: df } = matchScore(
        ev25[i].name, ev25[i].month, ev26[j].name, ev26[j].month,
      );
      if (score >= SCORE_THRESHOLD && ns >= NAME_THRESHOLD) {
        candidates.push({ score, ns, df, i, j });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const { score, ns, df, i, j } of candidates) {
    if (used25[i] || used26[j]) continue;
    const jSim = jaccard(ev25[i].tokenSet, ev26[j].tokenSet);
    if (jSim < NAME_THRESHOLD) continue;

    const isSameMonth = ev25[i].month === ev26[j].month;
    const seg = isSameMonth ? 'Retained' : 'Shifted';
    const conf = (() => {
      if (ns >= 0.85 && df >= 0.78) return 'High';
      if (ns >= 0.65 && df >= 0.56) return 'Medium';
      return 'Low';
    })();

    (isSameMonth ? retained : shifted).push({ seg, conf, score, ns, df, e25: ev25[i], e26: ev26[j] });
    used25[i] = used26[j] = true;
  }

  // ── Collect unmatched ──────────────────────────────────────────────
  for (let i = 0; i < ev25.length; i++) {
    if (!used25[i]) attrited.push({ seg: 'Lost', conf: 'N/A', e25: ev25[i], e26: null });
  }
  for (let j = 0; j < ev26.length; j++) {
    if (!used26[j]) newEvents.push({ seg: 'New', conf: 'N/A', e25: null, e26: ev26[j] });
  }

  return { retained, shifted, attrited, new: newEvents };
}

/**
 * Fuzzy check for cross-matching (simpler — just Jaccard ≥ 0.60 on tokens).
 */
function fuzzySimpleMatch(nameA, nameB, threshold = 0.60) {
  return jaccard(tokens(nameA), tokens(nameB)) >= threshold;
}

/**
 * Scenario A: 2025 active → 2026 excluded ("Tried to Return").
 * Scenario B: 2025 excluded → 2026 active ("Recovered").
 *
 * After this, reclassify records in the main match output.
 */
function crossMatch(baseline_active, baseline_excluded, analysis_active, analysis_excluded) {
  // Build norm indexes
  const normIdx26excl = new Map();
  for (const e of analysis_excluded) {
    const key = norm(e.name);
    if (!normIdx26excl.has(key)) normIdx26excl.set(key, e);
  }

  const normIdx26active = new Map();
  for (const e of analysis_active) {
    const key = norm(e.name);
    if (!normIdx26active.has(key)) normIdx26active.set(key, e);
  }

  // Scenario A
  const triedToReturn = [];
  for (const e25 of baseline_active) {
    const nm = norm(e25.name);
    let matched = normIdx26excl.get(nm) || null;
    if (!matched) {
      for (const [, e26] of normIdx26excl) {
        if (fuzzySimpleMatch(e25.name, e26.name)) { matched = e26; break; }
      }
    }
    if (matched) {
      triedToReturn.push({
        name25: e25.name,  sanctionId25: e25.sanctionId,
        month25: e25.month, type: e25.type, status25: e25.status, date25: e25.startDate,
        name26: matched.name, sanctionId26: matched.sanctionId,
        month26: matched.month, status26: matched.status, date26: matched.startDate,
      });
    }
  }

  // Scenario B
  const recovered = [];
  for (const e25 of baseline_excluded) {
    const nm = norm(e25.name);
    let matched = normIdx26active.get(nm) || null;
    if (!matched) {
      for (const [, e26] of normIdx26active) {
        if (fuzzySimpleMatch(e25.name, e26.name)) { matched = e26; break; }
      }
    }
    if (matched) {
      recovered.push({
        name25: e25.name,  sanctionId25: e25.sanctionId,
        month25: e25.month, type: e25.type, status25: e25.status, date25: e25.startDate,
        name26: matched.name, sanctionId26: matched.sanctionId,
        month26: matched.month, status26: matched.status, date26: matched.startDate,
      });
    }
  }

  return { triedToReturn, recovered };
}

/**
 * Reclassify Lost → Tried to Return and New → Recovered using cross-match results.
 * Mutates the segment arrays in-place.
 *
 * Uses exact sanction IDs (not name sets) so that only the precise event pairs
 * identified by crossMatch() get reclassified — eliminates false positives where
 * sibling events share a name but only one type/ID was actually cross-matched.
 */
function reclassify(segments, triedToReturn, recovered) {
  // Key on exact sanctionId so we don't sweep up same-named sibling events
  const ttrSids = new Set(triedToReturn.map(d => d.sanctionId25));
  const recSids = new Set(recovered.map(d => d.sanctionId26));

  for (const m of [...segments.attrited]) {
    if (ttrSids.has(m.e25?.sanctionId)) {
      m.seg = 'Tried to Return';
      m.conf = 'Cross';
    }
  }
  for (const m of [...segments.new]) {
    if (recSids.has(m.e26?.sanctionId)) {
      m.seg = 'Recovered';
      m.conf = 'Cross';
    }
  }

  // Split the arrays
  segments.triedToReturn = segments.attrited.filter(m => m.seg === 'Tried to Return');
  segments.attrited      = segments.attrited.filter(m => m.seg === 'Lost');
  segments.recovered     = segments.new.filter(m => m.seg === 'Recovered');
  segments.new           = segments.new.filter(m => m.seg === 'New');

  return segments;
}

module.exports = { matchEvents, crossMatch, reclassify };
