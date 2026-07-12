import { useEffect, useState, useCallback, useRef } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import DataTable from '../components/DataTable.jsx';
import CollapsibleCard from '../components/CollapsibleCard.jsx';
import { api, exportUrl } from '../lib/api.js';

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
  { key: 'fetch', label: 'Re-fetch + dry-run' },
  { key: 'validate', label: 'Re-validate' },
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'merge', label: 'Execute merge' },
  { key: 'record', label: 'Record' },
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
  const [progress, setProgress] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [stampMerged, setStampMerged] = useState(false);
  const [stampFields, setStampFields] = useState(null);
  const [snapRows, setSnapRows] = useState([]);

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
  const safe = !status || status.safe_mode;
  const apSort = useSort();    // Approved merges
  const histSort = useSort();  // Merge history
  const paSort = useSort();    // per-account progress

  // The per-set pipeline that merge_execute runs, surfaced so the UI is transparent about what
  // happens (and what is blocked) in the current mode. Step 4 is the only Salesforce write.
  const steps = [
    { n: 1, label: 'Re-fetch fresh data & re-run dry-run (apply saved overrides)', state: 'run' },
    { n: 2, label: 'Re-validate — flag/skip drifted sets', state: 'run' },
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
      api.mergeProgress('merge').then((r) => setProgress(r.run || null)).catch(() => {});
      api.mergeHistory().then((r) => setHistory(r.rows || [])).catch(() => {});
    }, 1000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [busy]);

  const canExecute = !safe && mode === 'execute' && confirmText === 'MERGE' && selCount > 0;
  const eta = (() => {
    if (!progress || !progress.completed_ops || !progress.total_ops || !elapsed) return null;
    const per = elapsed / progress.completed_ops;
    const remain = Math.max(0, progress.total_ops - progress.completed_ops);
    return Math.round(per * remain);
  })();

  const run = async (execute) => {
    if (!ids.length) return;
    setBusy(true); setErr(''); setResult(null); setProgress(null); setElapsed(0);
    try {
      const r = await api.mergeProcess(ids, execute ? { mode: 'execute', confirm: confirmText, stamp_merged: stampMerged } : { mode: 'simulate', stamp_merged: stampMerged });
      setResult(r); setConfirmText(''); load();
      // The 1s poller stops when busy flips false; the backend's final stage→'record' / status→'done'
      // updates usually land after the last poll, so grab the finished progress one more time here.
      try { const p = await api.mergeProgress('merge'); setProgress(p.run || null); } catch { /* keep last */ }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); setStopping(false); }
  };

  // Cooperative stop: flag the running run; it halts at the next set boundary. The current set finishes
  // and the in-flight POST resolves normally, so the UI stays "Running…" until then.
  const stop = async () => {
    setStopping(true);
    try { await api.mergeCancel(); } catch (e) { setErr(e.message); setStopping(false); }
  };

  return (
    <div className="mtbl">
      <h2>Process Merges</h2>
      <p className="muted small">Validate, back up, and (in Phase 3) execute approved merges. Safe mode performs no Salesforce writes.</p>
      <DatasetStamp />
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
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 6px' }}>
            <input type="checkbox" checked={stampMerged} onChange={(e) => setStampMerged(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Stamp survivor as merged <code>(was_merged__c, was_merged_date__c)</code></span>
          </label>
          {stampMerged && stampFields && (!stampFields.was_merged__c || !stampFields.was_merged_date__c) && (
            <p className="small" style={{ margin: '0 0 8px', color: 'var(--amber)' }}>
              ⚠ {[!stampFields.was_merged__c && 'was_merged__c', !stampFields.was_merged_date__c && 'was_merged_date__c'].filter(Boolean).join(' + ')} not found on Account — create it in Salesforce (Setup → Object Manager → Account → Fields). The merge still runs; the stamp is skipped until the field exists.
            </p>
          )}
          {stampMerged && stampFields && stampFields.was_merged__c && stampFields.was_merged_date__c && (
            <p className="muted small" style={{ margin: '0 0 8px', color: 'var(--green)' }}>✓ stamp fields present</p>
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
          <span className="dl-group">
            <span className="muted small">Export</span>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { status: 'approved', format: 'csv' })}>CSV</a>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { status: 'approved', format: 'xlsx' })}>Excel</a>
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
              {apSort.apply(rows).map((r, i) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title={r.survivor_account}>{r.survivor_account || '—'}</td>
                  <td>{r.loser_count} account{Number(r.loser_count) === 1 ? '' : 's'}</td>
                  <td title={r.source_key}>{r.source_type === 'merge_id' ? 'merge id ' : 'group '}{shortId(r.source_key)}</td>
                  <td>{r.master_rule || 'cascade'}</td>
                  <td>{r.environment || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="muted small">No approved merges. Approve sets in Select Merges first.</td></tr>}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      {(() => {
        const activeIdx = progress ? MERGE_STAGES.findIndex((s) => s.key === progress.stage) : -1;
        const pct = progress && progress.total_ops ? Math.round(100 * (progress.completed_ops || 0) / progress.total_ops) : 0;
        const selectedRows = rows.filter((r) => sel.has(r.id));
        const runId = progress && progress.run_id;
        const hByQueue = {}; // history is newest-first; during a live run restrict to this run
        for (const h of history) {
          if (hByQueue[h.queue_id] != null) continue;
          if (busy && runId && h.run_id !== runId) continue;
          hByQueue[h.queue_id] = h;
        }
        const STATUS_COLOR = { ...RESULT_COLOR, processing: 'var(--accent)', pending: 'var(--dim)' };
        const origIdx = new Map(selectedRows.map((r, idx) => [r.id, idx])); // processing order, independent of display sort
        const statusFor = (row) => {
          const h = hByQueue[row.id];
          if (h) return h.result;
          if (busy && progress && origIdx.get(row.id) === (progress.completed_sets || 0)) return 'processing';
          return busy ? 'pending' : '—';
        };
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span>Progress</span>
              <span className="muted small" style={{ fontWeight: 400 }}>{progress ? ' — ' + (progress.current_label || progress.status) : (busy ? ' — starting…' : ' — no run this session')}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={!busy || stopping} title={busy ? 'Stop after the current set finishes; remaining sets stay approved' : 'Available once a run is in progress'} onClick={stop}>
                  {stopping ? 'Stopping…' : '■ Stop'}
                </button>
                <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} title="Clear the progress display" onClick={() => { setProgress(null); setResult(null); setElapsed(0); }}>Reset</button>
              </span>
            </p>
            <div className="stepper">
              {MERGE_STAGES.map((s, i) => {
                const finished = progress && (progress.status === 'done' || progress.status === 'error' || progress.status === 'cancelled');
                const isSkip = s.key === 'merge' && progress && progress.mode === 'simulate';
                const state = isSkip ? 'skip'
                  : (activeIdx < 0 ? ''
                    : (i < activeIdx ? 'done' : (i === activeIdx ? (finished ? 'done' : 'running') : '')));
                return (
                  <div className="step-wrap" key={s.key}>
                    <span className={'step-dot' + (state === 'done' || state === 'running' ? ' ' + state : '')}
                      style={state === 'skip' ? { background: 'var(--red-bg)', color: 'var(--red)' } : undefined}>
                      {state === 'done' ? '✓' : state === 'skip' ? '✕' : i + 1}</span>
                    <span className="step-label" style={state === 'skip' ? { color: 'var(--red)' } : undefined}>{s.label}{isSkip ? ' (skipped)' : ''}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              {progress ? (progress.completed_ops || 0) + ' / ' + (progress.total_ops || 0) + ' operations (' + pct + '%)' : ''}
              {' · elapsed ' + elapsed + 's'}{eta != null ? ' · ~' + eta + 's left' : ''}
            </p>
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
                  {paSort.apply(selectedRows).map((r, i) => {
                    const st = statusFor(r);
                    return (
                      <tr key={r.id}>
                        <td>{i + 1}</td>
                        <td>{r.survivor_name || '—'}</td>
                        <td title={r.survivor_account} style={{ whiteSpace: 'nowrap' }}>{r.survivor_account}</td>
                        <td>{r.loser_count}</td>
                        <td><span className="pill" style={{ color: STATUS_COLOR[st] || 'var(--dim)' }}>{st}</span></td>
                      </tr>
                    );
                  })}
                  {selectedRows.length === 0 && <tr><td colSpan={5} className="muted small">No sets selected.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {result && (
        <p className="muted small" style={{ marginTop: 8, color: result.cancelled ? 'var(--red)' : 'var(--accent)' }}>
          {result.cancelled ? '■ Stopped — ' : ''}Run {result.run_id} ({result.mode}): {result.done || 0} done, {result.simulated || 0} simulated, {result.skipped} skipped, {result.failed} failed{result.cancelled ? ', ' + (result.remaining || 0) + ' left approved (run again to finish)' : ''}.
        </p>
      )}

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
          <li><strong>Safe by default.</strong> Unless execution is explicitly enabled, no Salesforce write happens: each set is re-validated against fresh data, backed up to a pre-merge snapshot, and recorded as <em>simulated</em>. Drifted sets (a record changed or removed since approval) are skipped.</li>
          <li><strong>Phase 3 execution + restore.</strong> When enabled (sandbox first, typed confirm), processing writes the survivor fields, runs Salesforce <code>Database.merge</code>, logs history, and supports best-effort restore from the snapshot.</li>
        </ul>
      </div>
    </div>
  );
}
