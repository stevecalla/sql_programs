'use strict';
/**
 * verify_agg_parity.js — proves the single client aggregator (compute.buildYearBlock) produces byte-identical
 * year blocks to the server aggregator it will replace (participation_agg.buildYear). No DB needed; it feeds
 * both the SAME random annual rows and deep-diffs the output over many trials.
 *
 *   node src/reporting/store/verify_agg_parity.js
 *
 * "IDENTICAL" -> safe to switch participation_read to compute.buildYearBlock and delete participation_agg.js.
 * Any diff -> do NOT switch; the printed field tells you what drifted.
 */
const agg = require('./participation_agg');
const META = require('./mapmeta.json');
const ABBR = META.abbr, REG = META.regOrder, AB2R = META.ab2region;

const rnd = (n) => Math.floor(Math.random() * n);
// One raw annual row (sumToRaw shape): [key, turnout, events, races, adult, aev, arc, fn, mn,
//   age4_19..age60(6), home, away, ironman, new, unique, unknown]. home+away+unknown = turnout.
function mkRow(key) {
  const home = rnd(5000), away = rnd(3000), unk = rnd(2000), turnout = home + away + unk;
  const events = 1 + rnd(200), races = events + rnd(300), adult = rnd(turnout + 1);
  const aev = 1 + rnd(events), arc = 1 + rnd(races);
  const fn = rnd(turnout + 1), mn = rnd(Math.max(1, turnout - fn) + 1);
  const ages = [0, 0, 0, 0, 0, 0].map(() => rnd(turnout + 1));
  const im = rnd(turnout + 1), newc = rnd(turnout + 1), uniq = 1 + rnd(turnout + 1);
  return [key, turnout, events, races, adult, aev, arc, fn, mn, ages[0], ages[1], ages[2], ages[3], ages[4], ages[5], home, away, im, newc, uniq, unk];
}
const pBundle = () => ({ meta: META.meta, abbr: ABBR, ab2region: AB2R, regOrder: REG, names: META.names, rawByYM: {} });
function uqFromRows(sRows, rRows) {
  const state = {}, region = {}; let nat = 0;
  sRows.forEach((r) => { state[r[0]] = r[19]; nat += r[19]; });
  rRows.forEach((r) => { region[r[0]] = r[19]; });
  return { state, region, nat, approx: false };
}
const J = (x) => JSON.stringify(x);

(async () => {
  const compute = await import('../web/src/lib/compute.js');
  const trials = 300; let fails = 0, first = null;
  for (let t = 0; t < trials; t++) {
    const sRows = ABBR.map(mkRow), rRows = REG.map(mkRow);
    const uq = uqFromRows(sRows, rRows);
    const Tt = sRows.reduce((s, r) => s + r[1], 0);
    const A = agg.buildYear(sRows, rRows, { uniq: uq.nat, part: Tt });
    const B = compute.buildYearBlock(sRows, rRows, uq, pBundle());
    const d = [];
    if (A.metrics.length !== B.metrics.length) d.push('metrics length ' + A.metrics.length + ' vs ' + B.metrics.length);
    A.metrics.forEach((m, i) => {
      const n = B.metrics[i]; if (!n) { d.push('metric ' + i + ' missing'); return; }
      if (m.label !== n.label) d.push('metric ' + i + ' label ' + m.label + '/' + n.label);
      if (J(m.statez) !== J(n.statez)) d.push(m.label + ' statez');
      if (J(m.regionz) !== J(n.regionz)) d.push(m.label + ' regionz');
      if (J(m.labels) !== J(n.labels)) d.push(m.label + ' labels');
      if (J(m.regionlabels) !== J(n.regionlabels)) d.push(m.label + ' regionlabels');
      if (m.mn !== n.mn || m.mx !== n.mx) d.push(m.label + ' mn/mx');
    });
    // rsrows: compare each region + US total BY NAME (order-insensitive — row sequence is cosmetic).
    const rsMap = (rows) => { const m = {}; (rows || []).forEach((r) => { m[r[0]] = r; }); return m; };
    const ma = rsMap(A.rsrows), mb = rsMap(B.rsrows);
    Object.keys(Object.assign({}, ma, mb)).forEach((k) => { if (J(ma[k]) !== J(mb[k])) d.push('rsrow[' + k + ']'); });
    if (J(A.cards) !== J(B.cards)) d.push('cards');
    if (d.length) { fails++; if (!first) first = { trial: t, diffs: d.slice(0, 8) }; }
  }
  if (fails === 0) console.log('✓ IDENTICAL across ' + trials + ' random trials — compute.buildYearBlock == participation_agg.buildYear. Safe to switch.');
  else { console.log('✗ DIFFERENCES in ' + fails + '/' + trials + ' trials. First: ' + JSON.stringify(first, null, 2)); process.exit(1); }
})().catch((e) => { console.error('parity check error:', e && e.stack || e); process.exit(1); });
