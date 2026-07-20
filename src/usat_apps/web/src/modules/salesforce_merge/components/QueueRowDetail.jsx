import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Expandable per-row detail for a merge-queue entry — shows the field OVERRIDES with their ACTUAL
// values (resolved by fetching the cluster on expand) plus the other context that clarifies what the
// set will do. The override map stores { field: accountId } ("take this record's value"); we look up
// the value from the cluster's accounts so the reader sees the real value, not just an id.
const shortId = (id) => { const s = String(id || ''); return s.length > 10 ? '…' + s.slice(-8) : (s || '—'); };
const isBlank = (v) => v == null || String(v).trim() === '';

export default function QueueRowDetail({ row }) {
  const [accts, setAccts] = useState(null); // {id: {field: value}} | null (not loaded) | 'error'
  const [ovSort, setOvSort] = useState({ key: 'field', dir: 1 });
  const ov = row && row.field_overrides && typeof row.field_overrides === 'object' && !Array.isArray(row.field_overrides) ? row.field_overrides : null;
  const ovEntries = ov ? Object.entries(ov).filter(([, v]) => !isBlank(v)) : [];

  // Fetch the cluster once (only when there ARE overrides to resolve) to turn account ids into values.
  useEffect(() => {
    let alive = true;
    if (!row || !ovEntries.length || !row.source_key) { setAccts(null); return undefined; }
    api.clusterDetail(row.source_key, row.source_type)
      .then((r) => { if (!alive) return; const m = {}; for (const a of (r.accounts || [])) m[a.account] = a; setAccts(m); })
      .catch(() => { if (alive) setAccts('error'); });
    return () => { alive = false; };
  }, [row && row.source_key, row && row.source_type, ovEntries.length]);

  if (!row) return null;
  const losers = String(row.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);
  const cc = row.child_counts && typeof row.child_counts === 'object' ? row.child_counts : null;
  const label = (a) => (String(a) === String(row.survivor_account) ? 'survivor' : 'a merging record');
  const resolvedValue = (field, acctId) => {
    if (accts && accts !== 'error' && accts[acctId]) { const v = accts[acctId][field]; return isBlank(v) ? '(blank)' : String(v); }
    return null; // not yet loaded / unavailable
  };

  const Line = ({ k, children }) => (
    <>
      <div className="muted" style={{ whiteSpace: 'nowrap' }}>{k}</div>
      <div style={{ minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
    </>
  );

  return (
    <div style={{ padding: '10px 14px', background: 'rgba(127,127,127,.06)', borderTop: '1px solid var(--line)', fontSize: 12.5, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Field overrides{' '}
        <span className="pill" style={{ background: ovEntries.length ? 'var(--amber-bg)' : 'transparent', color: ovEntries.length ? 'var(--amber)' : 'var(--dim)' }}>
          {ovEntries.length ? ovEntries.length + ' set' : 'none'}
        </span>
      </div>
      {ovEntries.length === 0 ? (
        <div style={{ color: 'var(--dim)', marginBottom: 10 }}>
          Default survivorship — the master keeps its own non-blank values, and blanks fill from a merging record. No fields were overridden.
        </div>
      ) : (() => {
        const rows = ovEntries.map(([field, acct]) => ({ field, acct, value: resolvedValue(field, acct), from: shortId(acct) + ' ' + label(acct) }));
        const dir = ovSort.dir;
        rows.sort((a, b) => { const av = String(a[ovSort.key] == null ? '' : a[ovSort.key]).toLowerCase(); const bv = String(b[ovSort.key] == null ? '' : b[ovSort.key]).toLowerCase(); return av < bv ? -dir : av > bv ? dir : 0; });
        const onSort = (k) => setOvSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }));
        const arrow = (k) => (ovSort.key === k ? (ovSort.dir === 1 ? ' ▲' : ' ▼') : '');
        const Th = ({ k, children, style }) => (
          <th onClick={() => onSort(k)} style={{ padding: '2px 10px 2px 0', fontWeight: 600, cursor: 'pointer', userSelect: 'none', ...style }} title="Sort">{children}{arrow(k)}</th>
        );
        return (
          <table className="modal-table" style={{ margin: '0 0 10px', borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '30%' }} /><col style={{ width: '46%' }} /><col style={{ width: '24%' }} /></colgroup>
            <thead><tr style={{ textAlign: 'left', color: 'var(--dim)' }}>
              <Th k="field">Field</Th>
              <Th k="value" style={{ padding: '2px 10px' }}>Value written to survivor</Th>
              <Th k="from" style={{ padding: '2px 0' }}>Taken from</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '3px 10px 3px 0', verticalAlign: 'top', wordBreak: 'break-word' }}><code>{r.field}</code></td>
                  <td style={{ padding: '3px 10px', verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {r.value == null ? <span className="muted">{accts === 'error' ? '(could not load value)' : 'loading…'}</span> : <strong>{r.value}</strong>}
                  </td>
                  <td style={{ padding: '3px 0', verticalAlign: 'top', wordBreak: 'break-word' }}><code title={String(r.acct)}>{shortId(r.acct)}</code> <span className="muted">({label(r.acct)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 14px', alignItems: 'baseline' }}>
        <Line k="Survivor (master)">{row.survivor_name || '—'} · <code title={row.survivor_account}>{row.survivor_account}</code></Line>
        <Line k={'Merging (' + losers.length + ')'}>{losers.length ? losers.map((l) => <code key={l} title={l} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>{l}</code>) : '—'}</Line>
        <Line k="Source">{row.source_type === 'merge_id' ? 'merge id' : 'group'} · <code title={row.source_key}>{shortId(row.source_key)}</code></Line>
        <Line k="Survivor rule">{row.master_rule || 'cascade'}</Line>
        <Line k="Environment">{row.environment || '—'}{row.org_id ? ' · org ' + shortId(row.org_id) : ''}</Line>
        <Line k="Child records">
          {cc && cc.total != null
            ? <>{cc.total}{cc.by && typeof cc.by === 'object' ? ' — ' + Object.entries(cc.by).map(([k, v]) => k + ': ' + v).join(', ') : ''}</>
            : <span className="muted">not retrieved on bulk select — re-fetched live at merge time and captured in the pre-merge snapshot (so children are re-pointed on merge and restorable)</span>}
        </Line>
        {row.status ? <Line k="Status">{row.status}</Line> : null}
        {row.created_by ? <Line k="Added by">{row.created_by}{row.created_at ? ' · ' + new Date(row.created_at).toLocaleString() : ''}</Line> : null}
        {row.notes ? <Line k="Notes">{row.notes}</Line> : null}
      </div>
    </div>
  );
}
