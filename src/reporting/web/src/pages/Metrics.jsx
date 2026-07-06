import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Usage metrics over /api/metrics-report (reporting_events table). Compact; mirrors the merge metrics
// page's purpose. Charts can be added later — this shows the counts directly.
export default function Metrics() {
  const [rep, setRep] = useState(undefined);
  const [days, setDays] = useState(7);
  useEffect(() => { api.metricsReport(days).then((r) => setRep(r.status === 200 ? r.body.report : null)); }, [days]);

  if (rep === undefined) return <div className="loading">Loading metrics…</div>;
  if (!rep) return <div className="card">No metrics yet (nothing logged in this window).</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Usage metrics</h2>
        <label className="muted small">Window&nbsp;
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <div className="card">
        <h3>By event</h3>
        <table className="grid">
          <thead><tr><th>Event</th><th>Count</th></tr></thead>
          <tbody>{(rep.byEvent || []).map((r) => <tr key={r.event_name}><td>{r.event_name}</td><td>{r.n}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card">
        <h3>By day</h3>
        <table className="grid">
          <thead><tr><th>Day</th><th>Count</th></tr></thead>
          <tbody>{(rep.byDay || []).map((r) => <tr key={String(r.day)}><td>{String(r.day).slice(0, 10)}</td><td>{r.n}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
