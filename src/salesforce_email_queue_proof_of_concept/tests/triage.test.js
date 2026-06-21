'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { triage_case, parse_triage, classify_local } = require('../ai/triage');

function mock_conn(rows){ return { query:function(){ return { execute:function(){ return Promise.resolve({records:rows}); } }; } }; }

test('parse_triage reads token + reason', function () {
  const r = parse_triage('DRAFT_POSSIBLE - need the member id');
  assert.strictEqual(r.status, 'draft_possible');
  assert.ok(r.reason.indexOf('member id') >= 0);
});
test('classify_local flags a bounce as non_actionable (no AI call)', function () {
  const r = classify_local([{ incoming: true, from_address: 'MAILER-DAEMON@x.com' }]);
  assert.strictEqual(r.status, 'non_actionable');
});
test('parse_triage recognizes SPAM', function () {
  const r = require('../ai/triage').parse_triage('SPAM - marketing pitch');
  assert.strictEqual(r.status, 'spam');
});
test('classify_local flags a trailing staff reply as awaiting_reply', function () {
  const r = require('../ai/triage').classify_local([
    { incoming: true, from_address: 'coach@x.com' },
    { incoming: false, automated: false, from_address: 'agent@usat.org' }
  ]);
  assert.strictEqual(r.status, 'awaiting_reply');
});
test('classify_local does NOT treat an auto-reply as answered', function () {
  const r = require('../ai/triage').classify_local([
    { incoming: true, from_address: 'coach@x.com' },
    { incoming: false, automated: true, from_address: 'noreply@usat.org' }
  ]);
  // auto-ack is the trailing message but automated -> not awaiting_reply; falls through to model (null)
  assert.strictEqual(r, null);
});
test('classify_local flags clear cold/marketing spam (no AI call)', function () {
  const r = classify_local([{ incoming: true, from_address: 'seo@agency.biz', subject: 'Rank higher on Google',
    text_new: 'We provide link building and guest post services to boost your traffic.' }]);
  assert.strictEqual(r.status, 'spam');
});
test('classify_local lets a normal customer email fall through to the model', function () {
  const r = classify_local([{ incoming: true, from_address: 'jane@gmail.com', subject: 'Renewal help',
    text_new: 'I cannot renew my membership, the site errors out. Please help.' }]);
  assert.strictEqual(r, null);
});
test('triage_case uses the model for a normal case', async function () {
  const conn = mock_conn([{ Id:'02s1', ParentId:'500', Incoming:true, MessageDate:'2026-06-01T10:00:00.000+0000', FromAddress:'coach@x.com', CreatedBy:{Name:'Coach'}, HasAttachment:false, TextBody:'Am I certified?' }]);
  let seen=null; const complete=async function(a){ seen=a; return 'NEEDS_INFO - need certification record'; };
  const r = await triage_case({ conn: conn, case_id:'500', complete: complete });
  assert.strictEqual(r.status, 'needs_info');
  assert.ok(seen.prompt.indexOf('LATEST CUSTOMER MESSAGE') >= 0);
});
