'use strict';
process.env.EVENT_COI_MAX_CONCURRENT = '2';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../store/run_control');

function gatedDriver() {
  let parked = [];
  const d = {
    async open() { return {}; },
    login() { return new Promise((res) => parked.push(res)); }, // parks each run in 'login' (ACTIVE)
    async openForm() {}, async fill() {}, async screenshot() { return 'shot'; },
    async submit() { return { ok: true, confirmation: 'ok' }; },
    async close() {},
  };
  return { d, releaseAll() { const p = parked; parked = []; p.forEach((r) => r()); } };
}
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n){ for(let i=0;i<(n||8);i++) await tick(); }

test('caps concurrent runs at MAX and queues the rest, then drains', async () => {
  const g = gatedDriver();
  const batch = { event:{}, requestor:{}, options:{}, holders:[{name:'A'}] };
  const runs = [];
  for (let i=0;i<4;i++) runs.push(rc.start(batch, { driver: g.d, mode:'auto', headless:true }));
  await settle();
  let s = rc.stats();
  assert.strictEqual(s.max, 2, 'MAX honored from env');
  assert.strictEqual(s.running, 2, 'only MAX run at once');
  assert.strictEqual(s.queued, 2, 'the rest are queued');
  assert.strictEqual(runs.filter(r=>r.status==='queued').length, 2, 'two runs report queued status');

  g.releaseAll();          // finish the 2 running -> their slots free -> queued 2 launch
  await settle();
  s = rc.stats();
  assert.strictEqual(s.queued, 0, 'queue drained once slots freed');
  assert.ok(s.running <= 2, 'never exceeds MAX');

  g.releaseAll();          // finish the last 2
  await settle();
  assert.strictEqual(rc.stats().running, 0, 'all runs completed');
});

test('stop on a queued run removes it from the line', async () => {
  const g = gatedDriver();
  const batch = { event:{}, requestor:{}, options:{}, holders:[{name:'A'}] };
  const a = rc.start(batch,{driver:g.d,mode:'auto'});
  const b = rc.start(batch,{driver:g.d,mode:'auto'});
  const c = rc.start(batch,{driver:g.d,mode:'auto'}); // queued (MAX=2)
  await settle();
  assert.strictEqual(c.status,'queued');
  rc.decide(c.id,'stop');
  await settle();
  assert.strictEqual(rc.stats().queued, 0, 'stopped queued run left the line');
  g.releaseAll(); await settle();
});
