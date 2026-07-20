import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api, exportUrl } from '../lib/api.js';
import { track } from '../../../lib/track.js';

// Merge / restore history lookup — a filterable, read-only view of the immutable audit
// (salesforce_merge_history). Search by survivor name / account / source key, filter by result, and
// expand any row to see the field-level diff (merge drift, or restore/recreate reset + kept).
const RESULT_COLOR = {
  done: '#1a8a4f', restored: '#1a8a4f', recreated: '#1a8a4f', simulated: '#3a6ea5',
  skipped: '#854f0b', failed: '#c0392b',
};
const RESULTS = ['', 'done', 'restored', 'recreated', 'simulated', 'skipped', 'failed'];
const copyCell = { userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

// Explains the ContentDocumentLink message some restore rows carry (a Salesforce quirk, not a tool bug).
const FILE_SHARE_HELP = 'Salesforce file shares (ContentDocumentLink) can’t be re-parented with a field '
  + 'update — they are insert/delete only. On restore/recreate the tool ADDITIVELY re-links them: it '
  + 'creates a new share on the loser and KEEPS the survivor’s, so a file is never unshared or lost. '
  + 'Shares captured before this feature (no ContentDocumentId recorded) can’t be recreated automatically '
  + 'and are left on the survivor — run repair_file_shares.js to re-link those. This message is expected, not an error.';
const isFileShareNote = (reason) => /ContentDocumentLink/i.test(String(reason || ''));

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

function DiffDetail({ diff, row }) {
  if (!diff || typeof diff !== 'object') {
    const res = row && row.result;
    const why = (res === 'done' || res === 'simulated')
      ? 'No field-level diff for this merge. This row records drift — fields that changed between when the set was queued and when it processed — and there was none, so nothing changed to show. (The survivorship plan actually written to the survivor is shown live on Process Merges; it isn’t stored here.)'
      : (res === 'restored' || res === 'recreated')
        ? 'No field-level changes for this restore — no survivor fields needed resetting (and none were kept), so there is nothing to diff.'
        : (res === 'skipped' || res === 'failed')
          ? ('No field-level changes were made (this set was ' + res + ' — see the Reason column for why).')
          : 'No field-level changes were recorded for this row.';
    return <p className="muted small" style={{ padding: '6px 10px', margin: 0 }}>{why}</p>;
  }
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
  const runCounts = {};
  rows.forEach((r) => { if (r.run_id) runCounts[r.run_id] = (runCounts[r.run_id] || 0) + 1; });
  const perMerge = (r) => (r.api_cost != null && runCounts[r.run_id]) ? Math.round(Number(r.api_cost) / runCounts[r.run_id]) : null;
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
          <button className="btn" style={{ width: 'auto' }} onClick={() => { track('history_refresh', { panel: 'merge', view: 'history' }); load(); }} disabled={busy} title="Reload the latest history">{busy ? '…' : '↻ Refresh'}</button>
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
              <th style={{ width: 40, textAlign: 'right' }}>#</th>
              <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => sort.onSort('created_at_mtn')}>When (MT){sort.arrow('created_at_mtn')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_name')}>Survivor{sort.arrow('survivor_name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_account')}>Account{sort.arrow('survivor_account')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('result')}>Result{sort.arrow('result')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('mode')}>Mode{sort.arrow('mode')}</th>
              <th style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => sort.onSort('api_cost')}>API{sort.arrow('api_cost')}</th>
              <th style={{ textAlign: 'right' }} title="Run total ÷ sets in the run">≈/merge</th>
              <th style={{ cursor: 'pointer', textAlign: 'right' }} title="Async Apex recorded for this run (approximate — rollups fire after the merge, so it can read low)" onClick={() => sort.onSort('apex_cost')}>Apex{sort.arrow('apex_cost')}</th>
              <th>Reason</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('environment')}>Env{sort.arrow('environment')}</th>
              <th>Dossier</th>
            </tr></thead>
            <tbody>
              {sort.apply(rows).map((r, i) => [
                <tr key={r.id}>
                  <td><button type="button" onClick={() => toggle(r.id)} title="Show field-level diff" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{open.has(r.id) ? '▾' : '▸'}</button></td>
                  <td style={{ textAlign: 'right', color: 'var(--dim)' }}>{i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r)}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td><span style={copyCell} title="Click to select · triple-click to copy">{r.survivor_account || '—'}</span></td>
                  <td><span className="pill" style={{ color: RESULT_COLOR[r.result] || 'var(--dim)' }}>{r.result}</span></td>
                  <td>{r.mode}</td>
                  <td style={{ textAlign: 'right' }}>{r.api_cost != null ? Number(r.api_cost).toLocaleString() : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--dim)' }}>{perMerge(r) != null ? '≈' + perMerge(r).toLocaleString() : '—'}</td>
                  <td style={{ textAlign: 'right' }} title="Async Apex recorded for this run. Rollups fire AFTER the merge commits (deferred), so this reads 0 until the settle re-read lands (~90s) — a dash means 'not yet / deferred', not zero cost.">{r.apex_cost != null && Number(r.apex_cost) > 0 ? Number(r.apex_cost).toLocaleString() : '—'}</td>
                  <td className="small" title={r.reason}>
                    {r.reason}
                    {isFileShareNote(r.reason) && (
                      <span title={FILE_SHARE_HELP} style={{ marginLeft: 4, cursor: 'help', color: 'var(--dim)', borderBottom: '1px dotted var(--dim)' }}>ⓘ file share</span>
                    )}
                  </td>
                  <td>{r.environment || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.dossier_id
                      ? <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/dossier/' + r.dossier_id + '/download', {})} title={'Download the merge dossier (.xlsx)' + (r.dossier_doc_id ? ' · Salesforce File ' + r.dossier_doc_id : '')}>📎 dossier</a>
                      : <span className="muted small">—</span>}
                  </td>
                </tr>,
                open.has(r.id) ? <tr key={r.id + '_d'}><td colSpan={13} style={{ padding: 0, background: 'var(--card)' }}><DiffDetail diff={r.diff} row={r} /></td></tr> : null,
              ])}
              {rows.length === 0 && !busy && <tr><td colSpan={13} className="muted small">No history rows match — adjust the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
