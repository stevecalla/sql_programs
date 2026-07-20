import { useEffect, useState, useCallback, useRef } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import WorkerBanner from '../components/WorkerBanner.jsx';
import DataTable from '../components/DataTable.jsx';
import CollapsibleCard from '../components/CollapsibleCard.jsx';
import QueueRowDetail from '../components/QueueRowDetail.jsx';
import MergeDriftDetail from '../components/MergeDriftDetail.jsx';
import { api, exportUrl } from '../lib/api.js';
import { awaitRun, awaitJob, summarize } from '../lib/run_poll.js';

const shortId = (id) => (id && id.length > 8 ? '…' + id.slice(-5) : id || '');

// Tiny client-side sort for the hand-rolled tables (Approved merges, Merge history, per-account).
function useSort(initialKey = null) {
  const [s, setS] = useState({ key: initialKey, dir: 'asc' });
  const onSort = (key) => setS((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const apply = (rows) => {
    if (!s.key) return rows;
    return [...rows].sort((a, b) => {
      const x = a[s.key]; const y = b[s.key];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return r * (s.dir === 'asc' ? 1 : -1);
    });
  };
  const arrow = (key) => (s.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '');
  return { onSort, apply, arrow };
}
const RESULT_COLOR = { simulated: '#1a8a4f', done: '#1a8a4f', skipped: '#854f0b', failed: '#c0392b' };
// Per-set pipeline stages reported live by the backend (merge_run.stage) — mirrors the static
// "Processing steps" card 1:1, shown as a live stepper.
const MERGE_STAGES = [
  { key: 'fetch', label: 'Re-fetch + dry-run', desc: 'Pull the records fresh from Salesforce.' },
  { key: 'validate', label: 'Re-validate & drift check', desc: 'Confirm the records still exist, and compare their current values to what you staged (flags fields changed since queueing).' },
  { key: 'snapshot', label: 'Snapshot', desc: 'Back up every record to the pre-merge snapshot.' },
  { key: 'merge', label: 'Execute merge', desc: 'Write survivor fields, then run the Salesforce merge.' },
  { key: 'record', label: 'Record', desc: 'Log history and update the queue status.' },
];

export default function MergeProcess() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [who, setWho] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('simulate');   // 'simulate' | 'execute'
  const [confirmText, setConfirmText] = useState('');
  const [ackDrift, setAckDrift] = useState(false);
  const [driftRowOpen, setDriftRowOpen] = useState(() => new Set());
  const toggleDriftRow = (id) => setDriftRowOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [progress, setProgress] = useState(null);
  const [jobProg, setJobProg] = useState(null);   // Phase 4: aggregate progress when a run fans out into a parallel job
  const [jobId, setJobId] = useState(null);
  const [jobReport, setJobReport] = useState(null);   // Excel report path written when the job completes
  const [batchOpen, setBatchOpen] = useState(() => new Set());   // run_ids whose per-batch step pipeline is expanded
  const [batchRun, setBatchRun] = useState({});   // run_id -> run row (carries stage/ops for the step display)
  const toggleBatch = (runId) => setBatchOpen((p) => { const n = new Set(p); if (n.has(runId)) n.delete(runId); else n.add(runId); return n; });
  // For any expanded batch, fetch its run row (stage/ops) so we can show that batch's step pipeline; poll
  // while it is still running so the steps advance live.
  useEffect(() => {
    if (!batchOpen.size) return undefined;
    let alive = true;
    const runsMap = new Map(((jobProg && jobProg.runs) || []).map((r) => [r.run_id, r]));
    const fetchAll = () => {
      Array.from(batchOpen).forEach((runId) => {
        api.mergeProgress(null, runId).then((p) => { if (alive && p && p.run) setBatchRun((m) => ({ ...m, [runId]: p.run })); }).catch(() => {});
      });
    };
    fetchAll();
    const anyRunning = Array.from(batchOpen).some((id) => { const r = runsMap.get(id); return r && r.status === 'running'; });
    const t = anyRunning ? setInterval(fetchAll, 2500) : null;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [batchOpen, jobProg]);
  const [elapsed, setElapsed] = useState(0);
  const [progOpen, setProgOpen] = useState(true);
  const [stampMerged, setStampMerged] = useState(true);
  const [attachDossier, setAttachDossier] = useState(() => { try { return localStorage.getItem('mp_attach_dossier') !== '0'; } catch (e) { return true; } });
  const [stampFields, setStampFields] = useState(null);
  const [snapRows, setSnapRows] = useState([]);
  const [runRows, setRunRows] = useState(null);   // sets the current/last run processed — drives the live progress table, independent of the checkbox selection
  const [resumeIds, setResumeIds] = useState(null);   // ids of a run we resumed on remount (rebuild the per-set rows once the queue loads)
  const [apiBudget, setApiBudget] = useState(null);   // last captured Daily-API-Requests reading for the target org (cached, no live SF call)

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.mergeQueue('approved').then((r) => { setRows(r.rows || []); setSel(new Set()); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory(r.rows || [])).catch(() => {});
    api.mergeWhoami().then(setWho).catch(() => {});
    api.stampFields().then(setStampFields).catch(() => setStampFields(null));
    api.snapshotRows().then((r) => setSnapRows(r.rows || [])).catch(() => {});
    // NOTE: intentionally do NOT pre-load the last run's progress here — the pipeline shows the
    // neutral numbered (idle) state until a run starts in this session.
  }, []);
  useEffect(() => { load(); }, [load]);
  // Resume an IN-FLIGHT run when this panel (re)mounts — e.g. you switched to another panel and came
  // back. The merge keeps executing in the worker (+ salesforce_merge_run), but the progress bar is
  // component-local state, so without this it goes blank. Only active runs are resumed; a finished run
  // still shows the neutral idle pipeline (per the note above).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.mergeProgress('merge');
        const rn = p && p.run;
        if (cancelled || !rn || (rn.status !== 'running' && rn.status !== 'queued')) return;
        setBusy(true); setResult(null); setProgress(rn);
        try { const rp = typeof rn.params === 'string' ? JSON.parse(rn.params) : rn.params; if (rp && Array.isArray(rp.ids)) setResumeIds(rp.ids); } catch (e) { /* ignore */ }
        const finalRun = await awaitRun(api, 'merge', rn.run_id, (rr) => { if (!cancelled) setProgress(rr); });
        if (!cancelled) { setResult(summarize(finalRun)); load(); }
      } catch (e) { /* ignore — idle */ }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Once the approved queue loads, rebuild the per-set progress rows for a resumed run.
  useEffect(() => {
    if (resumeIds && resumeIds.length && rows && rows.length && (!runRows || !runRows.length)) {
      const rr = resumeIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
      if (rr.length) setRunRows(rr);
    }
  }, [resumeIds, rows]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Pull the last captured API-usage reading for the target org (cached — no live SF call) so the
  // pre-flight estimate below can compare against the remaining daily budget.
  useEffect(() => {
    if (!status) return undefined;
    let alive = true;
    const envKey = status.environment === 'Production' ? 'production' : 'sandbox';
    api.sfApiUsage(envKey).then((r) => {
      const da = r && r.latest && r.latest.daily_api;
      if (alive) setApiBudget(da ? { remaining: da.remaining, max: da.max, at: r.latest.at_mtn } : null);
    }).catch(() => { if (alive) setApiBudget(null); });
    return () => { alive = false; };
  }, [status]);

  // When sets are ADDED to the selection (new rows enter the progress table), reset the pipeline to
  // idle so it reflects the new pending run rather than a previous run's result. Clearing/removing
  // selections (e.g. after a run) does not reset, so the last run's result stays visible.
  const prevSelRef = useRef(new Set());
  useEffect(() => {
    const added = [...sel].some((id) => !prevSelRef.current.has(id));
    prevSelRef.current = new Set(sel);
    if (added && !busy) { setProgress(null); setResult(null); setElapsed(0); }
  }, [sel, busy]);

  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selCount = sel.size;
  const ids = [...sel];
  const estOps = rows.filter((r) => sel.has(r.id)).reduce((s, r) => s + Math.ceil((Number(r.loser_count) || 0) / 2), 0);
  const estApiCalls = rows.filter((r) => sel.has(r.id)).reduce((acc, r) => acc + Math.max(1, Math.ceil((Number(r.loser_count) || 0) / 2)), 0) + selCount * (3 + (stampMerged ? 1 : 0));
  const apiRemaining = apiBudget ? apiBudget.remaining : null;
  const apiWouldExceed = apiRemaining != null && estApiCalls > apiRemaining;
  const safe = !status || status.safe_mode;
  const apSort = useSort();    // Approved merges
  const [apExpanded, setApExpanded] = useState(() => new Set());
  const toggleApExpand = (id) => setApExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const histSort = useSort();  // Merge history
  const paSort = useSort();    // per-account progress

  // The per-set pipeline that merge_execute runs, surfaced so the UI is transparent about what
  // happens (and what is blocked) in the current mode. Step 4 is the only Salesforce write.
  const steps = [
    { n: 1, label: 'Re-fetch fresh data & re-run dry-run (apply saved overrides)', state: 'run' },
    { n: 2, label: 'Re-validate & drift check',
      note: 'confirm records still present; compare identity fields (email, member #, name, DOB, gender, ZIP, address) to what you staged. On Execute, drifted sets are skipped unless acknowledged',
      state: 'run' },
    { n: 3, label: 'Write pre-merge snapshot (restore baseline)', state: 'run' },
    { n: 4, label: 'Execute Salesforce Database.merge (master + 2 at a time)',
      note: safe ? 'blocked by safe mode' : (mode === 'execute' ? 'armed in Execute mode' : 'Simulate mode — skipped'),
      state: (!safe && mode === 'execute') ? 'run' : 'locked' },
    { n: 5, label: (!safe && mode === 'execute') ? 'Record history & set status done/failed' : 'Record history (simulated result)',
      state: 'run' },
  ];
  const stepMark = (st) => (st === 'locked' ? '🔒' : st === 'pending' ? '○' : '✓');
  const stepColor = (st) => (st === 'run' ? 'var(--green)' : 'var(--dim)');

  // Live progress: while a run is in flight, poll the run-progress record + tick an elapsed timer.
  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const poll = setInterval(() => {
      api.mergeHistory().then((r) => setHistory(r.rows || [])).catch(() => {});
    }, 1000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [busy]);

  const [maxBatch, setMaxBatch] = useState(() => { const v = Number(localStorage.getItem('mp_max_batch')); return (v >= 1 && v <= 500) ? v : 100; });
  const seededMax = useRef(false);
  useEffect(() => {
    if (!seededMax.current && status && status.max_batch != null && localStorage.getItem('mp_max_batch') == null) setMaxBatch(Math.min(500, Math.max(1, status.max_batch)));
    if (status) seededMax.current = true;
  }, [status]);
  const setMax = (n) => { const v = Math.min(500, Math.max(1, Number(n) || 1)); setMaxBatch(v); try { localStorage.setItem('mp_max_batch', String(v)); } catch (e) { /* ignore */ } };
  const overBatch = selCount > maxBatch;
  const canExecute = !safe && mode === 'execute' && confirmText === 'MERGE' && selCount > 0 && !overBatch;
  const eta = (() => {
    if (!progress || !progress.completed_ops || !progress.total_ops || !elapsed) return null;
    const per = elapsed / progress.completed_ops;
    const remain = Math.max(0, progress.total_ops - progress.completed_ops);
    return Math.round(per * remain);
  })();

  const run = async (execute) => {
    if (!ids.length) return;
    setRunRows(ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean));   // snapshot the sets this run processes (in submit order)
    setBusy(true); setErr(''); setResult(null); setProgress(null); setElapsed(0); setJobProg(null); setJobId(null); setJobReport(null);
    try {
      const q = await api.mergeProcess(ids, execute ? { mode: 'execute', confirm: confirmText, stamp_merged: stampMerged, ack_drift: ackDrift, max_batch: maxBatch, attach_dossier: attachDossier } : { mode: 'simulate', stamp_merged: stampMerged, attach_dossier: attachDossier });
      setConfirmText('');
      if (q.job_id) {
        // Phase 4: the run fanned out into parallel batches — poll the aggregate job progress instead.
        setJobId(q.job_id);
        const job = await awaitJob(api, q.job_id, (jp) => setJobProg(jp));
        setResult({ mode: execute ? 'execute' : 'simulate', done: job ? job.completed_sets : 0, processed: job ? job.completed_sets : 0, job_id: q.job_id, parallel: true, status: job ? job.status : 'unknown' });
        // Finalize the job into the Excel workbook + sweep row (skip while merely paused — resume finishes it).
        if (job && job.status && job.status !== 'paused') { api.mergeJobReport(q.job_id).then((r) => setJobReport(r.report || null)).catch(() => {}); }
        load();
      } else {
        // Phase 3: single run — poll this run until it reaches a terminal status.
        const finalRun = await awaitRun(api, 'merge', q.run_id, (rr) => setProgress(rr));
        setResult(summarize(finalRun)); load();
        // Report a single run too (same workbook + sweep row).
        if (finalRun && finalRun.run_id) { api.mergeRunReport(finalRun.run_id).then((r) => setJobReport(r.report || null)).catch(() => {}); }
      }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); setStopping(false); }
  };

  // Cooperative stop: flag the running run; it halts at the next set boundary. The current set finishes
  // and the in-flight POST resolves normally, so the UI stays "Running…" until then.
  const stop = async () => {
    setStopping(true);
    try { if (jobId) await api.mergeJobCancel(jobId); else await api.mergeCancel(); } catch (e) { setErr(e.message); setStopping(false); }
  };
  // Resume a job paused by the async-Apex breaker (re-queues held batches).
  const resumeJob = async () => { if (jobId) { try { await api.mergeJobResume(jobId); } catch (e) { setErr(e.message); } } };
  // Move the selected approved sets back to queued (un-approve) — drops them off this page until re-approved.
  const unapprove = async () => {
    if (!ids.length) return;
    try { await api.mergeQueueUnapprove(ids); setSel(new Set()); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="mtbl">
      <h2>Process Merges</h2>
      <p className="muted small">Validate, back up, and (in Phase 3) execute approved merges. Safe mode performs no Salesforce writes.</p>
      <DatasetStamp />
      <WorkerBanner />
      {err && <p className="err">{err}</p>}

      <div className="card" style={{ margin: '8px 0 12px', borderColor: safe ? 'var(--green)' : 'var(--red)', background: safe ? 'var(--green-bg)' : 'var(--red-bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: safe ? 'var(--green)' : 'var(--red)' }}>{safe ? 'Safe mode is ON — no Salesforce writes' : 'Execution ENABLED'}</strong>
        <span className="muted small">{safe ? 'Processing runs the full dry-run + snapshot and records a simulated result.' : 'Real merges may run behind the remaining gates.'}</span>
        <span style={{ marginLeft: 'auto' }} className="muted small">Target environment: <strong>{status ? (status.environment || '—') : '…'}</strong>{status && status.data_as_of ? ' · data as of ' + new Date(status.data_as_of).toLocaleString() : ''}</span>
      </div>

      <div className="card" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <strong>Connected Salesforce user</strong>
        <span className="muted">{who ? (who.username || who.display_name || '—') : '…'}</span>
        {who && (
          <span className="pill" title="A merge needs Update + Delete on Account" style={{ color: who.can_merge ? 'var(--green)' : 'var(--amber)', borderColor: 'currentColor' }}>
            {who.can_merge ? '✓ can merge (update + delete on Account)' : '✕ cannot merge — read-only / no delete'}
          </span>
        )}
        {who && who.objects && who.objects.Account && !who.objects.Account.error && (
          <span className="muted small">Account: {['createable', 'updateable', 'deletable'].filter((k) => who.objects.Account[k]).join(' · ') || 'no CRUD'}</span>
        )}
        <span className="muted small" style={{ marginLeft: 'auto' }}>Phase 3b plan: a dedicated write-enabled user performs merges.</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="card"><div className="stat-label">Approved</div><div className="stat-value">{rows.length}</div></div>
        <div className="card"><div className="stat-label">Selected</div><div className="stat-value">{selCount}</div></div>
        <div className="card"><div className="stat-label">~Merge ops</div><div className="stat-value">{estOps}</div></div>
        <div className="card"><div className="stat-label">Mode</div><div className="stat-value" style={{ fontSize: 18 }}>{safe ? 'Safe' : 'Live'}</div></div>
      </div>

      {/* Steps + execute */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <div className="card" style={{ flex: '2 1 360px', minWidth: 0, margin: 0 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Processing steps <span className="muted small" style={{ fontWeight: 400 }}>(per approved set)</span></p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 1.5 }}>
            {steps.map((s) => (
              <li key={s.n} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', opacity: s.state === 'run' ? 1 : 0.65 }}>
                <span aria-hidden="true" style={{ width: 16, flex: '0 0 16px', textAlign: 'center', color: stepColor(s.state) }}>{stepMark(s.state)}</span>
                <span><strong>{s.n} ·</strong> {s.label}{s.note ? <span className="muted"> — <strong>{s.note}</strong></span> : ''}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Run</p>
          <div className="seg" style={{ width: '100%', marginBottom: 8 }}>
            <button className={'seg-btn' + (mode === 'simulate' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setMode('simulate')}>Simulate</button>
            <button className={'seg-btn' + (mode === 'execute' ? ' on' : '')} style={{ flex: 1 }} disabled={safe} title={safe ? 'Execution disabled (safe mode)' : ''} onClick={() => setMode('execute')}>Execute</button>
          </div>
          {mode === 'execute' && !safe && (
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="type MERGE to confirm"
              style={{ width: '100%', marginBottom: 8 }} />
          )}
          {mode === 'execute' && !safe && result && result.drift > 0 && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 8px', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: '#854f0b' }}>
              <input type="checkbox" checked={ackDrift} onChange={(e) => setAckDrift(e.target.checked)} style={{ marginTop: 2 }} />
              <span>⚠ {result.drift} set(s) changed since staging. I’ve reviewed the changes — merge them anyway. <strong>Unchecked, drifted sets are skipped</strong> (left approved) and only clean sets run.</span>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 6px' }}>
            <input type="checkbox" checked={stampMerged} onChange={(e) => setStampMerged(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Stamp survivor with the merge action <code>(usat_was_*)</code> — flag→on, <code>usat_was_merged_by__c</code> = “MERGE — you”.</span>
          </label>
          {stampMerged && stampFields && (!stampFields.usat_was_merged__c || !stampFields.usat_was_merged_date__c || !stampFields.usat_was_merged_by__c) && (
            <p className="small" style={{ margin: '0 0 8px', color: 'var(--amber)' }}>
              ⚠ {[!stampFields.usat_was_merged__c && 'usat_was_merged__c', !stampFields.usat_was_merged_date__c && 'usat_was_merged_date__c', !stampFields.usat_was_merged_by__c && 'usat_was_merged_by__c'].filter(Boolean).join(' + ')} not found on Account — create it in Salesforce (Setup → Object Manager → Account → Fields). The merge still runs; the stamp is skipped for any missing field. <code>usat_was_merged_by__c</code> records who ran the merge.
            </p>
          )}
          {stampMerged && stampFields && stampFields.usat_was_merged__c && stampFields.usat_was_merged_date__c && stampFields.usat_was_merged_by__c && (
            <p className="muted small" style={{ margin: '0 0 8px', color: 'var(--green)' }}>✓ stamp fields present (flag, date, by)</p>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 6px' }}>
            <input type="checkbox" checked={attachDossier} onChange={(e) => { setAttachDossier(e.target.checked); try { localStorage.setItem('mp_attach_dossier', e.target.checked ? '1' : '0'); } catch (er) {} }} style={{ marginTop: 2 }} />
            <span>📎 Attach merge dossier to the survivor. Applies on Execute; best‑effort.</span>
          </label>
          {mode === 'execute' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 8px' }}>
              <span className="muted small">Max sets per run</span>
              <input type="number" min={1} max={500} value={maxBatch} onChange={(e) => setMax(e.target.value)} style={{ width: 66 }} title="Cap how many sets one Execute processes (1–500). Enforced server-side." />
              <span className="muted small">· hard cap 500</span>
            </div>
          )}
          {/* Parallel state + fan-out prediction — so it's clear whether THIS run will split into batches
              before you launch it. A run only fans out when parallel is on AND the selection exceeds one chunk. */}
          {selCount > 0 && status && (
            <p className="small" style={{ margin: '0 0 8px' }}>
              {status.parallel_enabled ? (
                selCount > (status.chunk_size || 5) ? (
                  <span><strong style={{ color: 'var(--green)' }}>⇉ Parallel</strong> · this run will fan out into ≈ <strong>{Math.ceil(selCount / (status.chunk_size || 5))}</strong> batches (chunk size {status.chunk_size})</span>
                ) : (
                  <span><strong>→ Single run</strong> · parallel is on, but {selCount} set{selCount === 1 ? '' : 's'} fit{selCount === 1 ? 's' : ''} in one chunk (≤ {status.chunk_size}) — no fan-out</span>
                )
              ) : (
                <span><strong style={{ color: 'var(--dim)' }}>→ Single run</strong> · parallel is off (an admin can enable it in Merge Ops → Settings)</span>
              )}
            </p>
          )}
          {mode === 'execute' && selCount > 0 && (
            <div className="muted small" style={{ margin: '0 0 8px', padding: '6px 8px', borderRadius: 6, border: '1px solid ' + (apiWouldExceed ? 'var(--red)' : 'var(--line, #e4e7ec)'), color: apiWouldExceed ? 'var(--red)' : undefined }}>
              Pre-flight: {selCount} set{selCount === 1 ? '' : 's'} ≈ <strong>{estApiCalls.toLocaleString()}</strong> API call{estApiCalls === 1 ? '' : 's'}
              {apiRemaining != null ? ' · ' + apiRemaining.toLocaleString() + ' remaining today' : ' · no recent reading (see SF API panel)'}
              {apiWouldExceed && ' — ⚠ exceeds remaining budget; split the run or wait for the daily reset'}
            </div>
          )}
          {mode === 'execute' && overBatch && (
            <p className="small" style={{ margin: '0 0 8px', color: 'var(--red)' }}>⚠ {selCount} selected exceeds the max of {maxBatch} per Execute — deselect some (an admin can raise MERGE_MAX_BATCH).</p>
          )}
          <button className="btn primary" style={{ width: '100%', marginTop: 0 }} disabled={busy || !canExecute}
            title={safe ? 'Execution is locked (safe mode)' : 'Type MERGE and select sets to enable'} onClick={() => run(true)}>
            ▷ Execute merges{safe ? ' (off)' : ''}
          </button>
          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy || selCount === 0} onClick={() => run(false)}>
            {busy ? 'Running…' : '👁 Run simulate (' + selCount + ')'}
          </button>
          <button className="btn" style={{ width: '100%', marginTop: 8, color: 'var(--red)', borderColor: 'var(--red)' }}
            disabled={!busy || stopping} title={busy ? 'Stop after the current set finishes; remaining sets stay approved' : 'Available once a run is in progress'} onClick={stop}>
            {stopping ? 'Stopping after current set…' : '■ Stop'}
          </button>
          <p className="muted small" style={{ marginTop: 8 }}>Gates: execution flag · sandbox · snapshot ok · typed confirm</p>
        </div>
      </div>

      <CollapsibleCard
        title={<>Approved merges <span className="muted small" style={{ fontWeight: 400 }}>({rows.length})</span></>}
        actions={rows.length > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {selCount > 0 && <button className="btn" style={{ width: 'auto', padding: '2px 8px' }} onClick={unapprove}
              title="Move the selected approved sets back to queued (returns them to Select Merges; off this page until re-approved)">↩ Move to queued ({selCount})</button>}
            <span className="dl-group">
              <span className="muted small">Export</span>
              <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { status: 'approved', format: 'csv' })}>CSV</a>
              <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { status: 'approved', format: 'xlsx' })}>Excel</a>
            </span>
          </span>
        ) : null}
      >
        <div className="dt-scroll" style={{ maxHeight: 320 }}>
          <table className="modal-table" style={{ width: '100%' }}>
            <thead><tr>
              <th title="Select for processing"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>
              <th title="Row number">#</th>
              <th title="Surviving record (kept as the master) — click to sort" style={{ cursor: 'pointer' }} onClick={() => apSort.onSort('survivor_name')}>Survivor<span className="th-info"> ⓘ</span>{apSort.arrow('survivor_name')}</th>
              <th title="Survivor Salesforce account id — click to sort" style={{ minWidth: 190, cursor: 'pointer' }} onClick={() => apSort.onSort('survivor_account')}>Account<span className="th-info"> ⓘ</span>{apSort.arrow('survivor_account')}</th>
              <th title="Number of accounts merged into the survivor — click to sort" style={{ cursor: 'pointer' }} onClick={() => apSort.onSort('loser_count')}>Merging<span className="th-info"> ⓘ</span>{apSort.arrow('loser_count')}</th>
              <th title="Where the set came from — click to sort" style={{ cursor: 'pointer' }} onClick={() => apSort.onSort('source_key')}>Source<span className="th-info"> ⓘ</span>{apSort.arrow('source_key')}</th>
              <th title="Survivor-selection rule — click to sort" style={{ cursor: 'pointer' }} onClick={() => apSort.onSort('master_rule')}>Rule<span className="th-info"> ⓘ</span>{apSort.arrow('master_rule')}</th>
              <th title="Environment the set was built from — click to sort" style={{ cursor: 'pointer' }} onClick={() => apSort.onSort('environment')}>Env<span className="th-info"> ⓘ</span>{apSort.arrow('environment')}</th>
            </tr></thead>
            <tbody>
              {apSort.apply(rows).map((r, i) => [
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td><button type="button" onClick={() => toggleApExpand(r.id)} title="Show overrides & details" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, marginRight: 3, font: 'inherit' }}>{apExpanded.has(r.id) ? '▾' : '▸'}</button>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title={r.survivor_account}>{r.survivor_account || '—'}</td>
                  <td>{r.loser_count} account{Number(r.loser_count) === 1 ? '' : 's'}{r.field_overrides && typeof r.field_overrides === 'object' && Object.keys(r.field_overrides).length ? <span title="This set has field overrides" style={{ marginLeft: 4, color: 'var(--amber)' }}>✎</span> : null}</td>
                  <td title={r.source_key}>{r.source_type === 'merge_id' ? 'merge id ' : 'group '}{shortId(r.source_key)}</td>
                  <td>{r.master_rule || 'cascade'}</td>
                  <td>{r.environment || '—'}</td>
                </tr>,
                apExpanded.has(r.id) ? <tr key={r.id + '_d'}><td colSpan={8} style={{ padding: 0 }}><QueueRowDetail row={r} /></td></tr> : null,
              ])}
              {rows.length === 0 && <tr><td colSpan={8} className="muted small">No approved merges. Approve sets in Select Merges first.</td></tr>}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      {/* Phase 4: when a run fans out into parallel batches, show ONE aggregate progress panel instead of
          the single-run pipeline (which tracks only one chunk-run). */}
      {jobProg ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong>Parallel job {jobProg.job_id}</strong>
            <span className="small" style={{ color: jobProg.status === 'done' ? 'var(--green)' : jobProg.status === 'error' ? 'var(--red)' : jobProg.status === 'paused' ? 'var(--amber)' : 'var(--accent)' }}>{jobProg.status}</span>
          </div>
          {(() => {
            const pct = jobProg.total_sets ? Math.round(100 * (jobProg.completed_sets || 0) / jobProg.total_sets) : 0;
            const rs = (jobProg.runs || []).filter((r) => r.seconds != null);
            const pm = rs.map((r) => (r.total_sets ? r.seconds / r.total_sets : null)).filter((x) => x != null).sort((a, b) => a - b);
            const secPerMerge = pm.length ? Math.round((pm.length % 2 ? pm[(pm.length - 1) / 2] : (pm[pm.length / 2 - 1] + pm[pm.length / 2]) / 2) * 10) / 10 : null;
            const fmtS = (s) => (s == null ? '—' : (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'));
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 10, background: 'var(--line)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} /></div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {jobProg.completed_sets}/{jobProg.total_sets} sets · {jobProg.runs_done}/{jobProg.runs_total} batches · {jobProg.workers_active} worker(s) active · total {fmtS(jobProg.total_seconds)}{secPerMerge != null ? ' · ~' + secPerMerge + 's/merge' : ''}{jobProg.runs_held ? ' · ' + jobProg.runs_held + ' held' : ''}
                </div>
                {(jobProg.runs || []).length ? (
                  <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8, border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
                    <table className="modal-table" style={{ width: '100%', fontSize: 12 }}>
                      <thead><tr>{['Batch', 'Worker', 'Sets', 'Time', 'Status'].map((h) => <th key={h} style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(jobProg.runs || []).map((r) => (
                          <tr key={r.run_id}><td>{r.batch_index || '—'}/{r.batch_total || (jobProg.runs || []).length}</td><td>{r.worker || '—'}</td><td>{r.completed_sets}/{r.total_sets}</td><td>{fmtS(r.seconds)}</td><td>{r.status}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })()}
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            <button className="btn" style={{ width: 'auto' }} disabled={jobProg.status !== 'running' || stopping} onClick={stop}>Stop job</button>
            <button className="btn" style={{ width: 'auto' }} disabled={jobProg.status !== 'paused'} onClick={resumeJob}>Resume job</button>
          </div>
          {jobProg.status === 'paused' ? <p className="small" style={{ color: 'var(--amber)', marginTop: 6 }}>Paused by the async-Apex cap — resume when headroom returns (or the daily counter rolls over).</p> : null}
          {jobReport ? <p className="small muted" style={{ marginTop: 6 }}>Report written: <span className="mono">{jobReport}</span> (+ sweep row)</p> : null}
        </div>
      ) : null}

      {jobReport && !jobProg ? <div className="small muted" style={{ marginTop: 10 }}>Report written: <span className="mono">{jobReport}</span> (+ sweep row)</div> : null}

      {(() => {
        if (jobProg) return null;   // parallel job → aggregate panel above replaces the single-run pipeline
        const activeIdx = progress ? MERGE_STAGES.findIndex((s) => s.key === progress.stage) : -1;
        const pct = progress && progress.total_ops ? Math.round(100 * (progress.completed_ops || 0) / progress.total_ops) : 0;
        // Stage-level drift cue: the validate step turns amber when the check flagged changes since staging.
        const driftFlag = (result && result.drift > 0) || (progress && /changed since staged/i.test(progress.current_label || ''));
        const selectedRows = rows.filter((r) => sel.has(r.id));
        const pipelineRows = ((busy || progress || result) && runRows && runRows.length) ? runRows : selectedRows;
        const runId = progress && progress.run_id;
        const hByQueue = {}; // history is newest-first; during a live run restrict to this run
        for (const h of history) {
          if (hByQueue[h.queue_id] != null) continue;
          if (busy && runId && h.run_id !== runId) continue;
          hByQueue[h.queue_id] = h;
        }
        const STATUS_COLOR = { ...RESULT_COLOR, processing: 'var(--accent)', pending: 'var(--dim)' };
        const origIdx = new Map(pipelineRows.map((r, idx) => [r.id, idx])); // processing order, independent of display sort
        const statusFor = (row) => {
          const h = hByQueue[row.id];
          if (h) return h.result;
          if (busy && progress && origIdx.get(row.id) === (progress.completed_sets || 0)) return 'processing';
          return busy ? 'pending' : '—';
        };
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <button type="button" onClick={() => setProgOpen((o) => !o)} aria-expanded={progOpen} title={progOpen ? 'Collapse' : 'Expand'} style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', font: 'inherit', padding: 0, width: 14 }}>{progOpen ? '▾' : '▸'}</button>
              <span>Progress</span>
              {result && !result.parallel ? <span style={{ padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(120,120,120,.18)', color: 'var(--dim)' }} title="This run did not fan out — it executed as one run in the app server.">SINGLE RUN</span> : null}
              <span className="muted small" style={{ fontWeight: 400 }}>{progress ? ' — ' + (progress.current_label || progress.status) : (busy ? ' — starting…' : ' — no run this session')}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={!busy || stopping} title={busy ? 'Stop after the current set finishes; remaining sets stay approved' : 'Available once a run is in progress'} onClick={stop}>
                  {stopping ? 'Stopping…' : '■ Stop'}
                </button>
                <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} title="Clear the progress display" onClick={() => { setProgress(null); setResult(null); setElapsed(0); }}>Reset</button>
              </span>
            </p>
            {progOpen && (<>
            <div className="stepper">
              {MERGE_STAGES.map((s, i) => {
                const finished = progress && (progress.status === 'done' || progress.status === 'error' || progress.status === 'cancelled');
                const isSkip = s.key === 'merge' && progress && progress.mode === 'simulate';
                const isDrift = s.key === 'validate' && driftFlag;
                const state = isSkip ? 'skip'
                  : (activeIdx < 0 ? ''
                    : (i < activeIdx ? 'done' : (i === activeIdx ? (finished ? 'done' : 'running') : '')));
                const amber = { background: 'var(--amber-bg)', color: '#854f0b' };
                return (
                  <div className="step-wrap" key={s.key} title={s.desc}>
                    <span className={'step-dot' + (state === 'done' || state === 'running' ? ' ' + state : '')}
                      style={state === 'skip' ? { background: 'var(--red-bg)', color: 'var(--red)' } : (isDrift ? amber : undefined)}>
                      {isDrift ? '⚠' : state === 'done' ? '✓' : state === 'skip' ? '✕' : i + 1}</span>
                    <span className="step-label" style={state === 'skip' ? { color: 'var(--red)' } : (isDrift ? { color: '#854f0b' } : undefined)}>{s.label}{isSkip ? ' (skipped)' : ''}{isDrift ? ' ⚠' : ''}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              {progress ? (progress.completed_ops || 0) + ' / ' + (progress.total_ops || 0) + ' operations (' + pct + '%)' : ''}
              {' · elapsed ' + elapsed + 's'}{eta != null ? ' · ~' + eta + 's left' : ''}
            </p>
            {driftFlag && (
              <p className="small" style={{ marginTop: 4, color: '#854f0b' }}>
                ⚠ Drift found at the validate step. On <strong>Execute</strong>, drifted sets are skipped (left approved) until you tick the “merge anyway” box after reviewing the changes.
              </p>
            )}
            <div className="dt-scroll" style={{ maxHeight: 240, marginTop: 8 }}>
              <table className="modal-table">
                <thead><tr>
                  <th title="Row number">#</th>
                  <th title="Surviving record — click to sort" style={{ cursor: 'pointer' }} onClick={() => paSort.onSort('survivor_name')}>Survivor{paSort.arrow('survivor_name')}</th>
                  <th title="Survivor account id — click to sort" style={{ cursor: 'pointer' }} onClick={() => paSort.onSort('survivor_account')}>Account{paSort.arrow('survivor_account')}</th>
                  <th title="Accounts merged into the survivor — click to sort" style={{ cursor: 'pointer' }} onClick={() => paSort.onSort('loser_count')}>Merging{paSort.arrow('loser_count')}</th>
                  <th title="Live status: pending / processing / done / simulated / skipped / failed">Status</th>
                </tr></thead>
                <tbody>
                  {paSort.apply(pipelineRows).flatMap((r, i) => {
                    const st = statusFor(r);
                    const dr = result && result.results && result.results.find((x) => Number(x.id) === Number(r.id));
                    const hasDrift = dr && dr.drift_fields > 0;
                    const open = driftRowOpen.has(r.id);
                    return [
                      <tr key={r.id}>
                        <td>{i + 1}</td>
                        <td>{r.survivor_name || '—'}</td>
                        <td title={r.survivor_account} style={{ whiteSpace: 'nowrap' }}>{r.survivor_account}</td>
                        <td>{r.loser_count}</td>
                        <td>
                          <span className="pill" style={{ color: STATUS_COLOR[st] || 'var(--dim)' }}>{st}</span>
                          {(() => { const h = hByQueue[r.id]; return (h && h.reason && (h.result === 'skipped' || h.result === 'failed')) ? <span className="muted small" style={{ marginLeft: 6 }} title={h.reason}>— {h.reason}</span> : null; })()}
                          {hasDrift && (
                            <button type="button" onClick={() => toggleDriftRow(r.id)} title="Show what changed since staging"
                              className="pill" style={{ marginLeft: 6, color: '#854f0b', background: 'var(--amber-bg)', border: 0, cursor: 'pointer', font: 'inherit' }}>
                              {open ? '▾' : '▸'} ⚠ {dr.drift_fields} changed since staged
                            </button>
                          )}
                        </td>
                      </tr>,
                      hasDrift && open ? <tr key={r.id + '_drift'}><td colSpan={5} style={{ padding: 0 }}><MergeDriftDetail detail={dr.drift_detail || []} account={r.survivor_account} /></td></tr> : null,
                    ];
                  })}
                  {pipelineRows.length === 0 && <tr><td colSpan={5} className="muted small">No sets selected — check sets above, or run a simulate to see live per-set status.</td></tr>}
                </tbody>
              </table>
            </div>
            </>)}
          </div>
        );
      })()}

      {result && (
        <p className="muted small" style={{ marginTop: 8, color: result.cancelled ? 'var(--red)' : 'var(--accent)' }}>
          {result.cancelled ? '■ Stopped — ' : ''}Run {result.run_id} ({result.mode}): {result.done || 0} done, {result.simulated || 0} simulated, {result.skipped} skipped, {result.failed} failed{result.drift ? ', ⚠ ' + result.drift + ' with field drift since staging' : ''}{result.cancelled ? ', ' + (result.remaining || 0) + ' left approved (run again to finish)' : ''}.
        </p>
      )}
      {result && (result.failed > 0 || result.skipped > 0) && (history || [])
        .filter((h) => String(h.run_id) === String(result.run_id) && (h.result === 'failed' || h.result === 'skipped'))
        .map((h, i) => (
          <p key={i} className="small" style={{ margin: '2px 0 0', color: 'var(--red)' }}>⚠ {h.survivor_name ? h.survivor_name + ': ' : ''}{h.reason}</p>
        ))}

      <CollapsibleCard
        title={<>Merge history <span className="muted small" style={{ fontWeight: 400 }}>({history.length})</span></>}
        actions={history.length > 0 ? (
          <span className="dl-group">
            <span className="muted small">Export</span>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { format: 'csv' })}>CSV</a>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { format: 'xlsx' })}>Excel</a>
          </span>
        ) : null}
      >
        <div className="dt-scroll" style={{ maxHeight: 300 }}>
          <table className="modal-table">
            <thead><tr>
              <th title="Row number">#</th>
              <th title="When the run happened — click to sort" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => histSort.onSort('created_at')}>When<span className="th-info"> ⓘ</span>{histSort.arrow('created_at')}</th>
              <th title="Surviving record — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('survivor_name')}>Survivor<span className="th-info"> ⓘ</span>{histSort.arrow('survivor_name')}</th>
              <th title="How many accounts were merged in — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('loser_count')}>Merged<span className="th-info"> ⓘ</span>{histSort.arrow('loser_count')}</th>
              <th title="Child records counted at run time — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('child_total')}>Children<span className="th-info"> ⓘ</span>{histSort.arrow('child_total')}</th>
              <th title="Environment the run targeted — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('environment')}>Env<span className="th-info"> ⓘ</span>{histSort.arrow('environment')}</th>
              <th title="Outcome — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('result')}>Result<span className="th-info"> ⓘ</span>{histSort.arrow('result')}</th>
              <th title="Whether a pre-merge snapshot was saved — click to sort" style={{ cursor: 'pointer' }} onClick={() => histSort.onSort('snapshot_saved')}>Snapshot<span className="th-info"> ⓘ</span>{histSort.arrow('snapshot_saved')}</th>
              <th title="Detail / error / skip reason">Reason<span className="th-info"> ⓘ</span></th>
            </tr></thead>
            <tbody>
              {histSort.apply(history).map((h, i) => (
                <tr key={h.id}>
                  <td>{i + 1}</td>
                  <td>{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                  <td title={h.survivor_account}>{h.survivor_name || shortId(h.survivor_account)}</td>
                  <td>{h.loser_count == null ? '—' : h.loser_count}</td>
                  <td>{h.child_total == null ? '—' : h.child_total}</td>
                  <td>{h.environment || '—'}</td>
                  <td><span className="pill" style={{ color: RESULT_COLOR[h.result] || 'var(--dim)' }}>{h.result}</span></td>
                  <td>{h.snapshot_saved ? 'saved' : '—'}</td>
                  <td title={h.reason} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.reason || ''}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={8} className="muted small">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          Every run validates environment/org alignment and writes a pre-merge snapshot before any merge. Restore is best-effort (Phase 4).
        </p>
      </CollapsibleCard>

      <CollapsibleCard
        title={<>Pre-merge snapshot <span className="muted small" style={{ fontWeight: 400 }}>(restore baseline — search &amp; filter)</span></>}
        actions={snapRows.length > 0 ? (
          <span className="dl-group">
            <span className="muted small">Export</span>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/snapshot/export', { format: 'csv' })}>CSV</a>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/snapshot/export', { format: 'xlsx' })}>Excel</a>
          </span>
        ) : null}
      >
        <DataTable
          rows={snapRows}
          searchCols="name, account, survivor, object, run"
          minWidth={1180}
          facets={{ role: ['survivor', 'loser', 'child'], child_type: ['child', 'self_account', 'self_contact'] }}
          columns={[
            { key: 'role', label: 'Role', sort: true, filter: true, help: 'survivor / loser / child' },
            { key: 'name', label: 'Name', sort: true, help: "The record's name (child rows show their owning account's name)", render: (r) => (<span style={{ whiteSpace: 'nowrap' }}>{r.name || ''}</span>) },
            { key: 'survivor_account', label: 'Survivor', sort: true, help: 'Surviving master account id for this set' },
            { key: 'account', label: 'Account', sort: true, help: 'This row’s account id' },
            { key: 'child_type', label: 'Child type', sort: true, filter: true, help: 'child / self_account / self_contact' },
            { key: 'child_object', label: 'Object', sort: true, filter: true, help: 'SObject type of the child record' },
            { key: 'contact', label: 'Contact', sort: true, help: 'Person Contact id' },
            { key: 'field', label: 'Field', help: 'Captured record JSON — hover or export for the full value', render: (r) => (<span title={r.field} style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{r.field}</span>) },
            { key: 'created_at', label: 'When', sort: true, help: 'When the snapshot row was written', render: (r) => (<span style={{ whiteSpace: 'nowrap' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</span>) },
            { key: 'run_id', label: 'Run', sort: true, help: 'Merge run id that produced this snapshot', render: (r) => (<span style={{ whiteSpace: 'nowrap' }}>{r.run_id}</span>) },
          ]}
        />
      </CollapsibleCard>

      <div className="card" style={{ marginTop: 12, background: 'var(--card)' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700 }}>How processing works</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li><strong>Environment alignment.</strong> Each approved set is stamped with the environment it was built from. Processing re-checks that against the currently loaded data and the connected org id, and skips any set whose lineage does not match — so a set built from Sandbox can never run against Production (or vice-versa).</li>
          <li><strong>Safe by default.</strong> Unless execution is explicitly enabled, no Salesforce write happens: each set is re-validated against fresh data, backed up to a pre-merge snapshot, and recorded as <em>simulated</em>.</li>
          <li><strong>Two checks at the validate step.</strong> (1) <em>Records present</em> — if an account was removed or is missing since approval, the set is skipped. (2) <em>Field drift</em> — the reviewed values are compared to what you staged; changes are flagged in the stepper (amber) and per set. This covers the <strong>core identity fields</strong> (email, member #, name, date of birth, gender, ZIP, address, merge id), not every field. On Execute, drifted sets are <strong>skipped and left approved</strong> until you tick “merge anyway” after reviewing them; clean sets run normally. Simulate only reports.</li>
          <li><strong>Phase 3 execution + restore.</strong> When enabled (sandbox first, typed confirm), processing writes the survivor fields, runs Salesforce <code>Database.merge</code>, logs history, and supports best-effort restore from the snapshot.</li>
        </ul>
      </div>
    </div>
  );
}
