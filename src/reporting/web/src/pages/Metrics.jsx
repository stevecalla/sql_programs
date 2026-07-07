import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { metricsTestOn, setMetricsTest } from '../lib/track.js';
import ChartCard from '../components/ChartCard.jsx';
import AskData from '../components/AskData.jsx';

// Usage analytics dashboard for the reporting app — a port of the merge Metrics page (same layout:
// header + last-activity, period buttons, stat cards, Ask, activity-by-day, 2x2 chart grid, recent
// users, visitors, top actors, errors) restyled onto reporting_events data. Every api call uses
// reporting's { status, body } envelope (api.js never throws) rather than merge's throw/catch.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const COL = { views: '#082240', filters: '#e0a200', exports: '#16a34a' };

function Card({ k, v, s }) {
  return <div className="mx-card"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s || ''}</div></div>;
}

export default function Metrics({ user }) {
  const [days, setDays] = useState(7);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState('');
  const [theme, setTheme] = useState('');
  const [mtestOn, setMtestOn] = useState(metricsTestOn());
  const isAdmin = !!(user && user.role === 'admin');

  const load = () => api.metricsReport(days).then((r) => {
    if (r.status === 200 && r.body.ok) { setRep(r.body.report); setErr(''); }
    else { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); }
  });
  const toggleMtest = () => { const next = !mtestOn; setMetricsTest(next); setMtestOn(next); load(); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);
  useEffect(() => { if (!auto) return; const id = setInterval(load, 60000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [auto, days]);
  // Recolor charts when the app theme toggles.
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    read(); const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const d = rep && rep.data;
  const dayLabels = useMemo(() => (d ? d.by_day.map((r) => r.day) : []), [d]);

  const purge = async () => {
    if (!window.confirm('Delete all test rows (?metrics_test=1)?')) return;
    setPurgeMsg('Purging…');
    const r = await api.metricsPurgeTest();
    if (r.status === 200 && r.body.ok) { setPurgeMsg('Purged ' + (r.body.deleted != null ? r.body.deleted : '') + ' test rows.'); load(); }
    else { setPurgeMsg((r.body && r.body.error) || ('HTTP ' + r.status)); }
  };

  if (err) return (<><h2>Metrics</h2><p className="err">{err}</p></>);
  if (!rep) return (<><h2>Metrics</h2><p className="muted">Loading…</p></>);

  return (
    <div className="page">
      {/* header: title + last activity */}
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>📊 Usage metrics</h2>
        <span className="mx-last" style={{ marginLeft: 'auto' }}>
          <span className="mx-last-label">Last user activity</span>
          <span className="mx-last-val">{d.health.latest_mtn || '—'}</span>
        </span>
      </div>

      {/* period + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="mx-periods">
          {[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([n, lbl]) => (
            <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>{lbl}</button>
          ))}
        </div>
        <button className="btn" onClick={load}>↻ Refresh</button>
        <label className="mx-auto"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        {isAdmin && <button className="btn mx-purge" onClick={purge}>Purge test</button>}
        {purgeMsg && <span className="muted small">{purgeMsg}</span>}
        {isAdmin && (
          <label className="mx-auto" style={{ marginLeft: 'auto' }} title="Turns on ?metrics_test=1 for ALL your activity so it is flagged is_test and kept out of the real figures. The metrics_test parameter is the only thing that sets is_test.">
            <input type="checkbox" checked={mtestOn} onChange={toggleMtest} /> Flag my activity as test (?metrics_test=1)
          </label>
        )}
      </div>

      {/* stat cards */}
      <div className="mx-cards">
        <Card k="Visits" v={fmt(d.panel_views)} s={fmt(d.unique_users) + ' users · ' + fmt(d.unique_users - d.repeat_users) + ' new / ' + fmt(d.repeat_users) + ' return'} />
        <Card k="Unique users" v={fmt(d.unique_users)} s={fmt(d.repeat_users) + ' returning'} />
        <Card k="Filters run" v={fmt(d.filters_run)} s="filter + search" />
        <Card k="Exports" v={fmt(d.exports)} s="csv / xlsx" />
        <Card k="Actors" v={fmt(d.actors)} s="distinct staff" />
        <Card k="Test rows" v={fmt(d.health.test_rows)} s="is_test=1 (purgeable)" />
        <Card k="Row count DB" v={fmt(d.health.rows)} s={(d.health.mb != null ? d.health.mb + ' MB' : '')} />
      </div>

      {/* ask your data */}
      <div className="mx-panel">
        <h2>Ask your data <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— read-only AI</span></h2>
        <AskData />
      </div>

      {/* activity by day */}
      <ChartCard id="chart_days" title="Activity by day — views · filters · exports" type="multibar" theme={theme}
        labels={dayLabels}
        series={[
          { label: 'Views', color: COL.views, data: d.by_day.map((r) => r.views) },
          { label: 'Filters', color: COL.filters, data: d.by_day.map((r) => r.filters) },
          { label: 'Exports', color: COL.exports, data: d.by_day.map((r) => r.exports) },
        ]}
        headers={['Day', 'Views', 'Filters', 'Exports']}
        rows={d.by_day.map((r) => [r.day, r.views, r.filters, r.exports])} />

      {/* 2x2 charts */}
      <div className="mx-grid2">
        <ChartCard id="chart_panel" title="Activity by panel" theme={theme}
          labels={d.by_panel.map((p) => p.panel)} values={d.by_panel.map((p) => p.events)}
          headers={['Panel', 'Events', 'Views', 'Filters', 'Exports']} rows={d.by_panel.map((p) => [p.panel, p.events, p.views, p.filters, p.exports])} />
        <ChartCard id="chart_filters" title="Top filters" theme={theme} color="#e0a200"
          labels={d.top_filters.map((f) => f.filter)} values={d.top_filters.map((f) => f.n)}
          headers={['Filter', 'Count']} rows={d.top_filters.map((f) => [f.filter, f.n])} />
      </div>
      <div className="mx-grid2">
        <ChartCard id="chart_exports" title="Exports by view" theme={theme} color="#16a34a"
          labels={d.exports_by_view.map((x) => x.view + ' (' + x.format + ')')} values={d.exports_by_view.map((x) => x.n)}
          headers={['View', 'Format', 'Count']} rows={d.exports_by_view.map((x) => [x.view, x.format, x.n])} />
        <div className="mx-panel">
          <h2>Errors</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Error</th><th>Count</th></tr></thead>
            <tbody>
              {d.errors.length === 0 && <tr><td className="dim" colSpan={3}>none</td></tr>}
              {d.errors.map((e, i) => (<tr key={e.type + i}><td className="mx-rn">{i + 1}</td><td>{e.type}</td><td>{fmt(e.n)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>

      {/* most recent active users */}
      <div className="mx-panel">
        <h2>Most recent active users</h2>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Last active</th><th>Events</th><th>Exports</th></tr></thead>
          <tbody>
            {d.recent_active_users.length === 0 && <tr><td className="dim" colSpan={5}>none</td></tr>}
            {d.recent_active_users.map((u, i) => (<tr key={u.actor + i}><td className="mx-rn">{i + 1}</td><td>{u.actor || '—'}</td><td>{u.last_seen || '—'}</td><td>{fmt(u.events)}</td><td>{fmt(u.exports)}</td></tr>))}
          </tbody>
        </table>
      </div>

      {/* visitors */}
      <div className="mx-panel">
        <h2>Visitors <span className="mx-tag">anonymous</span> — with location (timezone)</h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Visitor</th><th>Actor</th><th>Visits</th><th>Events</th><th>Location (tz)</th><th>Device</th><th>Last activity</th><th>Type</th></tr></thead>
            <tbody>
              {d.visitors.length === 0 && <tr><td className="dim" colSpan={9}>none</td></tr>}
              {d.visitors.map((v, i) => (
                <tr key={v.id}><td className="mx-rn">{i + 1}</td><td className="mono">{v.id.slice(0, 18)}</td><td>{v.actor || '—'}</td><td>{fmt(v.visits)}</td><td>{fmt(v.events)}</td><td>{v.tz || '—'}</td><td>{v.device}</td><td>{v.last_seen || '—'}</td><td><span className={'mx-tag' + (v.returning ? '' : ' new')}>{v.returning ? 'returning' : 'new'}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* top actors */}
      <div className="mx-panel">
        <h2>Top actors (by events)</h2>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Events</th><th>Filters</th><th>Exports</th><th>Last seen</th></tr></thead>
          <tbody>
            {d.top_operators.length === 0 && <tr><td className="dim" colSpan={6}>none</td></tr>}
            {d.top_operators.map((o, i) => (<tr key={o.actor + i}><td className="mx-rn">{i + 1}</td><td>{o.actor || '—'}</td><td>{fmt(o.events)}</td><td>{fmt(o.filters)}</td><td>{fmt(o.exports)}</td><td>{o.last_seen || '—'}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
