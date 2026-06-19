'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse_verdict, respond_to_case } = require('../ai/respond');
const { ask_about_case } = require('../ai/ask');

function mock_conn(routes) {
  return { query: function (soql) { return { execute: function () {
    for (let i = 0; i < routes.length; i++) if (routes[i].match.test(soql)) return Promise.resolve({ records: routes[i].records });
    return Promise.resolve({ records: [] });
  } }; } };
}

const THREAD_ROUTE = { match: /FROM EmailMessage WHERE ParentId/, records: [
  { Id: '02s1', ParentId: '500', Incoming: true, MessageDate: '2026-06-01T10:00:00.000+0000', FromAddress: 'coach@x.com', CreatedBy: { Name: 'Automated Process' }, HasAttachment: false, TextBody: 'Am I certified to coach youth athletes?' }
] };
const HISTORY_ROUTE = { match: /FROM Case WHERE SuppliedEmail/, records: [
  { Id: '500B', CaseNumber: '0009', Subject: 'Past question', Status: 'Closed', CreatedDate: '2026-05-01T10:00:00.000+0000' }
] };

test('parse_verdict reads DRAFT + body', function () {
  const r = parse_verdict('VERDICT: DRAFT\n---\nHello there.');
  assert.strictEqual(r.verdict, 'draft');
  assert.strictEqual(r.body, 'Hello there.');
});

test('parse_verdict reads NEED_INFO', function () {
  const r = parse_verdict('VERDICT: NEED_INFO\n---\n- need membership id');
  assert.strictEqual(r.verdict, 'need_info');
});

test('respond_to_case assembles context and parses provider output', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  let seen = null;
  const complete = async function (args) { seen = args; return 'VERDICT: DRAFT\n---\nThanks for reaching out.'; };
  const r = await respond_to_case({ conn: conn, case_id: '500', complete: complete });
  assert.strictEqual(r.verdict, 'draft');
  assert.strictEqual(r.body, 'Thanks for reaching out.');
  assert.strictEqual(r.sender_email, 'coach@x.com');
  assert.ok(seen.prompt.indexOf('CURRENT EMAIL THREAD') >= 0);
  assert.ok(seen.prompt.indexOf('Am I certified') >= 0);
  assert.ok(seen.prompt.indexOf('PRIOR CASES FROM THIS SENDER') >= 0);
  assert.ok(seen.system.indexOf('USA Triathlon') >= 0);
});

test('ask_about_case returns the provider answer', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  const complete = async function () { return 'Based on the thread, yes.'; };
  const r = await ask_about_case({ conn: conn, case_id: '500', question: 'Summarize', complete: complete });
  assert.strictEqual(r.answer, 'Based on the thread, yes.');
});

test('ask_about_case folds prior Q&A history into the prompt', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  let seen = null;
  const complete = async function (a) { seen = a; return 'ok'; };
  await ask_about_case({ conn: conn, case_id: '500', question: 'follow up', history: [{ q: 'prior q', a: 'prior a' }], complete: complete });
  assert.ok(seen.prompt.indexOf('EARLIER Q&A') >= 0);
  assert.ok(seen.prompt.indexOf('prior q') >= 0);
});
