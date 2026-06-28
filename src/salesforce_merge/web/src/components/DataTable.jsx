import { useEffect, useMemo, useState } from 'react';
import { exportUrl } from '../lib/api.js';

// Small inline "copy to clipboard" button for ID-ish cells.
function CopyButton({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copy-btn" title="Copy" aria-label="Copy"
      onClick={(e) => {
        e.stopPropagation();
        if (navigator.clipboard) navigator.clipboard.writeText(String(value));
        setDone(true); setTimeout(() => setDone(false), 900);
      }}>{done ? '✓' : '⧉'}</button>
  );
}

// Shared table. Two modes:
//   client: pass `rows` (filters/sorts in memory).
//   server: pass `fetcher({ q, sort, dir, page, page_size, colFilters }) -> { rows, total }`.
// columns: [{ key, label, render?(row), sort?, filter?, wrap? }] — sort/filter are server keys (true = use key).
//   filter: true renders a per-column control in the header (a dropdown if `facets[key]` exists, else a text box).
//   wrap: true lets long cells wrap; every cell gets a title tooltip with its full value.
// `facets` maps column key -> distinct values (for the dropdowns). `searchCols` labels what search scans.
export default function DataTable({ columns, fetcher, rows, pageSize = 25, toolbar, deps = [], searchCols, facets = {}, exportBase, exportExtra = {}, minWidth, maxHeight, initialQuery = '', rowNumbers = true }) {
  const server = typeof fetcher === 'function';
  const [q, setQ] = useState(initialQuery || '');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [colFilters, setColFilters] = useState({});
  const [showFilters, setShowFilters] = useState(true);
  const [data, setData] = useState({ rows: rows || [], total: (rows || []).length });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const filterable = columns.filter((c) => c.filter);
  const colFiltersKey = JSON.stringify(colFilters);

  useEffect(() => {
    if (!loading) return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!server) return undefined;   // client mode reads the `rows` prop directly (see `view`)
    let cancelled = false;
    setLoading(true); setErr('');
    fetcher({ q, sort: sortKey || undefined, dir: sortDir, page, page_size: pageSize, colFilters })
      .then((d) => { if (!cancelled) setData({ rows: d.rows || [], total: d.total || 0 }); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, q, sortKey, sortDir, page, pageSize, colFiltersKey, ...deps]);

  const view = useMemo(() => {
    if (server) return data.rows;
    let r = rows || [];
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(t)));
    for (const [k, v] of Object.entries(colFilters)) {
      const t2 = String(v).trim().toLowerCase();
      if (t2) r = r.filter((row) => String(row[k] ?? '').toLowerCase().includes(t2));
    }
    if (sortKey) r = [...r].sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x === y) return 0; return (x > y ? 1 : -1) * (sortDir === 'asc' ? 1 : -1); });
    return r;
  }, [server, data.rows, rows, q, sortKey, sortDir, colFiltersKey, columns]);

  const total = Number(server ? data.total : view.length) || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // If a search/filter/chip shrinks the result below the current page, snap back into range
  // (otherwise Prev/Next can land on an empty page and look broken).
  useEffect(() => { if (page > pages) setPage(pages); }, [pages, page]);
  const activeFilters = Object.values(colFilters).filter((v) => v && String(v).trim()).length;

  const sort_key_of = (col) => (col.sort === true ? col.key : col.sort);
  const toggle = (col) => {
    const key = sort_key_of(col);
    if (!key) return;
    setPage(1);
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const mark = (col) => { const key = sort_key_of(col); return key && sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''; };
  const setFilter = (key, val) => { setPage(1); setColFilters((f) => ({ ...f, [key]: val })); };
  const doExport = (format) => {
    const url = exportUrl(exportBase, { q, sort: sortKey || undefined, dir: sortDir, colFilters, ...exportExtra, format });
    window.open(url, '_blank');
  };

  const placeholder = 'Search ' + (searchCols ? searchCols : 'all columns') + '…';

  return (
    <div className="datatable">
      <div className="dt-toolbar">
        <span className="search-wrap">
          <input className="search" placeholder={placeholder} title={placeholder} value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
          {q && (
            <button type="button" className="search-clear" aria-label="Clear search" title="Clear search"
              onClick={() => { setPage(1); setQ(''); }}>×</button>
          )}
        </span>
        {filterable.length > 0 && (
          <button type="button" className={'btn dt-filter-btn' + (showFilters || activeFilters ? ' on' : '')}
            onClick={() => setShowFilters((s) => !s)}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        )}
        {activeFilters > 0 && (
          <button type="button" className="btn" onClick={() => { setPage(1); setColFilters({}); }}>Clear filters</button>
        )}
        {toolbar}
        {exportBase && (
          <span className="dt-export">
            <button type="button" className="btn" title="Download all matching rows as CSV" onClick={() => doExport('csv')}>⬇ CSV</button>
            <button type="button" className="btn" title="Download all matching rows as Excel" onClick={() => doExport('xlsx')}>⬇ Excel</button>
          </span>
        )}
        <span className="dt-count muted small">
          {loading
            ? <span className="dt-loading"><span className="spinner" aria-hidden="true" /> Searching… {elapsed.toFixed(1)}s</span>
            : `${Number(total).toLocaleString()} rows`}
          {!loading && server ? ` · page ${page} / ${pages}` : ''}
        </span>
      </div>

      {err && <p className="err">{err}</p>}
      <div className="dt-scroll" style={maxHeight ? { maxHeight } : undefined}>
      <table style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>{rowNumbers && <th className="dt-rownum">#</th>}{columns.map((col) => (
            <th key={col.key} onClick={() => toggle(col)} title={col.help || undefined}
              style={{ cursor: sort_key_of(col) ? 'pointer' : 'default' }}>
              {col.label}{col.help ? <span className="th-info" aria-hidden="true"> ⓘ</span> : ''}{mark(col)}
            </th>
          ))}</tr>
          {showFilters && filterable.length > 0 && (
            <tr className="dt-filter-row">
              {rowNumbers && <th className="dt-rownum" />}
              {columns.map((col) => (
                <th key={col.key}>
                  {col.filter ? (
                    facets[col.key] && facets[col.key].length ? (
                      <select value={colFilters[col.key] || ''} onChange={(e) => setFilter(col.key, e.target.value)}>
                        <option value="">All</option>
                        {facets[col.key].map((v) => (<option key={v} value={v}>{v}</option>))}
                      </select>
                    ) : (
                      <input value={colFilters[col.key] || ''} placeholder="contains…" onChange={(e) => setFilter(col.key, e.target.value)} />
                    )
                  ) : null}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {loading && server ? (
            Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              <tr key={'skel' + i}>
                {rowNumbers && <td className="dt-rownum"><span className="skel" style={{ height: 12, width: 14 }} /></td>}
                {columns.map((col) => (
                  <td key={col.key}><span className="skel" style={{ height: 12, width: '70%' }} /></td>
                ))}
              </tr>
            ))
          ) : (
            view.map((row, i) => (
              <tr key={i}>{rowNumbers && <td className="dt-rownum">{(server ? (page - 1) * pageSize : 0) + i + 1}</td>}{columns.map((col) => (
                <td key={col.key} className={col.wrap ? 'dt-wrap' : undefined} title={String(row[col.key] ?? '')}>
                  {col.render ? col.render(row) : row[col.key]}
                  {col.copy && row[col.key] != null && row[col.key] !== '' ? <CopyButton value={row[col.key]} /> : null}
                </td>
              ))}</tr>
            ))
          )}
          {!loading && view.length === 0 && (
            <tr><td colSpan={columns.length + (rowNumbers ? 1 : 0)} className="muted">No rows.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <div className="dt-footer">
        <span className="muted small">{loading ? 'Loading…' : `${Number(total).toLocaleString()} rows`}</span>
        {server && (
          <span className="pager">
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
            <span className="muted small">Page {page} / {pages}</span>
            <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next ›</button>
          </span>
        )}
      </div>
    </div>
  );
}
