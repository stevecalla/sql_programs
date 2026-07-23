// HolderTable.jsx — editable grid of certificate holders (one row = one certificate to submit).
// Columns come from lib/coverage (identity + Step-2-ordered per-holder coverage). The # and Holder Name
// columns are frozen (sticky-left) so you can scroll right through the coverage columns with the holder
// still visible. Search, per-column sort, and per-column filters operate on each column's DISPLAY value
// (Yes/'' for checkboxes, the label for dropdowns), and only change the VIEW — edits/removes always map
// back to the real index in the underlying holders array.
//
// showCoverage=false ("apply the same options to all"): the per-holder coverage columns are shown but
// READ-ONLY and greyed, reflecting the shared Step 2 selections (sharedOptions) — so you can see what
// every certificate will get. showCoverage=true (per-holder): those columns are editable per row.
import { useMemo, useState } from 'react';
import { HOLDER_COLUMNS, COVERAGE_KEYS, cellDisplay } from '../lib/coverage.js';

const COLS = HOLDER_COLUMNS;
const COVSET = new Set(COVERAGE_KEYS);

export default function HolderTable({ holders, onChange, onRemove, showCoverage, sharedOptions }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }));
  const clearView = () => { setQ(''); setFilters({}); setSort({ key: null, dir: 1 }); };
  const anyView = q.trim() || sort.key || Object.values(filters).some((v) => v && v.trim());
  const colByKey = (k) => COLS.find((c) => c.key === k);
  const roCov = (c) => !showCoverage && COVSET.has(c.key);   // read-only coverage column (all-mode)
  // Display/search value: coverage columns in all-mode show the shared Step 2 value; else the holder's own.
  const disp = (h, c) => cellDisplay(roCov(c) ? (sharedOptions || {}) : h, c);

  // Keep the real index alongside each row so edits/removes stay correct under sort + filter.
  const view = useMemo(() => {
    let rows = holders.map((h, realIdx) => ({ h, realIdx }));
    const qq = q.trim().toLowerCase();
    if (qq) rows = rows.filter(({ h }) => COLS.some((c) => disp(h, c).toLowerCase().includes(qq)));
    for (const c of COLS) {
      const fv = (filters[c.key] || '').trim().toLowerCase();
      if (fv) rows = rows.filter(({ h }) => disp(h, c).toLowerCase().includes(fv));
    }
    if (sort.key) {
      const c = colByKey(sort.key);
      rows = [...rows].sort((a, b) => disp(a.h, c).localeCompare(disp(b.h, c), undefined, { numeric: true, sensitivity: 'base' }) * sort.dir);
    }
    return rows;
  }, [holders, q, filters, sort, showCoverage, sharedOptions]);

  if (!holders.length) {
    return <p className="muted">No holders yet — drop a file above, upload one, or add a row.</p>;
  }

  const editor = (h, realIdx, c) => {
    // All-mode: coverage columns are read-only and show the shared Step 2 selection.
    if (roCov(c)) return <span className="coi-cell-ro" title="Set in Step 2 — applies to all holders">{disp(h, c) || '—'}</span>;
    if (c.type === 'check') {
      return <input type="checkbox" className="coi-cellcheck" checked={!!h[c.key]} onChange={(e) => onChange(realIdx, c.key, e.target.checked)} />;
    }
    if (c.type === 'select') {
      return (
        <select className="coi-input coi-cellselect" value={h[c.key] || ''} onChange={(e) => onChange(realIdx, c.key, e.target.value)}>
          {c.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      );
    }
    const raw = String(h[c.key] == null ? '' : h[c.key]);
    return (
      <input
        className={'coi-input' + (c.req && !raw.trim() ? ' coi-input-warn' : '')}
        maxLength={c.maxLen || undefined}
        value={raw}
        onChange={(e) => onChange(realIdx, c.key, c.maxLen ? e.target.value.slice(0, c.maxLen) : e.target.value)}
      />
    );
  };

  return (
    <>
      <div className="coi-search">
        <input className="coi-input" placeholder="Search all holders…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">Showing {view.length} of {holders.length}</span>
        {anyView ? <button className="btn" onClick={clearView}>Clear</button> : null}
        <span className="muted small coi-scrollnote">
          {showCoverage ? '← Name is frozen · scroll right for coverage →' : 'Coverage columns show your Step 2 selections (read-only) · switch to per-holder to edit'}
        </span>
      </div>

      <div className="coi-tablewrap">
        <table className="grid coi-table">
          <thead>
            <tr>
              <th className="coi-frz-num" style={{ width: 40 }}>#</th>
              {COLS.map((c, i) => (
                <th key={c.key} className={(i === 0 ? 'coi-frz-name' : '') + (roCov(c) ? ' coi-th-ro' : '')} style={{ minWidth: c.w }}>
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
                <td className="coi-rownum coi-frz-num">{realIdx + 1}</td>
                {COLS.map((c, i) => (
                  <td key={c.key} className={(i === 0 ? 'coi-frz-name' : '') + (c.type === 'check' ? ' coi-cell-check' : '') + (roCov(c) ? ' coi-cell-roc' : '')}>
                    {editor(h, realIdx, c)}
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
