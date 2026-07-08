import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Usage metrics — lightweight skeleton view. Pulls the same /api/metrics-report contract the reporting
// app uses and shows the headline counts + per-panel table. (The full charted dashboard from the
// reporting app can be ported here later; this proves the platform metrics stack end to end.)
export default function Metrics() {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(7);

  useEffect(() => {
    let live = true;
    api.metricsReport(days).then((r) => {
      if (!live) return;
      if (r.status === 200 && r.body.ok) setRep(r.body.report); else setErr(r.body.error || ('HTTP ' + r.status));
    }).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [days]);

  if (err) return <div className="page"><h2>Usage metrics</h2><p className="err">{err}</p></div>;
  if (!rep) return <div className="page"><h2>Usage metrics</h2><p className="muted">Loading…</p></div>;

  const d = rep.data || {};
  const kpi = (label, val) => (
    <div className="card" style={{ textAlign: 'center', minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{val}</div>
      <div className="muted small">{label}</div>
    </div>
  );

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2>Usage metrics</h2>
        <label className="small">Window&nbsp;
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        {kpi('Panel views', d.panel_views || 0)}
        {kpi('Unique users', d.unique_users || 0)}
        {kpi('Filters run', d.filters_run || 0)}
        {kpi('Exports', d.exports || 0)}
      </div>

      <div className="card">
        <h3>By panel</h3>
        <table className="grid">
          <thead><tr><th>Panel</th><th>Views</th><th>Filters</th><th>Exports</th><th>Events</th></tr></thead>
          <tbody>
            {(d.by_panel || []).length === 0 ? <tr><td className="muted" colSpan={5}>No activity yet.</td></tr>
              : d.by_panel.map((r) => (
                <tr key={r.panel}><td>{r.panel}</td><td>{r.views}</td><td>{r.filters}</td><td>{r.exports}</td><td>{r.events}</td></tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Health: {d.health ? (d.health.rows + ' rows · ' + d.health.test_rows + ' test rows') : '—'}. Rows are stamped
        app=<code>usat_apps</code> in <code>usat_apps_events</code>.
      </p>
    </div>
  );
}
