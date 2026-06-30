'use strict';
// R1 — runs detection jobs from the merge tool by spawning the existing CLIs as child processes.
// Two jobs: 'finder' (step_1_find_duplicates.js) and 'sweep' (sweep_duplicates.js snapshot -> run).
// Single run at a time; captures stdout and parses [STEP] lines for live progress. Read-only against
// Salesforce. `spawn` is injectable so this is unit-testable without launching node.
const path = require('path');
const { spawn: real_spawn } = require('child_process');

// src/salesforce_merge/store -> src/salesforce_duplicates/...
const DUP_DIR = path.join(__dirname, '..', '..', 'salesforce_duplicates');
const FINDER = path.join(DUP_DIR, 'step_1_find_duplicates.js');
const SWEEP = path.join(DUP_DIR, 'src', 'sweep_duplicates.js');
const LOG_CAP = 500;

// Env × Scope -> the same CLI flags as duplicates menu.js items 7-10.
function flags_for(env, scope) {
  const e = String(env || '').toLowerCase();
  const s = String(scope || '').toLowerCase();
  const prod = e === 'production' || e === 'prod';
  if (prod) return s === 'full' ? ['--prod'] : ['--prod', '--partial'];   // 10 / 9
  return s === 'full' ? ['--test', '--full'] : ['--test'];                 // 8 / 7
}

let state = { running: false, run: null, child: null };

function public_status() {
  const r = state.run;
  if (!r) return { running: false, run: null };
  return {
    running: state.running,
    run: {
      env: r.env, scope: r.scope, flags: r.flags, mode: r.flags.join(' '), job: r.job,
      started_at: r.started_at, finished_at: r.finished_at,
      exit_code: r.exit_code, error: r.error,
      steps: r.steps, log_tail: r.log.slice(-20), pid: r.pid,
    },
  };
}

function make_on_data(run) {
  return (buf) => {
    const clean = String(buf).replace(/\x1B\[[0-9;]*m/g, '');   // strip ANSI color codes
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue;
      run.log.push(line);
      if (run.log.length > LOG_CAP) run.log.shift();
      const m = line.match(/\[STEP\]\s*(.+?)\s*[—-]\s*([\d.]+\s*s)/i);
      if (m) run.steps.push({ label: m[1].trim(), duration: m[2].replace(/\s+/g, '') });
    }
  };
}

// Spawn one child for `run`, wiring stdout/stderr -> log/steps; calls onClose(code) on close.
function spawn_step(run, args, spawn, onClose) {
  let child;
  try {
    child = spawn('node', args, { cwd: DUP_DIR });
  } catch (e) {
    run.error = e.message; run.finished_at = new Date().toISOString(); state.running = false;
    return null;
  }
  state.child = child;
  run.pid = child.pid || null;
  const on_data = make_on_data(run);
  if (child.stdout) child.stdout.on('data', on_data);
  if (child.stderr) child.stderr.on('data', on_data);
  child.on('close', (code) => onClose(code));
  child.on('error', (e) => { run.error = e.message; run.finished_at = new Date().toISOString(); state.running = false; });
  return child;
}

function start({ env, scope, job } = {}, spawn = real_spawn) {
  if (state.running) return { ok: false, error: 'a refresh is already in progress' };
  const is_sweep = String(job || '').toLowerCase() === 'sweep';
  const flags = flags_for(env, scope);
  const run = {
    env: env || 'sandbox', scope: scope || 'sample', flags, job: is_sweep ? 'sweep' : 'finder',
    started_at: new Date().toISOString(), finished_at: null,
    exit_code: null, error: null, steps: [], log: [], pid: null,
  };
  state = { running: true, run, child: null };

  if (is_sweep) {
    // Tuning sweep: replay the criteria grid over the snapshot the finder already loaded — read-only,
    // no Salesforce fetch, does NOT touch the shared snapshot. (Errors if no snapshot exists yet.)
    run.log.push('Sweep: replaying the criteria grid over the current snapshot…');
    spawn_step(run, [SWEEP, 'run'], spawn, (code) => {
      run.exit_code = code; run.finished_at = new Date().toISOString(); state.running = false;
    });
    if (!state.running && run.error) return { ok: false, error: run.error };
    return { ok: true, ...public_status() };
  }

  // Finder (default): single child.
  spawn_step(run, [FINDER, ...flags], spawn, (code) => {
    run.exit_code = code; run.finished_at = new Date().toISOString(); state.running = false;
  });
  if (!state.running && run.error) return { ok: false, error: run.error };
  return { ok: true, ...public_status() };
}

function status() { return public_status(); }

function cancel() {
  if (!state.running || !state.child) return { ok: false, error: 'no refresh in progress' };
  try { state.child.kill('SIGTERM'); } catch (e) { /* already gone */ }
  return { ok: true };
}

function _reset() { state = { running: false, run: null, child: null }; }  // tests only

module.exports = { start, status, cancel, flags_for, FINDER, SWEEP, _reset };
