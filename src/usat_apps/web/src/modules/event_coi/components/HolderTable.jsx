// HolderTable.jsx — editable grid of certificate holders (one row = one certificate to submit).
// Reuses the platform `table.grid` styles; the search box, per-column sort, and per-column filters are
// COI-specific. Sorting/filtering only change the VIEW — edits and removes always map back to the real
// index in the underlying holders array, so nothing is lost when the list is reordered or filtered.
import { useMemo, useState } from 'react';

// maxLen matches the portal form's field maxlength attributes (see RECON_portal_form_map.md).
const COLS = [
  { key: 'name', label: 'Holder Name', req: true, w: 170, maxLen: 100 },
  { key: 'address', label: 'Address', w: 160, maxLen: 100 },
  { key: 'city', label: 'City', w: 110, maxLen: 50 },
  { key: 'state', label: 'State', w: 60, maxLen: 2 },
  { key: 'zip', label: 'Zip', w: 74, maxLen: 7 },
  { key: 'email', label: 'Holder Email', req: true, w: 180, maxLen: 100 },
];

const val = (h, k) => String(h[k] == null ? '' : h[k]);

export default function HolderTable({ holders, onChange, onRemove }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }));
  const clearView = () => { setQ(''); setFilters({}); setSort({ key: null, dir: 1 }); };
  const anyView = q.trim() || sort.key || Object.values(filters).some((v) => v && v.trim());

  // Keep the real index alongside each row so edits/removes stay correct under sort + filter.
  const view = useMemo(() => {
    let rows = holders.map((h, realIdx) => ({ h, realIdx }));
    const qq = q.trim().toLowerCase();
    if (qq) rows = rows.filter(({ h }) => COLS.some((c) => val(h, c.key).toLowerCase().includes(qq)));
    for (const c of COLS) {
      const fv = (filters[c.key] || '').trim().toLowerCase();
      if (fv) rows = rows.filter(({ h }) => val(h, c.key).toLowerCase().includes(fv));
    }
    if (sort.key) {
      rows = [...rows].sort((a, b) => val(a.h, sort.key).localeCompare(val(b.h, sort.key), undefined, { numeric: true, sensitivity: 'base' }) * sort.dir);
    }
    return rows;
  }, [holders, q, filters, sort]);

  if (!holders.length) {
    return <p className="muted">No holders yet — upload a file or use “Fill test values”.</p>;
  }

  return (
    <>
      <div className="coi-search">
        <input className="coi-input" placeholder="Search all holders…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">Showing {view.length} of {holders.length}</span>
        {anyView ? <button className="btn" onClick={clearView}>Clear</button> : null}
      </div>

      <div className="coi-tablewrap">
        <table className="grid coi-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              {COLS.map((c) => (
                <th key={c.key} style={{ minWidth: c.w }}>
                  <button className="coi-th-btn" onClick={() => toggleSort(c.key)} title={`Sort by ${c.label}`}>
                    {c.label}{c.req && <span className="coi-req"> *</span>}
                    <span className="coi-sortarrow">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
                  </button>
                  <input
                    className="coi-filter"
                    placeholder="filter"
                    value={filters[c.key] || ''}
                    onChange={(e) => setFilter(c.key, e.target.value)}
                  />
                </th>
              ))}
              <th style={{ width: 34 }} aria-label="remove" />
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={COLS.length + 2} className="coi-empty">No holders match the current search/filters.</td></tr>
            ) : view.map(({ h, realIdx }) => (
              <tr key={realIdx}>
                <td className="coi-rownum">{realIdx + 1}</td>
                {COLS.map((c) => (
                  <td key={c.key}>
                    <input
                      className={'coi-input' + (c.req && !val(h, c.key).trim() ? ' coi-input-warn' : '')}
                      maxLength={c.maxLen || undefined}
                      value={val(h, c.key)}
                      onChange={(e) => onChange(realIdx, c.key, c.maxLen ? e.target.value.slice(0, c.maxLen) : e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button className="coi-x" title="Remove holder" onClick={() => onRemove(realIdx)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
