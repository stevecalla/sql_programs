'use strict';
/**
 * participation_agg.js — Node port of the standalone build's per-year aggregation (build3.build_year).
 * Turns raw per-state / per-region DB aggregates into the byYear block (36 metrics + cards + region
 * rows + national totals) that the dashboard renders. Kept 1:1 with the POC so the numbers match.
 *
 * Input raw row order (both state and region), matching the SQL SELECT in participation_read.js:
 *   [key, turnout, events, races, adult, adultEvents, adultRaces, female, male,
 *    age4_19, age20_29, age30_39, age40_49, age50_59, age60plus, home, away, ironman, new, unique]
 * For state rows key = 2-letter state; for region rows key = region name.
 */
const path = require('path');
const META = require('./mapmeta.json');
const ABBR = META.abbr;                 // 50 state codes, POC order
const NAMES = META.names;               // full names, same order
const AB2REGION = META.ab2region;       // state -> region name
const REGORDER = META.regOrder;         // region draw order (matches REGCENT)

const r0 = (x) => (x == null ? null : Math.round(x));
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Parse one raw DB row into the POC's "SM" tuple + age/gender/unique side tables.
function parseRow(raw) {
  const [st, turnout, events, races, adult, aev, arc, fn, mn,
    c419, c2029, c3039, c4049, c5059, c60, home, away, im, newc, uniq] = raw;
  const pe = events ? r0(turnout / events) : null;
  const pr = races ? r0(turnout / races) : null;
  const ape = aev ? r0(adult / aev) : null;
  const apr = arc ? r0(adult / arc) : null;
  const agePct = [c419, c2029, c3039, c4049, c5059, c60].map((c) => (turnout ? r0(100 * c / turnout) : null));
  const sm = [st, turnout, events, races, pe, pr, ape, apr,
    (turnout ? r0(100 * fn / turnout) : null), (turnout ? r0(100 * mn / turnout) : null),
    agePct[0], agePct[1], agePct[2], agePct[3], agePct[4], agePct[5],
    home, away, im, newc, turnout - newc];
  return { sm, age: [c419, c2029, c3039, c4049, c5059, c60], gender: [fn, mn], uniq };
}

const hpx = (r) => ((r[16] + r[17]) ? r0(100 * r[16] / (r[16] + r[17])) : null);

// The 36 metrics — label, pct flag (0 count, 1 percent, 2 one-decimal), value fn(smTuple, ageArr, genderArr, uniqVal).
const MET = [
  ['Participants', 0, (r) => r[1]], ['Events', 0, (r) => r[2]], ['Races', 0, (r) => r[3]],
  ['Per event', 0, (r) => r[4]], ['Per race', 0, (r) => r[5]],
  ['Adult per event', 0, (r) => r[6]], ['Adult per race', 0, (r) => r[7]],
  ['Female %', 1, (r) => r[8]], ['Male %', 1, (r) => r[9]],
  ['Female (count)', 0, (r, a, g) => g[0]], ['Male (count)', 0, (r, a, g) => g[1]],
  ['Age 4-19 %', 1, (r) => r[10]], ['Age 20-29 %', 1, (r) => r[11]], ['Age 30-39 %', 1, (r) => r[12]],
  ['Age 40-49 %', 1, (r) => r[13]], ['Age 50-59 %', 1, (r) => r[14]], ['Age 60+ %', 1, (r) => r[15]],
  ['Age 4-19 (count)', 0, (r, a) => a[0]], ['Age 20-29 (count)', 0, (r, a) => a[1]], ['Age 30-39 (count)', 0, (r, a) => a[2]],
  ['Age 40-49 (count)', 0, (r, a) => a[3]], ['Age 50-59 (count)', 0, (r, a) => a[4]], ['Age 60+ (count)', 0, (r, a) => a[5]],
  ['Home (count)', 0, (r) => r[16]], ['Away (count)', 0, (r) => r[17]],
  ['Home %', 1, (r) => hpx(r)], ['Away %', 1, (r) => (hpx(r) == null ? null : 100 - hpx(r))],
  ['IRONMAN (count)', 0, (r) => r[18]], ['IRONMAN share %', 1, (r) => (r[1] ? r0(100 * r[18] / r[1]) : null)],
  ['New (count)', 0, (r) => r[19]], ['Repeat (count)', 0, (r) => r[20]],
  ['New %', 1, (r) => (r[1] ? r0(100 * r[19] / r[1]) : null)], ['Repeat %', 1, (r) => (r[1] ? r0(100 * r[20] / r[1]) : null)],
  ['Unique participants', 0, (r, a, g, u) => u], ['% unique participants', 1, (r, a, g, u) => (r[1] && u ? r0(100 * u / r[1]) : null)],
  ['Avg races / participant', 2, (r, a, g, u) => (u ? round1(r[1] / u) : null)],
];

