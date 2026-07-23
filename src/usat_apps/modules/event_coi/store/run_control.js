'use strict';
// run_control.js — in-memory submission runs for the event_coi module. Each run keeps its OWN logged-in
// Chromium session and loops its holders: open form → fill → screenshot → (pause for approval unless
// auto) → submit → record → next. Progress + screenshots stream to that run's SSE subscribers. Browser
// work is delegated to a `driver` (store/portal_driver by default) so the loop is unit-testable with a
// fake driver — no browser needed.
//
// CONCURRENCY: up to EVENT_COI_MAX_CONCURRENT runs execute at once (default 5); each is fully isolated
// in its own browser session, so multiple users can submit simultaneously. Runs started past the cap
// are QUEUED (status 'queued' with a position) and launched automatically as slots free. A run that is
// paused awaiting the human approval gate still holds its slot (its browser is open).
// Lazily load the real Playwright driver only when a run actually needs it (no driver was injected).
// Keeps run_control requireable — and unit-testable with a fake driver — without pulling in Chromium.
let _defaultDriver = null;
function defaultDriver() { if (!_defaultDriver) _defaultDriver = require('./portal_driver'); return _defaultDriver; }

const runs = new Map();      // runId -> run
const waiting = [];          // runIds queued for a free slot (FIFO)
let _seq = 0;

const MAX_CONCURRENT = Math.max(1, Number(process.env.EVENT_COI_MAX_CONCURRENT) || 5);

// Statuses that occupy a browser slot (i.e. count against MAX_CONCURRENT).
const ACTIVE = ['launching', 'login', 'running', 'awaiting_approval', 'submitting'];

function newId() { _seq += 1; return 'run-' + Date.now() + '-' + _seq; }

function emit(run, type, data) {
  const payload = Object.assign({ type }, data || {});
  run.last = payload;
  const line = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of run.subscribers) { try { res.write(line); } catch (e) { /* dropped */ } }
}

function runningCount() { let n = 0; for (const r of runs.values()) if (ACTIVE.includes(r.status)) n += 1; return n; }
function queuePosition(run) { const i = waiting.indexOf(run.id); return i < 0 ? 0 : i + 1; }

// Tell each still-queued run its (possibly changed) position, so the UI can show "3rd in line" live.
function emitQueuePositions() {
  waiting.forEach(function (id) {
    const r = runs.get(id);
    if (r && r.status === 'queued') emit(r, 'queued', { status: 'queued', position: queuePosition(r), max: MAX_CONCURRENT });
  });
}

// Launch as many queued runs as free slots allow.
function pump() {
  while (runningCount() < MAX_CONCURRENT && waiting.length) {
    const id = waiting.shift();
    const run = runs.get(id);
    if (!run || run.status !== 'queued') continue;   // dropped/stopped while waiting
    loop(run, run.driver);   // fire-and-forget; progress goes out via SSE
  }
  emitQueuePositions();
}

function activeRun() {
  for (const r of runs.values()) if (['starting', 'queued'].concat(ACTIVE).includes(r.status)) return r;
  return null;
}

function get(id) { return runs.get(id); }

// Remove a run id from the waiting queue (used when a queued run is stopped before it launches).
function dropFromQueue(id) { const i = waiting.indexOf(id); if (i >= 0) waiting.splice(i, 1); }

// Resolve the approval gate. decision: 'approve' | 'skip' | 'approve-all' | 'stop'.
function decide(id, decision) {
  const run = runs.get(id);
  if (!run) return { ok: false, error: 'no such run' };
  if (decision === 'stop') {
    run.stopRequested = true;
    // A queued run never launched — just mark it stopped and pull it from the line.
    if (run.status === 'queued') { dropFromQueue(id); run.status = 'stopped'; emit(run, 'done', { status: 'stopped', results: run.results }); emitQueuePositions(); return { ok: true }; }
    if (run.gate) { const g = run.gate; run.gate = null; g('stop'); }
    // Force the browser closed so the server-side job halts immediately, even if wedged mid Playwright op.
    try { if (run.session && run.driver) run.driver.close(run.session); } catch (_) { /* already gone */ }
    return { ok: true };
  }
  if (run.gate) { const g = run.gate; run.gate = null; g(decision); return { ok: true }; }
  // Not currently paused (e.g. during auto/submit) — flag it so the loop exits at the next check.
  return { ok: true, note: 'no active gate' };
}

function waitForGate(run) { return new Promise((resolve) => { run.gate = resolve; }); }

