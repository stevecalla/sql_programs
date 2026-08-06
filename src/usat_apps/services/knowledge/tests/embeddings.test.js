'use strict';
const test = require('node:test');
const assert = require('node:assert');
const emb = require('../embeddings');

test('cosine: identical vectors = 1, orthogonal = 0', function () {
  const a = Float32Array.from([1, 2, 3]);
  assert.ok(Math.abs(emb.cosine(a, a) - 1) < 1e-6);
  assert.ok(Math.abs(emb.cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))) < 1e-6);
  assert.strictEqual(emb.cosine(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3])), 0); // length mismatch
  assert.strictEqual(emb.cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1])), 0);   // zero vector
});

test('float32 <-> buffer round-trips exactly', function () {
  const v = Float32Array.from([0.5, -1.25, 3.0, 0]);
  const back = emb.from_buffer(emb.to_buffer(v));
  assert.strictEqual(back.length, 4);
  for (let i = 0; i < v.length; i++) assert.strictEqual(back[i], v[i]);
  assert.strictEqual(emb.from_buffer(null), null);
});

test('minmax scales to 0..1; all-equal -> 1 with signal, 0 without', function () {
  assert.deepStrictEqual(emb.minmax([0, 5, 10]), [0, 0.5, 1]);
  assert.deepStrictEqual(emb.minmax([3, 3, 3]), [1, 1, 1]);
  assert.deepStrictEqual(emb.minmax([0, 0, 0]), [0, 0, 0]);
  assert.deepStrictEqual(emb.minmax([]), []);
});

test('blend weight endpoints and midpoint order correctly', function () {
  // Two candidates. A wins on keyword, B wins on semantic.
  const kw = [10, 2];   // A >> B
  const sem = [0.1, 0.9]; // B >> A
  const w0 = emb.blend(kw, sem, 0);   // keyword only -> A(1) > B(0)
  assert.ok(w0[0] > w0[1]);
  const w1 = emb.blend(kw, sem, 1);   // semantic only -> B(1) > A(0)
  assert.ok(w1[1] > w1[0]);
  const wh = emb.blend(kw, sem, 0.5); // even -> both ~0.5, tie-ish
  assert.ok(Math.abs(wh[0] - 0.5) < 1e-6 && Math.abs(wh[1] - 0.5) < 1e-6);
  // clamps out-of-range weight
  assert.deepStrictEqual(emb.blend(kw, sem, 2), emb.blend(kw, sem, 1));
  assert.deepStrictEqual(emb.blend(kw, sem, -1), emb.blend(kw, sem, 0));
});

test('blend tolerates missing semantic scores (treated as 0 -> leans keyword)', function () {
  const out = emb.blend([10, 5], [], 0.5);
  assert.strictEqual(out.length, 2);
  assert.ok(out[0] > out[1]); // keyword order preserved when semantic absent
});
