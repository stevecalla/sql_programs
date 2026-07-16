// Pure helpers for the "Activity — recent runs" table on the Process (Get Duplicates) page.
// While a detection/sweep job is running we prepend a synthetic "live" row whose Duration
// ticks up. Everything is derived from server-held status (started_at), NOT a local counter,
// so the clock stays correct after navigating away and back. No imports — kept pure + testable.

export function titleCase(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

// Whole seconds elapsed since an ISO start time (never negative). null when unknown.
export function elapsedSeconds(startedAt, now) {
  if (!startedAt) return null;
  const t0 = new Date(startedAt).getTime();
  if (Number.isNaN(t0)) return null;
  return Math.max(0, Math.round((now - t0) / 1000));
}

// "0m 07s" / "12m 03s"
export function fmtClock(secs) {
  if (secs == null) return '';
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Build the Activity rows. When a job is running, prepend a live row built from `status.run`.
// When it finishes, status.running is false and the completed DB row in `runs` shows finals.
export function buildActivityRows(status, runs, now) {
  const list = Array.isArray(runs) ? runs : [];
  const run = status && status.run;
  if (!status || !status.running || !run || !run.started_at) return list;
  return [{
    live: true,
    run_type: run.job === 'sweep' ? 'sweep' : 'finder',
    environment: titleCase(run.env),
    scope: titleCase(run.scope),
    total_records: null,
    clusters: null,
    duration_seconds: elapsedSeconds(run.started_at, now), // numeric so the column still sorts
    run_at: run.started_at,
  }, ...list];
}
