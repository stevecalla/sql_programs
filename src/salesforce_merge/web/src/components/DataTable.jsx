import { useMemo, useState } from 'react';

// Shared table with built-in search + click-to-sort. The kit component every page (and, later,
// the other consolidated apps) reuses so the search+sort convention lives in one place.
// columns: [{ key, label }]   rows: array of plain objects.
export default function DataTable({ columns, rows }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    let r = !t ? rows : rows.filter((row) =>
      columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(t)));
    if (sort.key) {
      r = [...r].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * sort.dir;
      });
    }
    return r;
  }, [q, sort, rows, columns]);

  const toggle = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }));

  return (
    <div className="datatable">
      <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} onClick={() => toggle(c.key)}>
                {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (<td key={c.key}>{row[c.key]}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small">{view.length} rows</div>
    </div>
  );
}
