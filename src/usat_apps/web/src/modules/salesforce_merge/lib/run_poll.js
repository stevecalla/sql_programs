// Phase 3: merge/restore/recreate run in a separate worker process now. After the enqueue POST returns
// { queued, run_id }, poll THIS run (by id, so concurrent same-kind runs don't confuse us) until it
// reaches a terminal status, then build a summary from the run row (per-set detail lives in history).
export async function awaitRun(api, kind, runId, onTick) {
  for (let i = 0; i < 3600; i += 1) {              // ~1h safety cap at 1s cadence
    await new Promise((r) => setTimeout(r, 1000));
    let run = null;
    try { run = (await api.mergeProgress(kind, runId)).run; } catch (e) { /* transient */ }
    if (run && onTick) onTick(run);
    if (run && String(run.run_id) === String(runId)
        && (run.status === 'done' || run.status === 'error' || run.status === 'cancelled')) return run;
  }
  return null;
}

export function summarize(run) {
  if (!run) return { run_id: null, mode: null };
  const sets = run.completed_sets || 0;
  const exec = run.mode === 'execute';
  return {
    run_id: run.run_id, mode: run.mode,
    done: exec ? sets : 0, restored: exec ? sets : 0, recreated: exec ? sets : 0,
    simulated: exec ? 0 : sets, processed: sets, skipped: 0,
    failed: run.status === 'error' ? 1 : 0, cancelled: run.status === 'cancelled',
    remaining: Math.max(0, (run.total_sets || 0) - sets),
  };
}
