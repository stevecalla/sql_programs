// Phase 3: merge/restore/recreate run in a separate worker process now. After the enqueue POST returns
// { queued, run_id }, poll THIS run (by id) until terminal, then return a summary. The worker writes the
// executor's own result object onto the run row (parity with the old synchronous response), so summarize()
// prefers that; a short grace period lets it land before we read.
export async function awaitRun(api, kind, runId, onTick) {
  let terminalSeen = 0;
  for (let i = 0; i < 3600; i += 1) {                 // ~1h safety cap at 1s cadence
    await new Promise((r) => setTimeout(r, 1000));
    let run = null;
    try { run = (await api.mergeProgress(kind, runId)).run; } catch (e) { /* transient */ }
    if (run && onTick) onTick(run);
    const terminal = run && String(run.run_id) === String(runId)
      && (run.status === 'done' || run.status === 'error' || run.status === 'cancelled');
    if (terminal) {
      if (run.result || terminalSeen >= 2) return run;  // wait up to ~2 extra polls for the result to write
      terminalSeen += 1;
    }
  }
  return null;
}

// Phase 4: a JOB is N parallel chunk-runs sharing a job_id. Poll the aggregate job progress until it's
// no longer 'running' (done/error/cancelled — or 'paused' by the async-Apex breaker, which is a stop
// point where the user resumes). onTick gets the aggregate each poll.
export async function awaitJob(api, jobId, onTick) {
  for (let i = 0; i < 5400; i += 1) {                 // ~1.5h safety cap
    await new Promise((r) => setTimeout(r, 1000));
    let job = null;
    try { job = (await api.mergeJobProgress(jobId)).job; } catch (e) { /* transient */ }
    if (job && onTick) onTick(job);
    if (job && job.status && job.status !== 'running') return job;   // done/error/cancelled/paused
  }
  return null;
}

export function summarize(run) {
  if (!run) return { run_id: null, mode: null };
  if (run.result) { try { return JSON.parse(run.result); } catch (e) { /* fall through */ } }
  // Fallback only if the executor result hasn't landed — approximate from the run row.
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
