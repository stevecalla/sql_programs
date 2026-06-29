import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api } from '../lib/api.js';

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

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.mergeRestoreList().then((r) => { const rs = r.rows || []; setRows(rs); setSel(new Set(rs.filter((x) => x.restorable).map((x) => x.id))); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory((r.rows || []).filter((h) => ['restored', 'skipped', 'failed'].includes(h.result) && /restor/i.test(h.reason || '') ))).catch(() => {});
    api.recycleBin().then((r) => setBin({ rows: r.rows || [], error: r.error || null })).catch((e) => setBin({ rows: [], error: e.message }));
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
      const r = await api.mergeRestore(ids, execute ? { mode: 'execute', confirm: confirmText } : { mode: 'simulate' });
      setResult(r); setConfirmText(''); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mtbl">
      <h2>Restore</h2>
      <p className="muted small">Undo a completed merge — bring losers back from the Recycle Bin, re-link their children, and reset the master. Best-effort, ~15-day window. Safe mode performs no Salesforce writes.</p>
      <DatasetStamp />
      {err && <p className="err">{err}</p>}

      <div className="card" style={{ margin: '8px 0 12px', borderColor: safe ? 'var(--green)' : 'var(--red)', background: safe ? 'var(--green-bg)' : 'var(--red-bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: safe ? 'var(--green)' : 'var(--red)' }}>{safe ? 'Safe mode is ON — no Salesforce writes' : 'Execution ENABLED'}</strong>
        <span className="muted small">{safe ? 'Restore runs as a preview (eligibility + plan) only.' : 'A real restore may run behind the gates.'}</span>
        <span style={{ marginLeft: 'auto' }} className="muted small">Target environment: <strong>{status ? (status.environment || '—') : '…'}</strong></span>
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

      <div className="card" style={{ flex: '1 1 240px', minWidth: 0, marginTop: 12, maxWidth: 320 }}>
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

      <div className="card" style={{ marginTop: 12, background: 'rgba(127,127,127,.05)' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700 }}>How restore works</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li><strong>Three steps.</strong> Undelete the losers from the Recycle Bin (original ids), re-point their children to their original parents (from the snapshot), and reset the master's overwritten fields (from the snapshot).</li>
          <li><strong>Best-effort, ~15-day window.</strong> Restore only works while the losers are still in the Recycle Bin — rows flagged <em>expired</em> can't be restored here. Downstream automation and external systems (e.g. Marketing Cloud) are not auto-undone.</li>
          <li><strong>Safe by default.</strong> Simulate previews eligibility and the plan with no writes; a real restore needs Execute mode, a typed <strong>RESTORE</strong>, and the deploy execution flag — then the set flips to <em>restored</em>.</li>
        </ul>
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
