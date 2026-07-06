'use strict';
// Unit test for the single aggregator (compute.buildYearBlock) — no DB needed. Feeds synthetic annual
// rows and checks the derived metrics match the POC math. compute.js is ESM, so it's dynamic-imported.
// (This replaces the old participation_agg.buildYear test; the two were proven byte-identical by
// store/verify_agg_parity.js before participation_agg.js was removed.)
const { test, before } = require('node:test');
const assert = require('node:assert');
const META = require('../store/mapmeta.json');

const ABBR = META.abbr, REG = META.regOrder, AB2R = META.ab2region;
let compute;
before(async () => { compute = await import('../web/src/lib/compute.js'); });

// Raw row = [key, 20 cols]: turnout,events,races,adult,aev,arc,fem,male,a4_19..a60(6),home,away,im,new,uniq,unknown.
// home + away + unknown must sum to turnout (the reconciliation the ETL now guarantees).
function row(k, turnout, home, away, unknown, im, uniq, fem, male) {
  return [k, turnout, 10, 20, turnout, 8, 15, fem, male, 0, turnout, 0, 0, 0, 0, home, away, im, 0, uniq, unknown];
}
const pBundle = () => ({ meta: META.meta, abbr: ABBR, ab2region: AB2R, regOrder: REG, names: META.names, rawByYM: {} });

test('buildYearBlock derives Participants / Home% / IRONMAN / Female% correctly', () => {
  const CA = row('CA', 1000, 700, 200, 100, 100, 800, 400, 600);   // CA -> Pacific
  const TX = row('TX', 500, 500, 0, 0, 50, 450, 200, 300);         // TX -> Central
  // Region rows must reconcile with the state rows (national Tt is summed over regions): Pacific=CA, Central=TX.
  const region = [row('Pacific', 1000, 700, 200, 100, 100, 800, 400, 600), row('Central', 500, 500, 0, 0, 50, 450, 200, 300)];
  const uq = { state: { CA: 800, TX: 450 }, region: { Pacific: 800, Central: 450 }, nat: 1200, approx: false };
  const y = compute.buildYearBlock([CA, TX], region, uq, pBundle());

  const byLabel = (l) => y.metrics.find((m) => m.label === l);
  const ci = ABBR.indexOf('CA'), ti = ABBR.indexOf('TX');

  assert.strictEqual(byLabel('Participants').statez[ci], 1000);
  assert.strictEqual(byLabel('Participants').statez[ti], 500);
  // Home % is now of TOTAL participants (home / turnout) = 700 / 1000 = 70.
  assert.strictEqual(byLabel('Home %').statez[ci], 70);
  // Known home % excludes Unknown (home / (home + away)) = 700 / 900 = 78 (rounded).
  assert.strictEqual(byLabel('Known home %').statez[ci], 78);
  assert.strictEqual(byLabel('IRONMAN (count)').statez[ci], 100);
  // Female % = 400 / 1000 = 40.
  assert.strictEqual(byLabel('Female %').statez[ci], 40);
  assert.strictEqual(y.nat.part, 1500);
  // States with no data are null.
  assert.strictEqual(byLabel('Participants').statez[ABBR.indexOf('WY')], null);
});

test('home + away + unknown reconcile to Participants', () => {
  const CA = row('CA', 1000, 700, 200, 100, 100, 800, 400, 600);
  const uq = { state: { CA: 800 }, region: { Pacific: 800 }, nat: 800, approx: false };
  const y = compute.buildYearBlock([CA], [row('Pacific', 1000, 700, 200, 100, 100, 800, 400, 600)], uq, pBundle());
  const val = (l) => y.metrics.find((m) => m.label === l).statez[ABBR.indexOf('CA')];
  assert.strictEqual(val('Home (count)') + val('Away (count)') + val('Unknown home (count)'), val('Participants'));
});

test('metric list matches mapmeta.json and starts with Participants', () => {
  const CA = row('CA', 100, 60, 30, 10, 5, 90, 40, 60);
  const y = compute.buildYearBlock([CA], [row('Pacific', 100, 60, 30, 10, 5, 90, 40, 60)],
    { state: { CA: 90 }, region: { Pacific: 90 }, nat: 90, approx: false }, pBundle());
  assert.strictEqual(y.metrics.length, META.meta.length);
  assert.strictEqual(y.metrics[0].label, 'Participants');
});
