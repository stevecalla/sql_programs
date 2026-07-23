'use strict';
// run_control.js — in-memory submission run for the event_coi module (one active run at a time, like
// reporting's refresh_runner). Keeps ONE logged-in Chromium session and loops the holders: open form →
// fill → screenshot → (pause for approval unless auto) → submit → record → next. Progress + screenshots
// stream to SSE subscribers. The browser work is delegated to a `driver` (store/portal_driver by
// default) so the loop is unit-testable with a fake driver — no browser needed.
const defaultDriver = require('./portal_driver');

const runs = new Map();      // runId -> run
let _seq = 0;

function newId() { _seq += 1; return 'run-' + Date.now() + '-' + _seq; }

function emit(run, type, data) {
  const payload = Object.assign({ type }, data || {});
  run.last = payload;
  const line = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of run.subscribers) { try { res.write(line); } catch (e) { /* dropped */ } }
}

function activeRun() {
  for (const r of runs.values()) if (['starting', 'launching', 'login', 'running', 'awaiting_approval'].includes(r.status)) return r;
  return null;
}

function get(id) { return runs.get(id); }

// Resolve the approval gate. decision: 'approve' | 'skip' | 'approve-all' | 'stop'.
function decide(id, decision) {
  const run = runs.get(id);
  if (!run) return { ok: false, error: 'no such run' };
  if (decision === 'stop') {
    run.stopRequested = true;
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
    // Keep the run around briefly so the UI can fetch final results, then drop it. unref() so this
    // timer never keeps the process (or the test runner) alive.
    const cleanup = setTimeout(() => runs.delete(run.id), 5 * 60 * 1000);
    if (cleanup && cleanup.unref) cleanup.unref();
  }
}

// batch = { event, requestor, options, holders }. opts = { headless, driver, mode }.
function start(batch, opts) {
  opts = opts || {};
  const driver = opts.driver || defaultDriver;
  const run = {
    id: newId(), status: 'starting', batch,
    total: (batch.holders || []).length, index: -1,
    autoAll: opts.mode === 'auto',
    headless: opts.headless !== false,
    driver, session: null,
    results: [], subscribers: new Set(), gate: null, stopRequested: false, current: null, last: null,
    startedAt: Date.now(),
  };
  runs.set(run.id, run);
  loop(run, driver);   // fire-and-forget; progress goes out via SSE
  return run;
}

// Force a run to end and drop it from the registry so the "one active run" guard clears immediately.
// Used by the Reset button. With no id, aborts whatever run is currently active. Resolving the gate
// unsticks a run paused for approval; closing the browser unsticks one wedged on a Playwright call.
async function abort(id) {
  const run = id ? runs.get(id) : activeRun();
  if (!run) return { ok: true, note: 'no active run' };
  run.stopRequested = true;
  if (run.gate) { const g = run.gate; run.gate = null; g('stop'); }
  try { if (run.session && run.driver) await run.driver.close(run.session); } catch (_) { /* already gone */ }
  if (['starting', 'launching', 'login', 'running', 'awaiting_approval', 'submitting'].includes(run.status)) run.status = 'stopped';
  runs.delete(run.id);
  return { ok: true };
}

// Attach an SSE response; immediately catch it up with the last known state.
function subscribe(id, res) {
  const run = runs.get(id);
  if (!run) return false;
  run.subscribers.add(res);
  const snap = { type: 'snapshot', status: run.status, index: run.index, total: run.total, autoAll: run.autoAll, results: run.results };
  if (run.current) snap.current = run.current;
  try { res.write('data: ' + JSON.stringify(snap) + '\n\n'); } catch (e) { /* ignore */ }
  return true;
}
function unsubscribe(id, res) { const run = runs.get(id); if (run) run.subscribers.delete(res); }

module.exports = { start, decide, subscribe, unsubscribe, get, activeRun, abort };
