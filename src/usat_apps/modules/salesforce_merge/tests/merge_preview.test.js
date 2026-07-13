'use strict';
// Dry-run merge preview — pure field reconciliation (survivor keeps non-blank; fills from losers;
// flags conflicts). No Salesforce, no writes.
//   node --test src/salesforce_merge/tests/merge_preview.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { build_preview } = require('../store/merge_preview');

describe('build_preview', () => {
  const records = [
    { account: 'A', name: 'John Smith', email: 'j@x.com', phone: '' },
    { account: 'B', name: 'Jon Smith', email: '', phone: '555-1212' },
  ];

  test('kept / filled / conflict classification + chosen values', () => {
    const p = build_preview(records, 'A');
    assert.equal(p.survivor, 'A');
    assert.deepEqual(p.losers, ['B']);
    const byField = Object.fromEntries(p.fields.map((f) => [f.field, f]));
    assert.equal(byField.email.status, 'kept');        // survivor has it, loser blank
    assert.equal(byField.email.chosen, 'j@x.com');
    assert.equal(byField.phone.status, 'filled');      // survivor blank, loser fills
    assert.equal(byField.phone.chosen, '555-1212');
    assert.equal(byField.name.status, 'conflict');     // both set, differ; survivor wins
    assert.equal(byField.name.chosen, 'John Smith');
    assert.equal(p.counts.kept, 1);
    assert.equal(p.counts.filled, 1);
    assert.equal(p.counts.conflict, 1);
  });

  test('switching the survivor flips fill/keep', () => {
    const p = build_preview(records, 'B');
    const byField = Object.fromEntries(p.fields.map((f) => [f.field, f]));
    assert.equal(byField.phone.status, 'kept');        // B has the phone now
    assert.equal(byField.email.status, 'filled');      // B blank, fills from A
    assert.equal(byField.email.chosen, 'j@x.com');
  });

  test('unknown survivor yields a null survivor and all losers', () => {
    const p = build_preview(records, 'ZZ');
    assert.equal(p.survivor, null);
    assert.equal(p.losers.length, 2);
  });
});