async function loop(run, driver) {
  let session;
  try {
    run.status = 'launching'; emit(run, 'status', { status: 'launching' });
    session = await driver.open({ headless: run.headless });
    run.session = session;   // stored so abort() can force the browser closed to unstick a wedged run
    run.status = 'login'; emit(run, 'status', { status: 'login' });
    await driver.login(session);
    // Show the portal home so the user can see the browser actually signed in.
    { let s = null; try { s = await driver.screenshot(session); } catch (_) { /* ignore */ } emit(run, 'stage', { label: 'Signed in to the portal', screenshot: s }); }

    for (run.index = 0; run.index < run.total; run.index++) {
      if (run.stopRequested) break;
      const holder = run.batch.holders[run.index];
      run.status = 'running';
      emit(run, 'holder-start', { index: run.index, total: run.total, name: holder.name });

      await driver.openForm(session);
      await driver.fill(session, run.batch, holder);
      const screenshot = await driver.screenshot(session);
      run.current = { index: run.index, name: holder.name, screenshot };
      emit(run, 'filled', { index: run.index, total: run.total, name: holder.name, screenshot });

      let decision = 'approve';
      if (!run.autoAll) {
        run.status = 'awaiting_approval';
        emit(run, 'awaiting', { index: run.index, total: run.total, name: holder.name });
        decision = await waitForGate(run);
      }
      if (decision === 'stop' || run.stopRequested) { run.stopRequested = true; break; }
      if (decision === 'skip') {
        const rec = { index: run.index, name: holder.name, status: 'skipped', error: null, at: Date.now() };
        run.results.push(rec); emit(run, 'result', rec); continue;
      }
      if (decision === 'approve-all') run.autoAll = true;

      run.status = 'submitting'; emit(run, 'submitting', { index: run.index, name: holder.name });
      const r = await driver.submit(session);
      const rec = { index: run.index, name: holder.name, status: r.ok ? 'submitted' : 'failed', error: r.ok ? null : (r.error || 'failed'), confirmation: r.confirmation || null, at: Date.now() };
      run.results.push(rec);   // stored rec omits the big screenshot to save memory
      emit(run, 'result', Object.assign({}, rec, { confirmShot: r.confirmShot || null }));
    }

    run.status = run.stopRequested ? 'stopped' : 'done';
    emit(run, 'done', { status: run.status, results: run.results });
  } catch (e) {
    run.status = 'error';
    let shot = null; try { if (session) shot = await driver.screenshot(session); } catch (_) { /* ignore */ }
    emit(run, 'error', { error: (e && e.message) || String(e), screenshot: shot, results: run.results });
  } finally {
    try { if (session) await driver.close(session); } catch (_) { /* ignore */ }
    // A slot just freed — launch the next queued run.
    pump();
    // Keep the run around briefly so the UI can fetch final results, then drop it. unref() so this
    // timer never keeps the process (or the test runner) alive.
    const cleanup = setTimeout(() => runs.delete(run.id), 5 * 60 * 1000);
    if (cleanup && cleanup.unref) cleanup.unref();
  }
}

// batch = { event, requestor, options, holders }. opts = { headless, driver, mode }.
// Always accepted: if the concurrency cap is reached the run is queued and launches automatically when
// a slot frees. Returns the run; run.status is 'queued' when it didn't start immediately.
function start(batch, opts) {
  opts = opts || {};
  const driver = opts.driver || defaultDriver();
  const run = {
    id: newId(), status: 'queued', batch,
    total: (batch.holders || []).length, index: -1,
    autoAll: opts.mode === 'auto',
    headless: opts.headless !== false,
    driver, session: null,
    results: [], subscribers: new Set(), gate: null, stopRequested: false, current: null, last: null,
    startedAt: Date.now(),
  };
  runs.set(run.id, run);
  waiting.push(run.id);
  run.queuedAtStart = queuePosition(run) > MAX_CONCURRENT || runningCount() >= MAX_CONCURRENT;
  pump();   // launches immediately if a slot is free; otherwise it stays queued
  return run;
}

// Force a run to end and drop it from the registry so its slot frees immediately. Used by the Reset
// button. With no id, aborts whatever run is currently active. Resolving the gate unsticks a run paused
// for approval; closing the browser unsticks one wedged on a Playwright call; a queued run is just
// pulled from the line.
async function abort(id) {
  const run = id ? runs.get(id) : activeRun();
  if (!run) return { ok: true, note: 'no active run' };
  run.stopRequested = true;
  dropFromQueue(run.id);
  if (run.gate) { const g = run.gate; run.gate = null; g('stop'); }
  try { if (run.session && run.driver) await run.driver.close(run.session); } catch (_) { /* already gone */ }
  if (['starting', 'queued'].concat(ACTIVE).includes(run.status)) run.status = 'stopped';
  runs.delete(run.id);
  pump();   // a slot may have freed
  return { ok: true };
}

// Attach an SSE response; immediately catch it up with the last known state.
function subscribe(id, res) {
  const run = runs.get(id);
  if (!run) return false;
  run.subscribers.add(res);
  const snap = { type: 'snapshot', status: run.status, index: run.index, total: run.total, autoAll: run.autoAll, results: run.results, max: MAX_CONCURRENT };
  if (run.status === 'queued') snap.position = queuePosition(run);
  if (run.current) snap.current = run.current;
  try { res.write('data: ' + JSON.stringify(snap) + '\n\n'); } catch (e) { /* ignore */ }
  return true;
}
function unsubscribe(id, res) { const run = runs.get(id); if (run) run.subscribers.delete(res); }

// Introspection for the API/tests.
function stats() { return { max: MAX_CONCURRENT, running: runningCount(), queued: waiting.length }; }

module.exports = { start, decide, subscribe, unsubscribe, get, activeRun, abort, stats, MAX_CONCURRENT };
