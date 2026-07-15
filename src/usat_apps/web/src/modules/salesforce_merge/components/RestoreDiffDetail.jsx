import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const val = (v) => (v == null || String(v).trim() === '' ? '—' : String(v));
const STATE = {
  match: { label: 'match', color: '#1a8a4f' },
  differ: { label: 'differs', color: '#854f0b' },
  missing: { label: 'missing', color: '#c0392b' },
};
const LOSER = {
  deleted: { label: 'in Recycle Bin (recoverable)', color: '#1a8a4f' },
  live: { label: 'already live', color: '#854f0b' },
  missing: { label: 'purged — not recoverable', color: '#c0392b' },
  unknown: { label: 'state unknown', color: 'var(--dim)' },
};

// Lazy restore diff for one completed merge: pre-merge snapshot vs current live Salesforce, field by
// field. Loaded on mount (only rendered when the row is expanded). The per-field "keep current"
// checkboxes drive SELECTIVE restore — checked fields are left at their live value instead of being
// reset to the snapshot; the selection is lifted to the Restore page via onKeepChange(id, fields[]).
export default function RestoreDiffDetail({ id, onKeepChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [diffOnly, setDiffOnly] = useState(true);
  const [kept, setKept] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    api.mergeRestoreDiff(id)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [id]);

  const toggleKeep = (field) => setKept((prev) => {
    const n = new Set(prev);
    if (n.has(field)) n.delete(field); else n.add(field);
    if (onKeepChange) onKeepChange(id, [...n]);
    return n;
  });

  if (err) return <div className="muted small" style={{ padding: '8px 12px', color: 'var(--red, #c0392b)' }}>Couldn’t load diff: {err}</div>;
  if (!data) return <div className="muted small" style={{ padding: '8px 12px' }}>Comparing to the pre-merge snapshot…</div>;
  if (data.error) return <div className="muted small" style={{ padding: '8px 12px' }}>{data.error}</div>;

  const s = data.survivor || { rows: [], summary: { matched: 0, differ: 0, missing: 0, total: 0 } };
  const sum = s.summary;
  const rowsAll = [...s.rows].sort((a, b) => {
    const rank = { differ: 0, missing: 1, match: 2 };
    return (rank[a.state] - rank[b.state]) || a.field.localeCompare(b.field);
  });
  const rows = diffOnly ? rowsAll.filter((r) => r.state !== 'match') : rowsAll;

  return (
    <div style={{ padding: '10px 12px', background: 'var(--card)' }}>
      {/* Headline: in sync vs drifted */}
      {data.in_sync ? (
        <p style={{ margin: '0 0 8px', color: 'var(--green, #1a8a4f)', fontWeight: 600 }}>
          ✓ The survivor already matches the pre-merge snapshot — a restore would change no fields.
        </p>
      ) : (
        <p style={{ margin: '0 0 8px', color: '#854f0b', fontWeight: 600 }}>
          ⚠ {sum.differ + sum.missing} of {sum.total} field{sum.total === 1 ? '' : 's'} differ from the snapshot — a restore would reset them to the pre-merge values.
        </p>
      )}
      {data.fetch_error && <p className="muted small" style={{ margin: '0 0 8px', color: 'var(--red, #c0392b)' }}>Live read issue: {data.fetch_error}</p>}

      {/* Loser recoverability */}
      {(data.losers || []).length > 0 && (
        <div style={{ margin: '0 0 8px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className="muted small">Losers:</span>
          {data.losers.map((l) => {
            const c = LOSER[l.state] || LOSER.unknown;
            return <span key={l.id} className="pill" title={l.id} style={{ fontSize: 11, color: c.color }}>{l.id.slice(-5)} · {c.label}</span>;
          })}
        </div>
      )}

      {/* Field-level before/after + selective keep */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px' }}>
        <span className="muted small">{sum.matched} match · {sum.differ} differ{sum.missing ? ' · ' + sum.missing + ' missing' : ''}{kept.size ? ' · keeping ' + kept.size + ' current' : ''}</span>
        <label className="muted small" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={diffOnly} onChange={() => setDiffOnly((v) => !v)} /> Differences only
        </label>
      </div>
      {sum.differ > 0 && <p className="muted small" style={{ margin: '0 0 6px' }}>Tick <strong>Keep current</strong> on any field you want to leave at its live value (e.g. a legitimate edit made after the merge) — everything else is reset to the snapshot.</p>}
      <div className="dt-scroll" style={{ maxHeight: 260 }}>
        <table className="modal-table">
          <thead><tr><th>Field</th><th>Pre-merge (snapshot)</th><th>Current (live)</th><th>State</th><th title="Keep the current live value instead of resetting to the snapshot">Keep current</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const c = STATE[r.state] || STATE.match;
              const canKeep = r.state === 'differ';
              const isKept = kept.has(r.field);
              return (
                <tr key={r.field} style={{ background: isKept ? 'rgba(26,138,79,.10)' : r.state === 'differ' ? 'rgba(180,120,0,.10)' : r.state === 'missing' ? 'rgba(192,57,43,.08)' : undefined }}>
                  <td>{r.field}</td>
                  <td title={val(r.before)} style={isKept ? { textDecoration: 'line-through', color: 'var(--dim)' } : undefined}>{val(r.before)}</td>
                  <td title={val(r.after)}>{val(r.after)}</td>
                  <td><span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 20, background: 'rgba(127,127,127,.12)', color: isKept ? '#1a8a4f' : c.color }}>{isKept ? 'keep live' : c.label}</span></td>
                  <td>{canKeep ? <input type="checkbox" checked={isKept} onChange={() => toggleKeep(r.field)} aria-label={'Keep current ' + r.field} /> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="muted small">{diffOnly ? 'No differing fields — everything matches the snapshot.' : 'No comparable fields in the snapshot.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
