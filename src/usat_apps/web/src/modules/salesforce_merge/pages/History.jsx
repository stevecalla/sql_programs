import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api, exportUrl } from '../lib/api.js';

// Merge / restore history lookup — a filterable, read-only view of the immutable audit
// (salesforce_merge_history). Search by survivor name / account / source key, filter by result, and
// expand any row to see the field-level diff (merge drift, or restore/recreate reset + kept).
const RESULT_COLOR = {
  done: '#1a8a4f', restored: '#1a8a4f', recreated: '#1a8a4f', simulated: '#3a6ea5',
  skipped: '#854f0b', failed: '#c0392b',
};
const RESULTS = ['', 'done', 'restored', 'recreated', 'simulated', 'skipped', 'failed'];
const copyCell = { userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

// Client-side column sort (same hook the Process/Restore tables use) over the loaded rows.
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

function DiffDetail({ diff }) {
  if (!diff || typeof diff !== 'object') return <p className="muted small" style={{ padding: '6px 10px', margin: 0 }}>No field-level detail for this row.</p>;
  if (diff.kind === 'merge_drift') {
    const fields = diff.fields || [];
    return (
      <table className="modal-table" style={{ margin: '6px 10px' }}>
        <thead><tr><th>Account</th><th>Field changed since staging</th><th>Staged</th><th>At merge</th></tr></thead>
        <tbody>{fields.map((f, i) => (
          <tr key={i}><td style={copyCell}>{f.account}</td><td>{f.field}</td><td>{String(f.before ?? '') || '—'}</td><td style={{ color: 'var(--amber)' }}>{String(f.after ?? '') || '—'}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  // restore / recreate: reset + kept
  const reset = diff.reset || []; const kept = diff.kept || [];
  return (
    <div style={{ padding: '6px 10px' }}>
      {reset.length > 0 && (
        <table className="modal-table" style={{ marginBottom: kept.length ? 8 : 0 }}>
          <thead><tr><th>Field reset to pre-merge value</th><th>Value</th></tr></thead>
          <tbody>{reset.map((r, i) => (<tr key={i}><td>{r.field}</td><td style={copyCell}>{String(r.value ?? '') || '—'}</td></tr>))}</tbody>
        </table>
      )}
      {kept.length > 0 && <p className="small" style={{ margin: 0 }}>Kept current (not reset): <strong>{kept.join(', ')}</strong></p>}
      {reset.length === 0 && kept.length === 0 && <p className="muted small" style={{ margin: 0 }}>No fields changed.</p>}
    </div>
  );
}

export default function History() {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sort = useSort();

  const load = useCallback(() => {
    setBusy(true); setErr('');
    api.mergeHistoryQuery({ result: result || undefined, q: q || undefined, limit })
      .then((r) => setRows(r.rows || []))
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, [result, q, limit]);
  useEffect(() => { load(); }, [result, limit]);   // eslint-disable-line react-hooks/exhaustive-deps

  const when = (r) => r.created_at_mtn || r.created_at || '';
  const exportParams = { result: result || undefined, q: q || undefined, limit: 5000 };

  return (
    <div className="mtbl">
      <h2>History</h2>
      <p className="muted small">Every processed set, every run — merges, restores, recreates, and simulations. Immutable audit; expand a row for the field-level diff.</p>
      <DatasetStamp />
      {err && <p className="err">{err}</p>}

      <div className="card" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted small">Result</span>
          <select className="tb-select" style={{ width: 130 }} value={result} onChange={(e) => setResult(e.target.value)}>
            {RESULTS.map((r) => <option key={r} value={r}>{r === '' ? 'All' : r}</option>)}
          </select>
          <input className="search" style={{ width: 260 }} placeholder="Search name, account id, or source…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          <button className="btn" style={{ width: 'auto' }} onClick={load} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          <span className="muted small">Show</span>
          <select className="tb-select" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="pill">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          <span className="dl-group" style={{ marginLeft: 'auto' }}>
            <span className="muted small">Export</span>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { ...exportParams, format: 'csv' })}>CSV</a>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { ...exportParams, format: 'xlsx' })}>Excel</a>
          </span>
        </div>
        <div className="dt-scroll" style={{ maxHeight: '68vh' }}>
          <table className="modal-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ width: 30 }} />
              <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => sort.onSort('created_at_mtn')}>When (MT){sort.arrow('created_at_mtn')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_name')}>Survivor{sort.arrow('survivor_name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_account')}>Account{sort.arrow('survivor_account')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('result')}>Result{sort.arrow('result')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('mode')}>Mode{sort.arrow('mode')}</th>
              <th>Reason</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('environment')}>Env{sort.arrow('environment')}</th>
            </tr></thead>
            <tbody>
              {sort.apply(rows).map((r) => [
                <tr key={r.id}>
                  <td><button type="button" onClick={() => toggle(r.id)} title="Show field-level diff" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{open.has(r.id) ? '▾' : '▸'}</button></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r)}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td><span style={copyCell} title="Click to select · triple-click to copy">{r.survivor_account || '—'}</span></td>
                  <td><span className="pill" style={{ color: RESULT_COLOR[r.result] || 'var(--dim)' }}>{r.result}</span></td>
                  <td>{r.mode}</td>
                  <td className="small" title={r.reason}>{r.reason}</td>
                  <td>{r.environment || '—'}</td>
                </tr>,
                open.has(r.id) ? <tr key={r.id + '_d'}><td colSpan={8} style={{ padding: 0, background: 'var(--card)' }}><DiffDetail diff={r.diff} /></td></tr> : null,
              ])}
              {rows.length === 0 && !busy && <tr><td colSpan={8} className="muted small">No history rows match — adjust the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
