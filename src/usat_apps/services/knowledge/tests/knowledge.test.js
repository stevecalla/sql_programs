'use strict';
const os = require('os'); const fs = require('fs'); const path = require('path');
const CTX = fs.mkdtempSync(path.join(os.tmpdir(), 'eq_ctx_'));
fs.mkdirSync(path.join(CTX, '_global'), { recursive: true });
fs.writeFileSync(path.join(CTX, '_global', 'notes.md'), '# Coaching notes\nRecert review takes 5 weeks.');
fs.writeFileSync(path.join(CTX, '_global', 'fees.csv'), 'item,amount\nrecert,40');
fs.writeFileSync(path.join(CTX, '_global', 'README.md'), 'ignore me');
process.env.EQ_CONTEXT_DIR = CTX;
process.env.EQ_DATA_DIR = CTX;

const test = require('node:test');
const assert = require('node:assert');
const faq = require('../index');

test('slug normalizes queue/scope names', function () {
  assert.strictEqual(faq.slug('Event Services'), 'event_services');
  assert.strictEqual(faq.slug('HS Clubs'), 'hs_clubs');
});
test('load_context_files reads md + csv (README ignored)', async function () {
  const files = await faq.load_context_files('Coaching');
  const names = files.map(function (f) { return f.name; }).sort();
  assert.deepStrictEqual(names, ['fees.csv', 'notes.md']);
});
test('load_knowledge is built from the context folder', async function () {
  const k = await faq.load_knowledge('Coaching');
  assert.ok(k.indexOf('Recert review takes 5 weeks') >= 0, 'context text present');
  assert.ok(k.indexOf('KNOWLEDGE / CONTEXT') >= 0, 'knowledge header present');
});
test('save_context_file writes and list_context_meta sees it', async function () {
  const r = await faq.save_context_file('global', 'Coaching', 'extra.md', Buffer.from('hello world'));
  assert.strictEqual(r.name, 'extra.md');
  const meta = await faq.list_context_meta('Coaching');
  assert.ok(meta.some(function (m) { return m.name === 'extra.md'; }));
});
test('save_context_file rejects unsupported types', async function () {
  await assert.rejects(async function () { await faq.save_context_file('global', 'Coaching', 'evil.exe', Buffer.from('x')); });
});
test('set_context_excluded removes a file from grounding but keeps it on disk', async function () {
  await faq.save_context_file('global', 'Coaching', 'drop_me.md', Buffer.from('SECRETMARKER content'));
  let meta = await faq.list_context_meta('Coaching');
  const row = meta.filter(function (m) { return m.name === 'drop_me.md'; })[0];
  assert.ok(row && row.key && row.excluded === false, 'listed + not excluded yet');
  let k = await faq.load_knowledge('Coaching');
  assert.ok(k.indexOf('SECRETMARKER') >= 0, 'included before exclude');
  faq.set_context_excluded(row.key, true);
  meta = await faq.list_context_meta('Coaching');
  assert.ok(meta.filter(function (m) { return m.name === 'drop_me.md'; })[0].excluded === true, 'now flagged excluded');
  k = await faq.load_knowledge('Coaching');
  assert.ok(k.indexOf('SECRETMARKER') < 0, 'excluded from grounding');
  assert.ok(fs.existsSync(await faq.find_context_path('Coaching', 'drop_me.md')), 'still on disk');
  faq.set_context_excluded(row.key, false);
});
test('read_context_file is type-aware (text vs table)', async function () {
  await faq.save_context_file('global', 'Coaching', 'rows.csv', Buffer.from('a,b\n1,2'));
  const t = await faq.read_context_file('global', 'Coaching', 'notes.md');
  assert.strictEqual(t.kind, 'text');
  const c = await faq.read_context_file('global', 'Coaching', 'rows.csv');
  assert.strictEqual(c.kind, 'table');
  assert.deepStrictEqual(c.rows[0], ['a', 'b']);
});
test('find_context_path throws for a missing file', async function () {
  await assert.rejects(function () { return faq.find_context_path('Coaching', 'nope_does_not_exist.md'); });
});
