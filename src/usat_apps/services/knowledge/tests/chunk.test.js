'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chunk, score, tokenize } = require('../chunk');

const SAMPLE = [
  '# Coaching Certification FAQ',
  'Answers about certification, renewal, and continuing education.',
  '## Renewal',
  '### Renewal period',
  'Coaching certifications must be renewed every year. Renewal processing takes 2 to 3 weeks once CEUs and payment are received.',
  '### Continuing education',
  'To renew you must accumulate CEUs. Approved courses, clinics, and webinars count.',
  '## Fees',
  'The annual coach membership fee is separate from the certification renewal fee. Refunds for membership are generally not issued.',
  '## Background Screening',
  'All certified coaches must complete SafeSport and pass a background screen every two years.'
].join('\n');

const META = { source_ref: 'usatriathlon.org/faq', source_title: 'Coaching Certification FAQ', source_type: 'url', scope: 'queue', queue: 'Team USA' };

test('chunk() splits at headings with breadcrumb categories', function () {
  const chunks = chunk(SAMPLE, META);
  assert.ok(chunks.length >= 4, 'expected several chunks, got ' + chunks.length);
  const cats = chunks.map(function (c) { return c.category; });
  assert.ok(cats.some(function (c) { return c.indexOf('Renewal › Renewal period') >= 0; }), 'breadcrumb category present');
  chunks.forEach(function (c) {
    assert.strictEqual(c.source_ref, META.source_ref);
    assert.strictEqual(c.char_len, c.text.length);
    assert.ok(c.chunk_id.indexOf('#') > 0);
  });
});

test('chunk() merges tiny sections and never exceeds the ceiling', function () {
  const chunks = chunk(SAMPLE, META);
  chunks.forEach(function (c) { assert.ok(c.char_len <= 1100, 'chunk within ceiling'); });
});

test('chunk() windows a long heading-less blob with overlap', function () {
  const big = 'lorem ipsum dolor sit amet '.repeat(120); // ~3200 chars, no headings
  const chunks = chunk(big, META);
  assert.ok(chunks.length >= 3, 'long text produces multiple windows');
  chunks.forEach(function (c) { assert.ok(c.char_len <= 1100); });
});

test('score() ranks the right section first', function () {
  const chunks = chunk(SAMPLE, META);
  const r1 = score(chunks, 'how long does coaching renewal take?', 3);
  assert.ok(r1.length > 0 && r1[0].chunk.category.indexOf('Renewal period') >= 0, 'renewal question -> Renewal period');
  const r2 = score(chunks, 'do coaches need a background check?', 3);
  assert.ok(r2.length > 0 && r2[0].chunk.category.indexOf('Background Screening') >= 0, 'background question -> Background Screening');
  const r3 = score(chunks, 'can I get a refund on membership?', 3);
  assert.ok(r3.length > 0 && r3[0].chunk.category.indexOf('Fees') >= 0, 'refund question -> Fees');
});

test('score() returns [] for an empty/stopword-only question', function () {
  const chunks = chunk(SAMPLE, META);
  assert.deepStrictEqual(score(chunks, 'the of and', 3), []);
  assert.deepStrictEqual(score([], 'renewal', 3), []);
});

test('tokenize drops stopwords and short tokens', function () {
  assert.deepStrictEqual(tokenize('How do I renew my CEUs?'), ['renew', 'ceus']);
});
