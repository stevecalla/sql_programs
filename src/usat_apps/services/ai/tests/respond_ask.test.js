'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { respond_to_case, parse_verdict } = require('../respond');
const { ask_about_case } = require('../ask');

test('parse_verdict reads VERDICT + body', function () {
  const r = parse_verdict('VERDICT: DRAFT\n---\nHello, here is your answer.');
  assert.strictEqual(r.verdict, 'draft');
  assert.ok(r.body.indexOf('Hello') >= 0);
});
test('parse_verdict recognizes NEED_INFO', function () {
  const r = parse_verdict('VERDICT: NEED_INFO --- need the member id');
  assert.strictEqual(r.verdict, 'need_info');
});
test('respond_to_case runs data-in with an injected model (no SF)', async function () {
  const thread = [{ incoming: true, from_address: 'jane@x.com', subject: 'Renewal', text_new: 'Cannot renew.' }];
  let seen = null; const complete = async function (a) { seen = a; return 'VERDICT: DRAFT\n---\nHi Jane, here is how to renew.'; };
  const r = await respond_to_case({ thread: thread, complete: complete });
  assert.strictEqual(r.verdict, 'draft');
  assert.strictEqual(r.messages, 1);
  assert.ok(seen && seen.prompt.length > 0);
});
test('ask_about_case runs data-in with an injected model (no SF)', async function () {
  const thread = [{ incoming: true, from_address: 'jane@x.com', subject: 'Renewal', text_new: 'Cannot renew.' }];
  const complete = async function () { return 'She is a current member.'; };
  const r = await ask_about_case({ thread: thread, question: 'Is she a member?', complete: complete });
  assert.ok(r.answer.indexOf('member') >= 0);
});
