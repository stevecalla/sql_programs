'use strict';
const os = require('os'); const fs = require('fs'); const path = require('path');
process.env.EQ_CORRECTIONS_FILE = path.join(os.tmpdir(), 'eq_corr_test_' + Date.now() + '.json');
const CTX = fs.mkdtempSync(path.join(os.tmpdir(), 'eq_ctx_'));
fs.mkdirSync(path.join(CTX, '_global'), { recursive: true });
fs.writeFileSync(path.join(CTX, '_global', 'notes.md'), '# Coaching notes\nRecert review takes 5 weeks.');
fs.writeFileSync(path.join(CTX, '_global', 'fees.csv'), 'item,amount\nrecert,40');
fs.writeFileSync(path.join(CTX, '_global', 'README.md'), 'ignore me');
process.env.EQ_CONTEXT_DIR = CTX;

const test = require('node:test');
const assert = require('node:assert');
const faq = require('../ai/faq');
const corr = require('../store/corrections');

test('slug normalizes queue names', function () {
  assert.strictEqual(faq.slug('Event Services'), 'event_services');
  assert.strictEqual(faq.slug('HS Clubs'), 'hs_clubs');
});
test('load_faq returns a string (global seed present)', function () {
  const s = faq.load_faq('Coaching'); assert.strictEqual(typeof s, 'string'); assert.ok(s.length > 0);
});
test('load_context_files reads md + csv (README ignored)', async function () {
  const files = await faq.load_context_files('Coaching');
  const names = files.map(function (f) { return f.name; }).sort();
  assert.deepStrictEqual(names, ['fees.csv', 'notes.md']);
});
test('load_knowledge includes FAQ + context-file text', async function () {
  const k = await faq.load_knowledge('Coaching');
  assert.ok(k.indexOf('Recert review takes 5 weeks') >= 0, 'context text present');
  assert.ok(k.indexOf('CONTEXT FILES') >= 0, 'context header present');
});
test('corrections add / list / grounding', function () {
  corr._reset();
  const r = corr.add({ note: 'Recert review takes 4 weeks', question: 'recert time', scope: 'global' });
  assert.ok(r && r.id);
  assert.strictEqual(corr.list(true).length, 1);
  assert.ok(corr.grounding_lines(5)[0].indexOf('Recert review takes 4 weeks') >= 0);
});
test('corrections ignores an empty note', function () { corr._reset(); assert.strictEqual(corr.add({ note: '   ' }), null); });

test('save_context_file writes and list_context_meta sees it', function () {
  const r = faq.save_context_file('global', 'Coaching', 'extra.md', Buffer.from('hello world'));
  assert.strictEqual(r.name, 'extra.md');
  const meta = faq.list_context_meta('Coaching');
  assert.ok(meta.some(function (m) { return m.name === 'extra.md'; }));
});
test('save_context_file rejects unsupported types', function () {
  assert.throws(function () { faq.save_context_file('global', 'Coaching', 'evil.exe', Buffer.from('x')); });
});
