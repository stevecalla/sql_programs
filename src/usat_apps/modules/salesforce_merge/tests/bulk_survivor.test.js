'use strict';
// Tests the SHARED bulk survivor cascade (reviews_read.pick_bulk_survivor) used by BOTH
// resolve_merge_groups and resolve_duplicate_groups — one implementation, tested once.
// Cascade: (1) account whose id equals the group merge id; else (2) lowest membership number;
// else null (needs a deeper child-count/oldest tie-break — left for single review).
const { test } = require('node:test');
const assert = require('node:assert');
const { pick_bulk_survivor } = require('../store/reviews_read');

const mk = (rows) => {
  const m = new Map(rows.map((r) => [r.a, r]));
  return { ids: rows.map((r) => r.a), mergeIdOf: (a) => m.get(a).merge_id, memberOf: (a) => m.get(a).member };
};

test('survivor = account whose id equals the group merge id', () => {
  const g = mk([{ a: 'A', merge_id: 'A', member: '900' }, { a: 'B', merge_id: 'A', member: '100' }]);
  const r = pick_bulk_survivor(g.ids, g.mergeIdOf, g.memberOf);
  assert.equal(r.survivor, 'A'); assert.equal(r.rule, 'merge_id');
});

test('no merge id -> lowest member number wins', () => {
  const g = mk([{ a: 'A', merge_id: '', member: '900' }, { a: 'B', merge_id: '', member: '100' }]);
  const r = pick_bulk_survivor(g.ids, g.mergeIdOf, g.memberOf);
  assert.equal(r.survivor, 'B'); assert.equal(r.rule, 'member_number');
});

test('no merge id and no member number -> not resolvable (survivor null)', () => {
  const g = mk([{ a: 'A', merge_id: '', member: '' }, { a: 'B', merge_id: '', member: '' }]);
  const r = pick_bulk_survivor(g.ids, g.mergeIdOf, g.memberOf);
  assert.equal(r.survivor, null); assert.equal(r.rule, null);
});

test('merge id not among the accounts falls through to member number', () => {
  const g = mk([{ a: 'A', merge_id: 'ZZZ', member: '5' }, { a: 'B', merge_id: 'ZZZ', member: '3' }]);
  const r = pick_bulk_survivor(g.ids, g.mergeIdOf, g.memberOf);
  assert.equal(r.survivor, 'B'); assert.equal(r.rule, 'member_number');
});
