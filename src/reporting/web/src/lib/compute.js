// Minimal derivations from the bootstrap payload — enough to prove the data pipe end-to-end and
// show headline numbers. The full aggregation logic (computeAgg, flows, matrices, YoY) ports here
// in the next Phase-2 increment; this file intentionally stays small for now.

const sum = (a) => (a || []).reduce((t, v) => t + (Number(v) || 0), 0);

function metricByLabel(yearBlock, label) {
  const m = (yearBlock && yearBlock.metrics || []).find((x) => x.label === label);
  return m ? m.statez : [];
}

// National headline numbers for a single year (all months), mirroring the dashboard's KPIs.
export function headlineKPIs(payload, year) {
  const yb = payload && payload.byYear && payload.byYear[String(year)];
  if (!yb) return null;
  const participants = sum(metricByLabel(yb, 'Participants'));
  const home = sum(metricByLabel(yb, 'Home (count)'));
  const away = sum(metricByLabel(yb, 'Away (count)'));
  const uniq = yb.nat && yb.nat.uniq;
  return {
    year: String(year),
    participants,
    unique: uniq != null ? uniq : null,
    home,
    away,                       // cross-state travel (Traveled away)
    homePct: (home + away) ? Math.round((100 * home) / (home + away)) : null,
    caParticipants: (() => {
      const abbr = payload.abbr || [];
      const i = abbr.indexOf('CA');
      const statez = metricByLabel(yb, 'Participants');
      return i >= 0 ? statez[i] : null;
    })(),
  };
}

export function availableYears(payload) {
  return payload && payload.byYear ? Object.keys(payload.byYear).sort() : [];
}
