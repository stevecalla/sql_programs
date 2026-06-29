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
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.mergeQueue('approved').then((r) => { const rs = r.rows || []; setRows(rs); setSel(new Set(rs.map((x) => x.id))); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory(r.rows || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selCount = sel.size;
  const ids = [...sel];
  const estOps = rows.filter((r) => sel.has(r.id)).reduce((s, r) => s + Math.ceil((Number(r.loser_count) || 0) / 2), 0);
  const safe = !status || status.safe_mode;

  const runDryRun = async () => {
    if (!ids.length) return;
    setBusy(true); setErr(''); setResult(null);
    try { const r = await api.mergeProcess(ids, true); setResult(r); load(); }
    catch (e) { setErr(e.message); }
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
              {rows.length === 0 && <tr><td colSpan={8} className="muted small">No approved merges. Approve sets in Merge Admin first.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Run</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" style={{ width: 'auto' }} disabled={busy || selCount === 0} onClick={runDryRun}>{busy ? 'Running…' : 'Run dry-run (' + selCount + ')'}</button>
          <input placeholder="type MERGE" disabled style={{ opacity: 0.6, width: 140 }} />
          <button className="btn primary" style={{ width: 'auto' }} disabled title="Execution is locked (safe mode / Phase 3)">Execute merges</button>
          <span className="muted small">Gates: execution flag · sandbox · pre-merge snapshot · typed confirm{safe ? ' — all blocked in safe mode' : ''}</span>
        </div>
        {result && (
          <p className="muted small" style={{ marginTop: 8, color: 'var(--accent)' }}>Run {result.run_id}: {result.simulated} simulated, {result.skipped} skipped, {result.failed} failed{result.safe_mode ? ' (safe mode — no writes)' : ''}.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Merge history <span className="muted small" style={{ fontWeight: 400 }}>({history.length})</span></p>
        <div className="dt-scroll" style={{ maxHeight: 300 }}>
          <table className="modal-table">
            <thead><tr><th>When</th><th>Survivor</th><th>Merged</th><th>Children</th><th>Env</th><th>Result</th><th>Snapshot</th><th>Reason</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
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
