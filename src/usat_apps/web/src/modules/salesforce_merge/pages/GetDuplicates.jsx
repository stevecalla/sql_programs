import { useEffect, useRef, useState } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import DataTable from '../components/DataTable.jsx';
import { api } from '../lib/api.js';
import { buildActivityRows, fmtClock } from '../lib/activity.js';

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtWhen = (s) => (s ? new Date(s).toLocaleString() : '—');
const fmtDur = (s) => (s == null ? '—' : (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`));

// Activity table columns — sortable, filterable, each with a header tooltip.
const ACTIVITY_COLUMNS = [
  { key: 'run_type', label: 'Type', sort: true, filter: true, help: 'What ran: finder (full detection), snapshot (data load), or sweep (criteria tuning).' },
  { key: 'environment', label: 'Environment', sort: true, filter: true, help: 'Which Salesforce environment the run pulled from.',
    render: (r) => <span className={'ds-badge ' + (r.environment === 'Production' ? 'ds-prod' : 'ds-sandbox')}>{r.environment || '—'}</span> },
  { key: 'scope', label: 'Scope', sort: true, filter: true, help: 'Full = all records · Sample = capped subset.' },
  { key: 'total_records', label: 'Records', sort: true, help: 'How many accounts the run scanned.', render: (r) => (r.live ? <span className="spinner" aria-label="running" /> : fmtNum(r.total_records)) },
  { key: 'clusters', label: 'Clusters', sort: true, help: 'Consolidated duplicate clusters the run produced.', render: (r) => (r.live ? <span className="spinner" aria-label="running" /> : fmtNum(r.clusters)) },
  { key: 'duration_seconds', label: 'Duration', sort: true, help: 'How long the run took (wall-clock). Counts up live while a run is in progress.',
    render: (r) => (r.live
      ? <span className="dt-loading"><span className="spinner" aria-hidden="true" /> {fmtClock(r.duration_seconds)}</span>
      : fmtDur(r.duration_seconds)) },
  { key: 'run_at', label: 'When', sort: true, filter: true, help: 'When the run completed.', render: (r) => (r.live ? <em className="muted">in progress…</em> : fmtWhen(r.run_at)) },
];

// Env × Scope -> flags + menu item, for the live command preview (mirrors the backend mapping).
function flagsLabel(env, scope) {
  if (env === 'production') return scope === 'full' ? '--prod  (menu 10 · PRODUCTION)' : '--prod --partial  (menu 9 · PROD PARTIAL)';
  return scope === 'full' ? '--test --full  (menu 8 · TEST FULL)' : '--test  (menu 7 · TEST)';
}

// The detection stages, in order, matched against the finder's [STEP] labels as they arrive.
const STAGES = [
  { label: 'Fetch', re: /fetch/i },
  { label: 'Exact', re: /exact/i },
  { label: 'Fuzzy', re: /fuzzy/i },
  { label: 'Nickname', re: /nickname/i },
  { label: 'Consolidate', re: /consolidat/i },
  { label: 'Persist', re: /persist|write|excel|table|database/i },
];
function stageStates(run, running) {
  const steps = (run && run.steps) || [];
  const finishedOk = run && !running && run.exit_code === 0;   // completed run -> all stages done
  const matched = STAGES.map((s) => steps.find((st) => s.re.test(st.label)));
  const currentIdx = matched.findIndex((m) => !m);
  return STAGES.map((s, i) => ({
    label: s.label,
    duration: matched[i] ? matched[i].duration : null,
    status: matched[i] ? 'done' : (finishedOk ? 'done' : (running && i === currentIdx ? 'running' : 'pending')),
  }));
}

function Seg({ value, set, options }) {
  return (
    <span className="pills">
      {options.map((o) => (
        <button key={o.v} className={'pill' + (value === o.v ? ' active' : '')} onClick={() => set(o.v)}>{o.label}</button>
      ))}
    </span>
  );
}

export default function GetDuplicates() {
  const [env, setEnv] = useState('sandbox');
  const [scope, setScope] = useState('sample');
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);
  const logRef = useRef(null);

  const poll = () => api.refreshStatus().then(setStatus).catch((e) => setErr(e.message));
  const loadRuns = () => api.runs().then((r) => setRuns(r.runs || [])).catch(() => {});
  useEffect(() => {
    poll(); loadRuns();
    timer.current = setInterval(() => { poll(); loadRuns(); setNow(Date.now()); }, 2500);
    return () => clearInterval(timer.current);
  }, []);

  // Keep the live log pinned to the newest line as output streams in.
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [status]);

  const running = status && status.running;
  const run = status && status.run;
  const finderRunning = running && run && run.job !== 'sweep';   // default/legacy = finder
  const sweepRunning = running && run && run.job === 'sweep';

  // Tick a 1-second clock while a run is in progress so the live Duration counts up smoothly
  // (the 2.5s poll above is coarse). Elapsed is derived from started_at, so navigating away and
  // back re-reads server state and shows the correct time — no local counter to lose.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Recent-runs rows, with a live row prepended while a job runs; it flips to the final DB row
  // (loaded by the 2.5s poll) once the run completes.
  const activityRows = buildActivityRows(status, runs, now);

  const start = async () => {
    setErr('');
    if (env === 'production') {
      const typed = window.prompt('This runs detection against PRODUCTION. Type CONFIRM to proceed.');
      if (typed !== 'CONFIRM') return;
    }
    try { await api.refreshStart(env, scope); await poll(); }
    catch (e) { setErr(e.message); }
  };
  // Replay-only: runs the criteria grid over the snapshot already loaded (read-only, no fetch),
  // so it doesn't re-pull Salesforce or touch the shared snapshot. Env/scope don't apply here.
  const startSweep = async () => {
    setErr('');
    try { await api.refreshStart(env, scope, 'sweep'); await poll(); }
    catch (e) { setErr(e.message); }
  };
  const cancel = async () => { try { await api.refreshCancel(); await poll(); } catch (e) { setErr(e.message); } };

  const elapsed = running && run && run.started_at
    ? Math.max(0, Math.round((now - new Date(run.started_at).getTime()) / 1000)) : null;
  const ranSecs = run && run.started_at && run.finished_at
    ? Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)) : null;
  const mmss = (s) => (s == null ? '' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

  return (
    <>
      <h2>Process</h2>
      <p className="muted small">Run the duplicate-detection job and rebuild the review tables. Read-only against Salesforce — no merges, no writes.</p>
      <DatasetStamp />
      {err && <p className="err">{err}</p>}

      <div style={{ display: 'flex', gap: 12, margin: '12px 0', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ flex: '2 1 380px', margin: 0 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Duplicate detection</p>
          <p className="muted small" style={{ margin: '0 0 8px' }}>Fetch records and rebuild the duplicate / merge-ID tables for the chosen environment and scope.</p>
          <div className="grid" style={{ marginBottom: 8 }}>
            <div>
              <p className="muted small" style={{ margin: '0 0 4px' }}>Environment</p>
              <Seg value={env} set={setEnv} options={[{ v: 'sandbox', label: 'Sandbox' }, { v: 'production', label: 'Production' }]} />
            </div>
            <div>
              <p className="muted small" style={{ margin: '0 0 4px' }}>Scope</p>
              <Seg value={scope} set={setScope} options={[{ v: 'sample', label: 'Sample' }, { v: 'full', label: 'Full' }]} />
            </div>
          </div>
          <p className="muted small" style={{ fontFamily: 'monospace' }}>
            node step_1_find_duplicates.js {flagsLabel(env, scope)}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button className="btn primary" style={{ width: 'auto', marginTop: 0 }} disabled={running} onClick={start}>
              {finderRunning ? 'Running…' : 'Run duplicate detection'}
            </button>
            {finderRunning && <button className="btn primary" style={{ width: 'auto', marginTop: 0, whiteSpace: 'nowrap', background: 'var(--red, #c0392b)', color: '#fff', borderColor: 'transparent' }} onClick={cancel}>Cancel run</button>}
            <span className="muted small">Admin only · one run at a time · production needs confirmation</span>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 280px', margin: 0, display: 'flex', flexDirection: 'column' }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Tuning sweep</p>
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Replays detection across many criteria combinations (fuzzy threshold, nicknames on/off, with/without ZIP)
            over the snapshot already loaded — read-only, no Salesforce fetch. Builds the <strong>Tuning</strong> page.
          </p>
          <p className="muted small" style={{ margin: '0 0 10px' }}>No environment / scope needed — it uses the current snapshot.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 'auto' }}>
            <button className="btn primary" style={{ width: 'auto' }} disabled={running} onClick={startSweep}>
              {sweepRunning ? 'Running…' : 'Run tuning sweep'}
            </button>
            {sweepRunning && <button className="btn primary" style={{ width: 'auto', marginTop: 0, whiteSpace: 'nowrap', background: 'var(--red, #c0392b)', color: '#fff', borderColor: 'transparent' }} onClick={cancel}>Cancel run</button>}
          </div>
        </div>
      </div>

      <div className="card" style={{ margin: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <strong>{!run ? 'Progress' : (running ? 'Running' : (run.error ? 'Failed' : (run.exit_code === 0 ? 'Completed' : 'Finished')))}</strong>
          {run && <span className="muted small">{run.env} · {run.scope} · {run.mode}{run.job ? ' · ' + run.job : ''}</span>}
          {running && <span className="dt-loading" style={{ marginLeft: 'auto' }}><span className="spinner" /> {mmss(elapsed)} elapsed</span>}
          {run && !running && run.finished_at && <span className="muted small" style={{ marginLeft: 'auto' }}>took {mmss(ranSecs)} · exit {String(run.exit_code)}</span>}
        </div>

        <div className="stepper">
          {stageStates(run, running).map((s) => (
            <div key={s.label} className="step-wrap">
              <span className={'step-dot ' + s.status}>
                {s.status === 'done' ? '✓' : (s.status === 'running' ? <span className="spinner" /> : '')}
              </span>
              <span className="step-label">{s.label}</span>
              <span className="step-dur muted">{s.duration || ''}</span>
            </div>
          ))}
        </div>

        {run && run.log_tail && run.log_tail.length > 0
          ? <pre className="proc-log" ref={logRef}>{run.log_tail.join('\n')}</pre>
          : <p className="muted small">No run in this session yet — start one above, or see the recent runs below.</p>}
      </div>

      <div className="card" style={{ margin: '12px 0' }}>
        <p style={{ margin: '0 0 10px', fontWeight: 500 }}>Activity — recent runs</p>
        <DataTable columns={ACTIVITY_COLUMNS} rows={activityRows} rowClass={(r) => (r.live ? 'row-running' : '')} searchCols="type, environment, scope, when" minWidth={820} maxHeight={360} />
      </div>
    </>
  );
}
