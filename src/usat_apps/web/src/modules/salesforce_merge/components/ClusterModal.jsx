import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Phase 2 cluster detail: deep record view (live Salesforce, snapshot fallback) + a dry-run merge
// preview (pick a survivor, see what a merge would keep/fill/conflict). Read-only — nothing changes.
const STATUS = {
  kept: { label: 'kept', color: '#1a8a4f' },
  filled: { label: 'filled from other', color: '#185fa5' },
  conflict: { label: 'conflict', color: '#854f0b' },
  empty: { label: '—', color: 'var(--dim)' },
};
const val = (v) => (v == null || v === '' ? '—' : String(v));

export default function ClusterModal({ clusterKey, onClose }) {
  const [detail, setDetail] = useState(null);   // { source, fields, accounts }
  const [survivor, setSurvivor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!clusterKey) return undefined;
    setDetail(null); setPreview(null); setSurvivor(null); setErr('');
    let cancelled = false;
    api.clusterDetail(clusterKey)
      .then((r) => { if (cancelled) return; setDetail(r); if (r.accounts && r.accounts[0]) setSurvivor(r.accounts[0].account); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [clusterKey]);

  useEffect(() => {
    if (!clusterKey || !survivor) return undefined;
    let cancelled = false;
    api.clusterPreview(clusterKey, survivor).then((r) => { if (!cancelled) setPreview(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [clusterKey, survivor]);

  if (!clusterKey) return null;
  const accounts = (detail && detail.accounts) || [];
  const fields = (detail && detail.fields) || [];

  return (
    <Modal title={`Cluster ${clusterKey}`} onClose={onClose}>
      {err && <p className="err">{err}</p>}
      {!detail ? (
        <p className="muted">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="muted">No accounts found for this group.</p>
      ) : (
        <>
          <p className="muted small">
            Detail source: <strong>{detail.source === 'salesforce' ? 'live Salesforce' : 'local snapshot'}</strong>.
            Pick the surviving record to preview a merge — <strong>dry run, nothing is changed</strong> (merging is Phase 3).
          </p>

          <div className="dt-scroll" style={{ maxHeight: 240 }}>
            <table className="modal-table">
              <thead>
                <tr><th>Keep</th><th>Account</th>{fields.map((f) => <th key={f}>{f}</th>)}</tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.account}>
                    <td><input type="radio" name="survivor" checked={survivor === a.account} onChange={() => setSurvivor(a.account)} aria-label={'Keep ' + a.account} /></td>
                    <td>{a.account}</td>
                    {fields.map((f) => <td key={f} title={val(a[f])}>{val(a[f])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview && (
            <>
              <p className="muted small" style={{ marginTop: 14 }}>
                Merge preview — survivor <code>{preview.survivor}</code> ·
                {' '}{preview.counts.kept} kept · {preview.counts.filled} filled ·
                {' '}<span style={{ color: STATUS.conflict.color }}>{preview.counts.conflict} conflict</span>
              </p>
              <table className="modal-table">
                <thead><tr><th>Field</th><th>Survivor</th><th>Result after merge</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.fields.map((row) => (
                    <tr key={row.field}>
                      <td>{row.field}</td>
                      <td title={val(row.survivor)}>{val(row.survivor)}</td>
                      <td title={val(row.chosen)}>{val(row.chosen)}</td>
                      <td style={{ color: (STATUS[row.status] || STATUS.empty).color }}>{(STATUS[row.status] || STATUS.empty).label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 8 }}>
                Read-only preview of how Salesforce would merge these records (survivor keeps its value;
                blanks fill from the others; differing values are flagged). No merge is performed.
              </p>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
