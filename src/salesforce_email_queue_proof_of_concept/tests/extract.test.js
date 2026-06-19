'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extract_text } = require('../ai/extract');

test('extracts plain text / csv', async function () {
  const r = await extract_text(Buffer.from('a,b\n1,2'), { file_extension: 'csv', title: 'data' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.text.indexOf('a,b') >= 0);
});

test('converts html to text', async function () {
  const r = await extract_text(Buffer.from('<p>Hello <b>World</b></p>'), { file_extension: 'html', title: 'page' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.text.indexOf('Hello World') >= 0);
});

test('degrades gracefully when a binary parser is unavailable', async function () {
  const r = await extract_text(Buffer.from('%PDF-1.4 fake'), { file_extension: 'pdf', title: 'waiver', content_size: 10 });
  assert.strictEqual(r.ok, false);
  assert.ok(/not available|parse failed/.test(r.note), r.note);
});

test('empty buffer is handled', async function () {
  const r = await extract_text(null, { file_extension: 'pdf', title: 'x' });
  assert.strictEqual(r.ok, false);
});
