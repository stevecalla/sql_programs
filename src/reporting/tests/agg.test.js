'use strict';
// Unit test for the aggregation port (participation_agg.buildYear) — no DB needed. Feeds synthetic
// raw rows and checks the derived metrics match the POC math.
const test = require('node:test');
const assert = require('node:assert');
const agg = require('../store/participation_agg.js');

// raw row order: [key,turnout,events,races,adult,aev,arc,fem,male,a4_19,a20_29,a30_39,a40_49,a50_59,a60,home,away,im,new,uniq]
function stateRow(k, turnout, home, im, uniq, fem, male) {
  return [k, turnout, 10, 20, turnout, 8, 15, fem, male, 0, turnout, 0, 0, 0, 0, home, turnout - home, im, 0, uniq];
}

test('buildYear derives Participants / Home% / IRONMAN correctly', () => {
  const CA = stateRow('CA', 1000, 700, 100, 800, 400, 600);
  const TX = stateRow('TX', 500, 500, 50, 450, 200, 300);
  const region = [['Pacific', 1000, 10, 20, 1000, 8, 15, 400, 600, 0, 1000, 0, 0, 0, 0, 700, 300, 100, 0, 800]];
  const y = agg.buildYear([CA, TX], region, { uniq: 1200, part: 1500 });

  const byLabel = (l) => y.metrics.find((m) => m.label === l);
  const ci = agg.ABBR.indexOf('CA');
  const ti = agg.ABBR.indexOf('TX');

  assert.strictEqual(byLabel('Participants').statez[ci], 1000);
  assert.strictEqual(byLabel('Participants').statez[ti], 500);
  // Home % = home / (home+away) = 700/1000 = 70
  assert.strictEqual(byLabel('Home %').statez[ci], 70);
  assert.strictEqual(byLabel('IRONMAN (count)').statez[ci], 100);
  // Female % = 400/1000 = 40
  assert.strictEqual(byLabel('Female %').statez[ci], 40);
  assert.strictEqual(y.nat.part, 1500);
  // states with no data are null
  assert.strictEqual(byLabel('Participants').statez[agg.ABBR.indexOf('WY')], null);
});

test('metric list has the expected 36 labels', () => {
  assert.strictEqual(agg.MET_LABELS.length, 36);
  assert.strictEqual(agg.MET_LABELS[0], 'Participants');
});
