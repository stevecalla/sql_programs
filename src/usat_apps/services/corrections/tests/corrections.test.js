'use strict';
const test = require('node:test');
const assert = require('node:assert');
const corr = require('../index');

function memStore() {
  const rows = [];
  return { async insert(r) { rows.push(r); return r; }, async all() { return rows.slice(); } };
}

test('add builds a record; list + grounding_lines return it', async function () {
  const s = memStore();
  const r = await corr.add({ note: 'Recert review takes 4 weeks', question: 'recert time', scope: 'global' }, s);
  assert.ok(r && r.id);
  assert.strictEqual((await corr.list(s)).length, 1);
  const lines = await corr.grounding_lines(s, 5);
  assert.ok(lines[0].indexOf('Recert review takes 4 weeks') >= 0);
});
test('add ignores an empty note', async function () {
  assert.strictEqual(await corr.add({ note: '   ' }, memStore()), null);
});
test('grounding respects scope (me / queue / global)', async function () {
  const s = memStore();
  await corr.add({ note: 'GLOBAL fact', scope: 'global' }, s);
  await corr.add({ note: 'QUEUE fact', scope: 'queue', queue: 'Coaching' }, s);
  await corr.add({ note: 'MINE fact', scope: 'me', author: 'skip' }, s);
  const forSkip = (await corr.grounding_lines(s, 12, { queue: 'Coaching', user: 'skip' })).join(' | ');
  assert.ok(forSkip.indexOf('GLOBAL fact') >= 0 && forSkip.indexOf('QUEUE fact') >= 0 && forSkip.indexOf('MINE fact') >= 0);
  const forOther = (await corr.grounding_lines(s, 12, { queue: 'Rankings', user: 'other' })).join(' | ');
  assert.ok(forOther.indexOf('GLOBAL fact') >= 0, 'global always applies');
  assert.ok(forOther.indexOf('QUEUE fact') < 0, 'queue-scoped excluded on other queue');
  assert.ok(forOther.indexOf('MINE fact') < 0, 'me-scoped excluded for other user');
});
test('list(false) includes inactive rows', async function () {
  const s = memStore();
  const r = await corr.add({ note: 'x' }, s); r.active = 0;
  assert.strictEqual((await corr.list(s, false)).length, 1);
  assert.strictEqual((await corr.list(s)).length, 0);
});
