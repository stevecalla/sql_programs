const val = (v) => (v == null || String(v).trim() === '' ? '—' : String(v));
const shortId = (id) => (id && id.length > 8 ? '…' + id.slice(-5) : id || '');

// Merge drift detail — the fields that changed between staging and now, for one set. Data is already
// on the run result (drift_detail: [{ account, field, before, after }]), so this is a synchronous
// render (no fetch). Mirrors the restore diff's before/after table for visual consistency.
export default function MergeDriftDetail({ detail = [], account }) {
  const rows = [...detail].sort((a, b) => a.field.localeCompare(b.field));
  return (
    <div style={{ padding: '10px 12px', background: 'var(--card)' }}>
      <p style={{ margin: '0 0 6px', color: '#854f0b', fontWeight: 600 }}>
        ⚠ {rows.length} identity field{rows.length === 1 ? '' : 's'} changed since you staged this set — a merge would proceed on the current (live) values.
      </p>
      <div className="dt-scroll" style={{ maxHeight: 220 }}>
        <table className="modal-table">
          <thead><tr><th>Field</th><th>Staged (when queued)</th><th>Live (now)</th>{rows.some((r) => r.account && r.account !== account) ? <th>Record</th> : null}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.field + i} style={{ background: 'rgba(180,120,0,.10)' }}>
                <td>{r.field}</td>
                <td title={val(r.before)}>{val(r.before)}</td>
                <td title={val(r.after)}>{val(r.after)}</td>
                {rows.some((x) => x.account && x.account !== account) ? <td title={r.account}>{shortId(r.account)}</td> : null}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="muted small">No field-level detail captured.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
