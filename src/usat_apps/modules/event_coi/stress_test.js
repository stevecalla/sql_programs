#!/usr/bin/env node
'use strict';
/**
 * stress_test.js — spin up N concurrent COI runs through the real concurrency engine (run_control) to
 * see how many Playwright/Chromium sessions this machine handles at once, and how the cap+queue behave.
 *
 * Each run does the REAL work — launch Chromium, log into the CSR24 portal, open the form, fill a test
 * holder, screenshot — then SKIPS the final Submit click (a wrapped driver returns a stub). So it stresses
 * the browsers WITHOUT sending any certificate to the portal. Nothing is submitted.
 *
 *   node src/usat_apps/modules/event_coi/stress_test.js              # prompts for count + holders
 *   STRESS_N=8 STRESS_HOLDERS=2 node src/usat_apps/modules/event_coi/stress_test.js
 *   HEADLESS=0 STRESS_N=3 node ...stress_test.js                     # watch the browsers
 *
 * Reports: per-run duration, peak concurrent browsers, and total wall time. EVENT_COI_MAX_CONCURRENT
 * (from .env) sets the cap; runs past it queue and launch as slots free.
 */
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const readline = require('readline');
const realDriver = require('./store/portal_driver');
const run_control = require('./store/run_control');

const MAX = run_control.MAX_CONCURRENT;

// Driver that does everything real EXCEPT submit — so the stress test never sends a certificate.
const driver = Object.assign({}, realDriver, {
  async submit() { return { ok: true, confirmation: 'STRESS — not submitted', confirmShot: null }; },
});

function testBatch(nHolders) {
  const holders = [];
  for (let i = 0; i < nHolders; i++) holders.push({ name: `Stress Holder ${i + 1}`, address: '123 Test Ave', city: 'Testville', state: 'CO', zip: '80000', email: 'callasteven@gmail.com' });
  return {
    event: { sanctionId: '123456', eventName: 'Stress Test Event', eventLocationName: 'Test Park', eventAddress: '123 Test Ave', eventStartDate: '08/16/2026', eventEndDate: '08/21/2026' },
    requestor: { name: 'Stress Tester', email: 'callasteven@gmail.com', phone: '555-010-2026' },
    options: {},
    holders,
  };
}

function ask(q, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r((a || '').trim() || def); }));
}

// Record each run's finish time by subscribing a fake SSE sink that watches for the terminal event.
const finishMs = {};
function watch(run, startedAt) {
  const sink = { write(line) {
    const i = line.indexOf('data: '); if (i < 0) return;
    let msg; try { msg = JSON.parse(line.slice(i + 6)); } catch (e) { return; }
    if ((msg.type === 'done' || msg.type === 'error') && finishMs[run.id] == null) finishMs[run.id] = Date.now() - startedAt;
  } };
  run_control.subscribe(run.id, sink);
}

async function main() {
  const n = Number(process.env.STRESS_N || await ask(`  How many concurrent runs? (server cap is ${MAX}) [3]: `, '3')) || 3;
  const holders = Number(process.env.STRESS_HOLDERS || await ask('  Holders per run? [1]: ', '1')) || 1;
  const headless = String(process.env.HEADLESS) === '0' ? false : true;
  console.log(`\n  Launching ${n} run(s) × ${holders} holder(s), headless=${headless}, cap=${MAX}. NO certificates are submitted.\n`);

  const batch = testBatch(holders);
  const runs = [];
  const startedAt = Date.now();
  for (let i = 0; i < n; i++) {
    const run = run_control.start(batch, { driver, mode: 'auto', headless });
    watch(run, startedAt);
    runs.push(run);
  }
  const immediate = runs.filter((r) => r.status !== 'queued').length;
  console.log(`  ${immediate} started immediately, ${n - immediate} queued\n`);

  const terminal = ['done', 'stopped', 'error'];
  let peak = 0;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const st = run_control.stats();
      if (st.running > peak) peak = st.running;
      const remaining = runs.filter((r) => !terminal.includes(r.status)).length;
      process.stdout.write(`\r  running=${st.running}  queued=${st.queued}  peak=${peak}  finished=${n - remaining}/${n}     `);
      if (remaining === 0) { clearInterval(iv); resolve(); }
    }, 400);
  });

  console.log('\n\n  === results ===');
  runs.forEach((r, i) => {
    const secs = finishMs[r.id] != null ? (finishMs[r.id] / 1000).toFixed(1) : '?';
    const ok = r.results.filter((x) => x.status === 'submitted').length;   // 'submitted' == stub-OK fill cycle
    const bad = r.results.filter((x) => x.status === 'failed').length;
    console.log(`  run ${String(i + 1).padStart(2)}: ${r.status.padEnd(7)}  ${secs}s   (${ok}/${r.total} form cycles${bad ? `, ${bad} failed` : ''})`);
  });
  const total = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n  peak concurrent browsers: ${peak}  (cap ${MAX})`);
  console.log(`  total wall time: ${total}s`);
  console.log(`\n  Tip: if peak < your run count, the rest were queued (expected past the cap). Raise/lower`);
  console.log(`  EVENT_COI_MAX_CONCURRENT in .env to tune. Nothing was submitted to the portal.\n`);
  process.exit(0);
}
main().catch((e) => { console.error('\n  stress test error:', (e && e.message) || e); process.exit(1); });
