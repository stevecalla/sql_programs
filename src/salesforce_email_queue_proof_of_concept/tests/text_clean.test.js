'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { html_to_text, strip_quoted_history } = require('../sf/text_clean');

test('html_to_text strips tags and decodes entities', function () {
  const out = html_to_text('<p>Hello&nbsp;<b>World</b> &amp; more</p>');
  assert.ok(out.indexOf('Hello World & more') >= 0, out);
  assert.ok(!/[<>]/.test(out), 'no angle brackets remain');
});

test('strip_quoted_history cuts at "On ... wrote:"', function () {
  const body = 'Thanks, that works for me.\n\nOn Tue, Jun 2, 2026 at 9:00 AM John wrote:\n> earlier stuff';
  assert.strictEqual(strip_quoted_history(body), 'Thanks, that works for me.');
});

test('strip_quoted_history cuts at Outlook From: header block', function () {
  const body = 'See my answer below.\nFrom: jane@example.com\nSent: Monday\nTo: support';
  assert.strictEqual(strip_quoted_history(body), 'See my answer below.');
});

test('strip_quoted_history cuts at quoted ">" lines', function () {
  const body = 'Quick reply.\n> you wrote this earlier\n> and this';
  assert.strictEqual(strip_quoted_history(body), 'Quick reply.');
});

test('strip_quoted_history returns full text when no quote', function () {
  assert.strictEqual(strip_quoted_history('Just a plain message.'), 'Just a plain message.');
});
