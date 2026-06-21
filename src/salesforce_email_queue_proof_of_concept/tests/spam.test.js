'use strict';
// Conservative local spam heuristic: clear cold/bulk/marketing → flagged; legit member email → not.
const test = require('node:test');
const assert = require('node:assert');
const spam = require('../ai/spam');

test('flags cold SEO / link-building outreach', function () {
  const r = spam.looks_like_spam({ from_address: 'growth@agency.biz', subject: 'Boost your Google ranking', text_new: 'Hi, we offer link building and guest post services to improve your ranking.' });
  assert.ok(r && r.spam, 'should flag');
  assert.match(r.reason, /outreach/i);
});

test('flags a bulk newsletter (unsubscribe + promo)', function () {
  const r = spam.looks_like_spam({ from_address: 'deals@store.com', subject: 'Our July newsletter', text_new: 'Big discount this week! 20% off everything. Unsubscribe here to stop these emails.' });
  assert.ok(r && r.spam, 'should flag');
});

test('flags a link-heavy promo', function () {
  const links = Array.from({ length: 9 }, function (_, i) { return 'https://x.com/' + i; }).join(' ');
  const r = spam.looks_like_spam({ subject: 'Special offer', text_new: 'Limited time promotion! ' + links });
  assert.ok(r && r.spam, 'should flag link-heavy promo');
});

test('does NOT flag a normal member email', function () {
  const r = spam.looks_like_spam({ from_address: 'jane@gmail.com', subject: 'Membership renewal question', text_new: 'Hi, I am trying to renew my USA Triathlon membership but the site shows an error. Can you help?' });
  assert.strictEqual(r, null);
});

test('does NOT flag an email that merely contains the word unsubscribe (no marketing)', function () {
  const r = spam.looks_like_spam({ from_address: 'coach@club.org', subject: 'Race results', text_new: 'Please remove me from the club list / unsubscribe me. Also, where are the Clemson results?' });
  assert.strictEqual(r, null, 'opt-out alone (no promo keyword) must not flag');
});

test('does NOT flag a single marketing word with no bulk signal', function () {
  const r = spam.looks_like_spam({ from_address: 'member@x.com', subject: 'Discount for members?', text_new: 'Is there a member discount for the national championship entry?' });
  assert.strictEqual(r, null);
});

test('count_links counts anchors then bare URLs', function () {
  assert.strictEqual(spam.count_links('', '<a href="a">x</a> <A HREF="b">y</A>'), 2);
  assert.strictEqual(spam.count_links('see https://a.com and http://b.com', ''), 2);
});
