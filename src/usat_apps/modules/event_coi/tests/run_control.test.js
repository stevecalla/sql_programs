'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../store/run_control');

// A fake driver: same interface as portal_driver, but no browser — just records submit calls.
function fakeDriver(overrides) {
  const calls = { submits: 0 };
  return Object.assign({
    calls,
    async open() { return { fake: true }; },
    async login() {},
    async openForm() {},
    async fill() {},
    async screenshot() { return 'data:image/png;base64,AAAA'; },
    async submit() { calls.submits += 1; return { ok: true }; },
    async close() {},
  }, overrides || {});
}
function collector() {
  const events = [];
  return { events, res: { write: (s) => events.push(JSON.parse(s.replace(/^data: /, '').replace(/\n\n$/, ''))) } };
}
function until(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout waiting for condition'));
      setImmediate(poll);
    })();
  });
}
const batch = (n) => ({ event: {}, requestor: {}, options: {}, holders: Array.from({ length: n }, (_, i) => ({ name: 'H' + i, email: 'h' + i + '@x.com' })) });

test('review mode: approve first, then approve-all submits the rest', async () => {
  const d = fakeDriver();
  const run = rc.start(batch(3), { driver: d, mode: 'review' });
  const c = collector(); rc.subscribe(run.id, c.res);
  await until(() => c.events.some((e) => e.type === 'awaiting' && e.index === 0));
  rc.decide(run.id, 'approve');
  await until(() => c.events.some((e) => e.type === 'result' && e.index === 0 && e.status === 'submitted'));
  await until(() => c.events.some((e) => e.type === 'awaiting' && e.index === 1));
  rc.decide(run.id, 'approve-all');
  await until(() => c.events.some((e) => e.type === 'done'));
  assert.strictEqual(run.results.length, 3);
  assert.ok(run.results.every((r) => r.status === 'submitted'));
  assert.strictEqual(d.calls.submits, 3);
});

test('skip records a skipped result and does not submit that holder', async () => {
  const d = fakeDriver();
  const run = rc.start(batch(2), { driver: d, mode: 'review' });
  const c = collector(); rc.subscribe(run.id, c.res);
  await until(() => c.events.some((e) => e.type === 'awaiting' && e.index === 0));
  rc.decide(run.id, 'skip');
  await until(() => c.events.some((e) => e.type === 'awaiting' && e.index === 1));
  rc.decide(run.id, 'approve');
  await until(() => c.events.some((e) => e.type === 'done'));
  assert.strictEqual(run.results[0].status, 'skipped');
  assert.strictEqual(run.results[1].status, 'submitted');
  assert.strictEqual(d.calls.submits, 1);
});

test('auto mode submits all holders without pausing', async () => {
  const d = fakeDriver();
  const run = rc.start(batch(4), { driver: d, mode: 'auto' });
  const c = collector(); rc.subscribe(run.id, c.res);
  await until(() => c.events.some((e) => e.type === 'done'));
  assert.strictEqual(run.results.length, 4);
  assert.ok(run.results.every((r) => r.status === 'submitted'));
  assert.strictEqual(d.calls.submits, 4);
});

test('a failed submit is recorded and the loop continues', async () => {
  const d = fakeDriver({ async submit() { this.calls.submits += 1; return this.calls.submits === 1 ? { ok: false, error: 'boom' } : { ok: true }; } });
  const run = rc.start(batch(2), { driver: d, mode: 'auto' });
  const c = collector(); rc.subscribe(run.id, c.res);
  await until(() => c.events.some((e) => e.type === 'done'));
  assert.strictEqual(run.results[0].status, 'failed');
  assert.strictEqual(run.results[0].error, 'boom');
  assert.strictEqual(run.results[1].status, 'submitted');
});

test('stop halts the run before all holders are processed', async () => {
  const d = fakeDriver();
  const run = rc.start(batch(5), { driver: d, mode: 'review' });
  const c = collector(); rc.subscribe(run.id, c.res);
  await until(() => c.events.some((e) => e.type === 'awaiting' && e.index === 0));
  rc.decide(run.id, 'stop');
  await until(() => c.events.some((e) => e.type === 'done' && e.status === 'stopped'));
  assert.strictEqual(run.status, 'stopped');
  assert.ok(run.results.length < 5);
});
