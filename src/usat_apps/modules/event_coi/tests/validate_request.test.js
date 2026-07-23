'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateRequest } = require('../store/validate_request');

const goodHolder = { name: 'Jane', address: '1 A St', city: 'Town', state: 'CO', zip: '80000', email: 'j@x.com' };
const goodReq = {
  event: { sanctionId: '123456', eventName: 'Race', eventStartDate: '08/16/2026', eventEndDate: '08/21/2026' },
  requestor: { name: 'Me', email: 'me@x.com' },
  holders: [goodHolder],
};

test('a complete request passes with no problems', () => {
  const r = validateRequest(goodReq);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.problems, []);
});

test('sanction id must be exactly 6 digits', () => {
  assert.strictEqual(validateRequest({ ...goodReq, event: { ...goodReq.event, sanctionId: '12345' } }).ok, false);
  assert.strictEqual(validateRequest({ ...goodReq, event: { ...goodReq.event, sanctionId: '1234567' } }).ok, false);
  assert.strictEqual(validateRequest({ ...goodReq, event: { ...goodReq.event, sanctionId: '12a456' } }).ok, false);
  assert.strictEqual(validateRequest({ ...goodReq, event: { ...goodReq.event, sanctionId: '123456' } }).ok, true);
});

test('missing event / requestor / holders are reported', () => {
  const r = validateRequest({ event: {}, requestor: {}, holders: [] });
  assert.ok(r.problems.includes('Event Name'));
  assert.ok(r.problems.includes('Event Start Date'));
  assert.ok(r.problems.includes('Your Name'));
  assert.ok(r.problems.includes('Your Email Address'));
  assert.ok(r.problems.includes('at least one holder'));
});

test('invalid requestor email is flagged', () => {
  const r = validateRequest({ ...goodReq, requestor: { name: 'Me', email: 'not-an-email' } });
  assert.ok(r.problems.includes('a valid requestor email'));
});

test('holders missing name/email are counted', () => {
  const r = validateRequest({ ...goodReq, holders: [{ name: '', email: '' }, { name: 'A', email: '' }] });
  assert.ok(r.problems.some((p) => /^\d+ holder names?$/.test(p)));
  assert.ok(r.problems.some((p) => /^\d+ holder emails?$/.test(p)));
  assert.strictEqual(r.ok, false);
});
