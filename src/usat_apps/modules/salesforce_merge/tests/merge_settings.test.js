'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../store/merge_settings');

test('defaults when no db source and no env', async () => {
  const save = { ...process.env };
  delete process.env.MERGE_PARALLEL; delete process.env.MERGE_CHUNK_SIZE; delete process.env.MERGE_MAX_BATCH; delete process.env.MERGE_WORKER_TARGET;
  assert.equal(await S.get('parallel_enabled'), true);
  assert.equal(await S.get('chunk_size'), 5);
  assert.equal(await S.get('max_batch'), 100);
  assert.equal(await S.get('worker_target'), 4);
  process.env = save;
});

test('env overrides default; coerced + clamped', async () => {
  const save = { ...process.env };
  process.env.MERGE_PARALLEL = 'off'; process.env.MERGE_CHUNK_SIZE = '999'; process.env.MERGE_WORKER_TARGET = '0';
  assert.equal(await S.get('parallel_enabled'), false);
  assert.equal(await S.get('chunk_size'), 50);   // clamped to max
  assert.equal(await S.get('worker_target'), 1);  // clamped to min
  process.env = save;
});

test('db source wins over env, with source label', async () => {
  const save = { ...process.env };
  process.env.MERGE_CHUNK_SIZE = '5';
  const src = async (k) => (k === 'chunk_size' ? '8' : null);
  const r = await S.resolve('chunk_size', src);
  assert.equal(r.value, 8);
  assert.equal(r.source, 'db');
  // a key the db doesn't have falls back to env
  const r2 = await S.resolve('chunk_size', async () => null);
  assert.equal(r2.value, 5);
  assert.equal(r2.source, 'env');
  process.env = save;
});

test('coerce validates + clamps admin input', () => {
  assert.equal(S.coerce('chunk_size', '7'), 7);
  assert.equal(S.coerce('chunk_size', '100'), 50);   // clamp hi
  assert.equal(S.coerce('max_batch', '99999'), 5000);  // clamp hi (real ceiling is max_batch_hard, applied at runtime)
  assert.equal(S.coerce('max_batch_hard', '99999'), 5000);  // hard cap clamp
  assert.equal(S.coerce('parallel_enabled', 'true'), true);
  assert.equal(S.coerce('parallel_enabled', 'nope'), true); // unknown → default
  assert.equal(S.coerce('bogus', 'x'), null);
});

test('get_all returns value+source+def for every key (incl. apex cap)', async () => {
  const all = await S.get_all(async () => null);
  assert.deepStrictEqual(Object.keys(all).sort(), ['apex_settle_sec', 'apex_stop_enabled', 'apex_stop_threshold', 'api_stop_enabled', 'api_stop_threshold', 'chunk_size', 'max_batch', 'max_batch_hard', 'parallel_enabled', 'worker_target']);
  assert.ok('value' in all.chunk_size && 'source' in all.chunk_size && 'def' in all.chunk_size);
});

test('apex_should_pause: true only when enabled, reading present, used >= threshold', () => {
  assert.equal(S.apex_should_pause(200000, { enabled: true, threshold: 200000 }), true);  // at cap
  assert.equal(S.apex_should_pause(210000, { enabled: true, threshold: 200000 }), true);  // over cap
  assert.equal(S.apex_should_pause(150000, { enabled: true, threshold: 200000 }), false); // under cap
  assert.equal(S.apex_should_pause(210000, { enabled: false, threshold: 200000 }), false); // disabled
  assert.equal(S.apex_should_pause(null, { enabled: true, threshold: 200000 }), false);    // no reading
  assert.equal(S.apex_should_pause(210000, { enabled: true, threshold: NaN }), false);     // bad threshold
});

test('apex_stop_threshold clamps to the 250k daily ceiling', () => {
  assert.equal(S.coerce('apex_stop_threshold', '999999'), 250000);
  assert.equal(S.coerce('apex_stop_threshold', '150000'), 150000);
  assert.equal(S.coerce('apex_stop_threshold', '10'), 1000); // floor
});

test('api cap: ON by default, absolute threshold clamps 1k..5M, reuses the used>=threshold rule', async () => {
  assert.equal(await S.get('api_stop_enabled', async () => null), true);    // on by default (like apex)
  assert.equal(await S.get('api_stop_threshold', async () => null), 300000); // default ≈73% of prod's ~410k
  assert.equal(S.coerce('api_stop_threshold', '9999999'), 5000000);          // sandbox ceiling
  assert.equal(S.coerce('api_stop_threshold', '300000'), 300000);
  assert.equal(S.coerce('api_stop_threshold', '10'), 1000);                  // floor
  assert.equal(S.apex_should_pause(300000, { enabled: true, threshold: 300000 }), true);  // at cap
  assert.equal(S.apex_should_pause(290000, { enabled: true, threshold: 300000 }), false); // under cap
});