function fmt(v, p) {
  if (v == null) return 'n/a';
  if (p === 2) return v.toFixed(1);
  if (p) return v + '%';
  return Number(v).toLocaleString();
}

// stateRaws / regionRaws: arrays of raw 20-col rows. nat: { uniq, part }.
function buildYear(stateRaws, regionRaws, nat) {
  const S = {}; stateRaws.forEach((raw) => { S[raw[0]] = parseRow(raw); });
  const R = {}; regionRaws.forEach((raw) => { R[raw[0]] = parseRow(raw); });

  const metrics = MET.map(([label, pct, fn]) => {
    const statez = ABBR.map((a) => (S[a] ? fn(S[a].sm, S[a].age, S[a].gender, S[a].uniq) : null));
    const regionz = ABBR.map((a) => {
      const rg = AB2REGION[a]; return R[rg] ? fn(R[rg].sm, R[rg].age, R[rg].gender, R[rg].uniq) : null;
    });
    const vals = statez.filter((x) => x != null);
    const mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 0;
    const labels = ABBR.map((a, i) => (statez[i] != null ? ABBR[i] + '<br>' + fmt(statez[i], pct) : ABBR[i]));
    const regionlabels = REGORDER.map((rg) => (R[rg] ? rg + '<br>' + fmt(fn(R[rg].sm, R[rg].age, R[rg].gender, R[rg].uniq), pct) : rg + '<br>n/a'));
    return { label, ispct: pct === 1, dec: pct === 2, statez, regionz, labels, mn, mx, regionlabels };
  });

  // Cards: top 8 by participants / home share / IRONMAN.
  const present = ABBR.filter((a) => S[a]);
  const byPart = present.slice().sort((a, b) => S[b].sm[1] - S[a].sm[1]).slice(0, 8);
  const byHome = present.filter((a) => hpx(S[a].sm) != null).sort((a, b) => hpx(S[b].sm) - hpx(S[a].sm)).slice(0, 8);
  const byIm = present.slice().sort((a, b) => S[b].sm[18] - S[a].sm[18]).slice(0, 8);
  const nm = (a) => NAMES[ABBR.indexOf(a)];
  const cards = {
    'Top participation states': byPart.map((a) => [a, nm(a), S[a].sm[1]]),
    'Highest home share': byHome.map((a) => [a, nm(a), hpx(S[a].sm)]),
    'Top IRONMAN states': byIm.map((a) => [a, nm(a), S[a].sm[18]]),
  };

  // Region stat rows + US total (RSHEAD order).
  const rsrows = [];
  regionRaws.forEach((raw) => {
    const p = parseRow(raw); const r = p.sm; const g = p.gender; const hp = hpx(r); const u = p.uniq;
    rsrows.push([r[0], r[1], r[2], r[4], r[5], r[8], g[0], g[1], r[10], hp, (hp == null ? null : 100 - hp), r[18], r[19], r[20], u, (u ? round1(r[1] / u) : null)]);
  });
  const sum = (f) => regionRaws.reduce((t, raw) => t + (f(parseRow(raw)) || 0), 0);
  const Tt = sum((p) => p.sm[1]), Et = sum((p) => p.sm[2]), Rt = sum((p) => p.sm[3]);
  const Ht = sum((p) => p.sm[16]), At = sum((p) => p.sm[17]), IMt = sum((p) => p.sm[18]);
  const Nt = sum((p) => p.sm[19]), RPt = sum((p) => p.sm[20]);
  const FNt = sum((p) => p.gender[0]), MNt = sum((p) => p.gender[1]), C419t = sum((p) => p.age[0]);
  const homep = (Ht + At) ? r0(100 * Ht / (Ht + At)) : null;
  rsrows.push(['US total', Tt, Et, (Et ? r0(Tt / Et) : null), (Rt ? r0(Tt / Rt) : null),
    (Tt ? r0(100 * FNt / Tt) : null), FNt, MNt, (Tt ? r0(100 * C419t / Tt) : null),
    homep, (homep == null ? null : 100 - homep), IMt, Nt, RPt, nat.uniq, (nat.uniq ? round1(Tt / nat.uniq) : null)]);

  return { metrics, cards, rsrows, nat };
}

module.exports = { buildYear, MET_LABELS: MET.map((m) => m[0]), ABBR, AB2REGION };
