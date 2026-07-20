'use strict';
// Phase 3 (parallel workers) — the ONE place the app shells out to pm2, to scale the worker cluster on
// the fly from the Merge Ops panel so `worker_target` actually drives the number of instances. Isolated,
// bounded (1–8), best-effort (never throws — returns {ok,error}), and NEVER on the merge write path.
const { exec } = require('child_process');

// pm2 process name of the worker cluster (matches the pm2_start_salesforce_merge_worker_cluster script).
const PROC = process.env.MERGE_WORKER_PM2_NAME || 'salesforce_merge_worker';

// Clamp a requested instance count to the safe range. null when not a finite number.
function clamp_n(n) {
  if (n == null || n === '') return null;   // Number(null)/Number('') are 0 — treat as invalid, not 1
  const x = Math.floor(Number(n));
  return Number.isFinite(x) ? Math.min(8, Math.max(1, x)) : null;
}

// The exact shell command a scale would run (pure — unit-tested so we never exec an unclamped value).
function scale_command(n) {
  const c = clamp_n(n);
  return c == null ? null : 'npx pm2 scale ' + PROC + ' ' + c;
}

function run(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => resolve({
      ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: err ? (err.message || String(err)) : null,
    }));
  });
}

// Scale the cluster to n instances (clamped). Best-effort: returns {ok, n, output, error}.
async function scale(n) {
  const cmd = scale_command(n);
  if (!cmd) return { ok: false, n: null, output: '', error: 'invalid instance count' };
  const r = await run(cmd);
  return { ok: r.ok, n: clamp_n(n), output: r.stdout || r.stderr || '', error: r.error };
}

// Count online instances of the worker cluster via `pm2 jlist`. Best-effort: {ok, online, error}.
async function online_count() {
  const r = await run('npx pm2 jlist');
  if (!r.ok) return { ok: false, online: null, error: r.error || 'pm2 jlist failed' };
  try {
    const list = JSON.parse(r.stdout);
    const online = list.filter((p) => p && p.name === PROC && p.pm2_env && p.pm2_env.status === 'online').length;
    return { ok: true, online };
  } catch (e) { return { ok: false, online: null, error: 'could not parse pm2 jlist' }; }
}

// Tail the worker cluster's recent logs via pm2 (non-streaming). Best-effort: {ok, text, error}. Bounded
// line count. Used by the Merge Ops "Worker logs" panel — polled only while the panel is open.
async function tail_logs(lines = 60) {
  const n = Math.min(500, Math.max(5, Math.floor(Number(lines) || 60)));
  const r = await run('npx pm2 logs ' + PROC + ' --nostream --lines ' + n, 15000);
  if (!r.ok) return { ok: false, text: '', error: r.error || 'pm2 logs failed' };
  return { ok: true, text: r.stdout || r.stderr || '' };
}

module.exports = { clamp_n, scale_command, scale, online_count, tail_logs, PROC };
