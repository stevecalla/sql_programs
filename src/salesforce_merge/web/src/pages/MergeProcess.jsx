import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api } from '../lib/api.js';

const shortId = (id) => (id && id.length > 8 ? '…' + id.slice(-5) : id || '');
const RESULT_COLOR = { simulated: '#1a8a4f', done: '#1a8a4f', skipped: '#854f0b', failed: '#c0392b' };

export default function MergeProcess() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [who, setWho] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('simulate');   // 'simulate' | 'execute'
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [stampMerged, setStampMerged] = useState(false);
  const [stampFields, setStampFields] = useState(null);

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.mergeQueue('approved').then((r) => { const rs = r.rows || []; setRows(rs); setSel(new Set(rs.map((x) => x.id))); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory(r.rows || [])).catch(() => {});
    api.mergeWhoami().then(setWho).catch(() => {});
    api.stampFields().then(setStampFields).catch(() => setStampFields(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selCount = sel.size;
  const ids = [...sel];
  const estOps = rows.filter((r) => sel.has(r.id)).reduce((s, r) => s + Math.ceil((Number(r.loser_count) || 0) / 2), 0);
  const safe = !status || status.safe_mode;

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
    const poll = setInterval(() => { api.mergeProgress('merge').then((r) => setProgress(r.run || null)).catch(() => {}); }, 1000);
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
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
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

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Approved merges <span className="muted small" style={{ fontWeight: 400 }}>({rows.length})</span></p>
        <div className="dt-scroll" style={{ maxHeight: 320 }}>
          <table className="modal-table">
            <thead><tr><th><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th><th>#</th><th>Survivor</th><th>Account</th><th>Merging</th><th>Source</th><th>Rule</th><th>Env</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td title={r.survivor_account}>{shortId(r.survivor_account)}</td>
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
          <p className="muted small" style={{ marginTop: 8 }}>Gates: execution flag · sandbox · snapshot ok · typed confirm</p>
        </div>
      </div>

      {(busy || progress) && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Progress
            <span className="muted small" style={{ fontWeight: 400 }}> — {progress ? (progress.current_label || progress.status) : 'starting…'}</span>
          </p>
          <div style={{ background: 'var(--line)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: (progress && progress.total_ops ? Math.round(100 * (progress.completed_ops || 0) / progress.total_ops) : 0) + '%', transition: 'width .3s' }} />
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            {progress ? (progress.completed_ops || 0) + ' / ' + (progress.total_ops || 0) + ' operations' : ''}
            {' · elapsed ' + elapsed + 's'}{eta != null ? ' · ~' + eta + 's left' : ''}
          </p>
        </div>
      )}

      {result && (
        <p className="muted small" style={{ marginTop: 8, color: 'var(--accent)' }}>Run {result.run_id} ({result.mode}): {result.done || 0} done, {result.simulated || 0} simulated, {result.skipped} skipped, {result.failed} failed.</p>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Merge history <span className="muted small" style={{ fontWeight: 400 }}>({history.length})</span></p>
        <div className="dt-scroll" style={{ maxHeight: 300 }}>
          <table className="modal-table">
            <thead><tr><th>#</th><th>When</th><th>Survivor</th><th>Merged</th><th>Children</th><th>Env</th><th>Result</th><th>Snapshot</th><th>Reason</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
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
      </div>

      <div className="card" style={{ marginTop: 12, background: 'rgba(127,127,127,.05)' }}>
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
