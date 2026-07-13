import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import WorkerBanner from '../components/WorkerBanner.jsx';
import { api } from '../lib/api.js';
import { awaitRun, summarize } from '../lib/run_poll.js';

const shortId = (id) => (id && id.length > 8 ? '…' + id.slice(-5) : id || '');
const RESULT_COLOR = { restored: '#1a8a4f', simulated: '#1a8a4f', skipped: '#854f0b', failed: '#c0392b' };

// Phase 4 — undo a completed merge (best-effort). Same safety model as Process Merges: Simulate by
// default; a real restore needs Execute mode + typed RESTORE + the deploy execution flag.
export default function Restore() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState('simulate');
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bin, setBin] = useState(null);
  // Secondary queue: sets routed to recreate-from-backup (losers gone from the Recycle Bin).
  const [recRows, setRecRows] = useState([]);
  const [recSel, setRecSel] = useState(() => new Set());
  const [recMode, setRecMode] = useState('simulate');
  const [recConfirm, setRecConfirm] = useState('');
  const [recResult, setRecResult] = useState(null);
  const [recBusy, setRecBusy] = useState(false);

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.mergeRestoreList().then((r) => { const rs = r.rows || []; setRows(rs); setSel(new Set(rs.filter((x) => x.restorable).map((x) => x.id))); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory((r.rows || []).filter((h) => ['restored', 'recreated', 'skipped', 'failed'].includes(h.result) && /(restor|recreat)/i.test(h.reason || '') ))).catch(() => {});
    api.recycleBin().then((r) => setBin({ rows: r.rows || [], error: r.error || null })).catch((e) => setBin({ rows: [], error: e.message }));
    api.mergeRecreateList().then((r) => { const rs = r.rows || []; setRecRows(rs); setRecSel(new Set(rs.filter((x) => x.has_snapshot).map((x) => x.id))); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...sel];
  const selCount = sel.size;
  const safe = !status || status.safe_mode;
  const canExecute = !safe && mode === 'execute' && confirmText === 'RESTORE' && selCount > 0;

  const run = async (execute) => {
    if (!ids.length) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const q = await api.mergeRestore(ids, execute ? { mode: 'execute', confirm: confirmText } : { mode: 'simulate' });
      setConfirmText('');
      const finalRun = await awaitRun(api, 'restore', q.run_id);
      setResult(summarize(finalRun)); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const recToggle = (id) => setRecSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const recIds = [...recSel];
  const recCanExecute = !safe && recMode === 'execute' && recConfirm === 'RECREATE' && recIds.length > 0;
  const runRecreate = async (execute) => {
    if (!recIds.length) return;
    setRecBusy(true); setErr(''); setRecResult(null);
    try {
      const q = await api.mergeRecreate(recIds, execute ? { mode: 'execute', confirm: recConfirm } : { mode: 'simulate' });
      setRecConfirm('');
      const finalRun = await awaitRun(api, 'recreate', q.run_id);
      setRecResult(summarize(finalRun)); load();
    } catch (e) { setErr(e.message); }
    finally { setRecBusy(false); }
  };

  return (
    <div className="mtbl">
      <h2>Restore</h2>
      <p className="muted small">Undo a completed merge — bring losers back from the Recycle Bin, re-link their children, and reset the master. Best-effort, ~15-day window. Safe mode performs no Salesforce writes.</p>
      <DatasetStamp />
      <WorkerBanner />
      {err && <p className="err">{err}</p>}

      <div className="card" style={{ margin: '8px 0 12px', borderColor: safe ? 'var(--green)' : 'var(--red)', background: safe ? 'var(--green-bg)' : 'var(--red-bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: safe ? 'var(--green)' : 'var(--red)' }}>{safe ? 'Safe mode is ON — no Salesforce writes' : 'Execution ENABLED'}</strong>
        <span className="muted small">{safe ? 'Restore runs as a preview (eligibility + plan) only.' : 'A real restore may run behind the gates.'}</span>
        <span style={{ marginLeft: 'auto' }} className="muted small">Target environment: <strong>{status ? (status.environment || '—') : '…'}</strong></span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: '0 0 300px', minWidth: 0, margin: 0 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Run restore</p>
          <div className="seg" style={{ width: '100%', marginBottom: 8 }}>
            <button className={'seg-btn' + (mode === 'simulate' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setMode('simulate')}>Simulate</button>
            <button className={'seg-btn' + (mode === 'execute' ? ' on' : '')} style={{ flex: 1 }} disabled={safe} title={safe ? 'Execution disabled (safe mode)' : ''} onClick={() => setMode('execute')}>Execute</button>
          </div>
          {mode === 'execute' && !safe && (
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="type RESTORE to confirm" style={{ width: '100%', marginBottom: 8 }} />
          )}
          <button className="btn primary" style={{ width: '100%', marginTop: 0 }} disabled={busy || !canExecute} onClick={() => run(true)}>▷ Restore selected{safe ? ' (off)' : ''}</button>
          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy || selCount === 0} onClick={() => run(false)}>{busy ? 'Running…' : '👁 Simulate restore (' + selCount + ')'}</button>
          {result && (
            <p className="muted small" style={{ marginTop: 8, color: 'var(--accent)' }}>Run {result.run_id} ({result.mode}): {result.restored || 0} restored, {result.simulated || 0} simulated, {result.skipped} skipped, {result.failed} failed.</p>
          )}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 0, margin: 0, background: 'var(--card)' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>How restore works</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li><strong>Three steps.</strong> Undelete the losers from the Recycle Bin (original ids), re-point their children to their original parents (from the snapshot), and reset the master's overwritten fields (from the snapshot).</li>
            <li><strong>Best-effort, ~15-day window.</strong> Restore only works while the losers are still in the Recycle Bin — rows flagged <em>expired</em> can't be restored here. Downstream automation and external systems (e.g. Marketing Cloud) are not auto-undone.</li>
            <li><strong>Safe by default.</strong> Simulate previews eligibility and the plan with no writes; a real restore needs Execute mode, a typed <strong>RESTORE</strong>, and the deploy execution flag — then the set flips to <em>restored</em>.</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Completed merges <span className="muted small" style={{ fontWeight: 400 }}>({rows.length})</span></p>
        <div className="dt-scroll" style={{ maxHeight: 320 }}>
          <table className="modal-table">
            <thead><tr><th>Sel</th><th>#</th><th>Survivor</th><th>Account</th><th>Merged</th><th>Source</th><th>Env</th><th>Restorable</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} disabled={r.restorable === false} onChange={() => toggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td title={r.survivor_account}>{shortId(r.survivor_account)}</td>
                  <td>{r.loser_count}</td>
                  <td title={r.source_key}>{r.source_type === 'merge_id' ? 'merge id ' : 'group '}{shortId(r.source_key)}</td>
                  <td>{r.environment || '—'}</td>
                  <td title={r.reason}>
                    <span className="pill" style={{ color: r.restorable ? 'var(--green)' : (r.restorable === false ? 'var(--amber)' : 'var(--dim)') }}>
                      {r.restorable === true ? '✓ restorable' : r.restorable === false ? '✕ expired' : '— unknown'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="muted small">No completed merges to restore.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Recreate queue <span className="muted small" style={{ fontWeight: 400 }}>(not in Recycle Bin · {recRows.length})</span></p>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Secondary queue: sets whose losers are gone from the Recycle Bin (window expired or purged), routed here when a restore couldn’t use the bin. Recreate rebuilds the accounts from the pre-merge backup — the new records get <strong>new Salesforce ids</strong>, so external references (Marketing Cloud, data warehouse, etc.) won’t reconnect. User-initiated and gated like restore.
        </p>
        <div className="dt-scroll" style={{ maxHeight: 280 }}>
          <table className="modal-table">
            <thead><tr><th>Sel</th><th>#</th><th>Survivor</th><th>Account</th><th>Merged</th><th>Backup</th><th>Reason / considerations</th></tr></thead>
            <tbody>
              {recRows.map((r, i) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={recSel.has(r.id)} disabled={!r.has_snapshot} onChange={() => recToggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td title={r.survivor_account}>{shortId(r.survivor_account)}</td>
                  <td>{r.loser_count}</td>
                  <td><span className="pill" style={{ color: r.has_snapshot ? 'var(--green)' : 'var(--red)' }}>{r.has_snapshot ? '✓ ' + r.snapshot_losers + ' acct / ' + r.snapshot_children + ' child' : '✕ none'}</span></td>
                  <td title={r.reason} className="small">{r.reason}</td>
                </tr>
              ))}
              {recRows.length === 0 && <tr><td colSpan={7} className="muted small">Nothing here — a set lands in this queue only when a restore can’t use the Recycle Bin.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <div className="seg" style={{ minWidth: 200 }}>
            <button className={'seg-btn' + (recMode === 'simulate' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setRecMode('simulate')}>Simulate</button>
            <button className={'seg-btn' + (recMode === 'execute' ? ' on' : '')} style={{ flex: 1 }} disabled={safe} title={safe ? 'Execution disabled (safe mode)' : ''} onClick={() => setRecMode('execute')}>Execute</button>
          </div>
          {recMode === 'execute' && !safe && (
            <input value={recConfirm} onChange={(e) => setRecConfirm(e.target.value)} placeholder="type RECREATE to confirm" style={{ width: 200 }} />
          )}
          <button className="btn primary" disabled={recBusy || !recCanExecute} onClick={() => runRecreate(true)}>▷ Recreate selected{safe ? ' (off)' : ''}</button>
          <button className="btn" disabled={recBusy || recIds.length === 0} onClick={() => runRecreate(false)}>{recBusy ? 'Running…' : '👁 Simulate recreate (' + recIds.length + ')'}</button>
          {recResult && (
            <span className="muted small" style={{ color: 'var(--accent)' }}>Run {recResult.run_id} ({recResult.mode}): {recResult.recreated || 0} recreated, {recResult.simulated || 0} simulated, {recResult.skipped} skipped, {recResult.failed} failed.</span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Recycle Bin <span className="muted small" style={{ fontWeight: 400 }}>(recently deleted Accounts{bin ? ' · ' + bin.rows.length : ''})</span></p>
        <p className="muted small" style={{ margin: '0 0 8px' }}>Read-only view of soft-deleted Accounts in this org (~15-day window). “Merged into” is the surviving record a deleted account was merged into.</p>
        <div className="dt-scroll" style={{ maxHeight: 300 }}>
          <table className="modal-table">
            <thead><tr><th>#</th><th>Name</th><th>Member #</th><th>Account</th><th>Merged into</th><th>Deleted / modified</th></tr></thead>
            <tbody>
              {(bin ? bin.rows : []).map((r, i) => (
                <tr key={r.account}>
                  <td>{i + 1}</td>
                  <td>{r.name || '—'}</td>
                  <td>{r.member_number || '—'}</td>
                  <td title={r.account}>{shortId(r.account)}</td>
                  <td title={r.master_record_id}>{r.master_record_id ? shortId(r.master_record_id) : '—'}</td>
                  <td>{r.last_modified ? new Date(r.last_modified).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {bin && bin.error && <tr><td colSpan={6} className="small" style={{ color: 'var(--red)' }}>Could not read Recycle Bin: {bin.error}</td></tr>}
              {bin && !bin.error && bin.rows.length === 0 && <tr><td colSpan={6} className="muted small">Recycle Bin is empty — no deleted Accounts in the last ~15 days.</td></tr>}
              {!bin && <tr><td colSpan={6} className="muted small">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
