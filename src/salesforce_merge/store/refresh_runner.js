'use strict';
// R1 — runs the duplicate-detection job from the merge tool by spawning the existing finder as a
// child process. Single run at a time; captures stdout and parses the finder's [STEP] lines for
// live progress. Read-only against Salesforce (the finder never writes to SF). `spawn` is injectable
// so this is unit-testable without actually launching node.
const path = require('path');
const { spawn: real_spawn } = require('child_process');

// src/salesforce_merge/store -> src/salesforce_duplicates/step_1_find_duplicates.js
const FINDER = path.join(__dirname, '..', '..', 'salesforce_duplicates', 'step_1_find_duplicates.js');
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
      env: r.env, scope: r.scope, flags: r.flags, mode: r.flags.join(' '),
      started_at: r.started_at, finished_at: r.finished_at,
      exit_code: r.exit_code, error: r.error,
      steps: r.steps, log_tail: r.log.slice(-20), pid: r.pid,
    },
  };
}

function start({ env, scope } = {}, spawn = real_spawn) {
  if (state.running) return { ok: false, error: 'a refresh is already in progress' };
  const flags = flags_for(env, scope);
  const run = {
    env: env || 'sandbox', scope: scope || 'sample', flags,
    started_at: new Date().toISOString(), finished_at: null,
    exit_code: null, error: null, steps: [], log: [], pid: null,
  };

  let child;
  try {
    child = spawn('node', [FINDER, ...flags], { cwd: path.dirname(FINDER) });
  } catch (e) {
    run.error = e.message; run.finished_at = new Date().toISOString();
    state = { running: false, run, child: null };
    return { ok: false, error: e.message };
  }

  state = { running: true, run, child };
  run.pid = child.pid || null;

  const on_data = (buf) => {
    const clean = String(buf).replace(/\x1B\[[0-9;]*m/g, '');   // strip ANSI color codes
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue;
      run.log.push(line);
      if (run.log.length > LOG_CAP) run.log.shift();
      const m = line.match(/\[STEP\]\s*(.+?)\s*[—-]\s*([\d.]+\s*s)/i);
      if (m) run.steps.push({ label: m[1].trim(), duration: m[2].replace(/\s+/g, '') });
    }
  };
  if (child.stdout) child.stdout.on('data', on_data);
  if (child.stderr) child.stderr.on('data', on_data);
  child.on('close', (code) => { run.finished_at = new Date().toISOString(); run.exit_code = code; state.running = false; });
  child.on('error', (e) => { run.error = e.message; run.finished_at = new Date().toISOString(); state.running = false; });

  return { ok: true, ...public_status() };
}

function status() { return public_status(); }

function cancel() {
  if (!state.running || !state.child) return { ok: false, error: 'no refresh in progress' };
  try { state.child.kill('SIGTERM'); } catch (e) { /* already gone */ }
  return { ok: true };
}

function _reset() { state = { running: false, run: null, child: null }; }  // tests only

module.exports = { start, status, cancel, flags_for, FINDER, _reset };
