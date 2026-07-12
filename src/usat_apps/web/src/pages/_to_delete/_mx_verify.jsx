import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { metricsTestOn, setMetricsTest } from '../lib/track.js';
import ChartCard, { TablePanel } from '../components/ChartCard.jsx';
import AskData from '../components/AskData.jsx';

// Usage-analytics dashboard for the usat_apps platform — the full charted view ported from the
// reporting app (header + last-activity, period buttons, stat cards, Ask, activity-by-day, 2x2 chart
// grid, 404/403 cards, recent users, visitors, top actors) on usat_apps_events data. New vs reporting:
// a SCOPE tab row (platform roll-up across all panels vs one module) that scopes the whole report via
// the /api/metrics-report?panel= filter, plus the platform-only Not-found (404) / Access-denied (403)
// cards. The "Participation maps" nav entry deep-links straight to that scope (path-based default).
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const COL = { views: '#082240', filters: '#e0a200', exports: '#16a34a' };
const SCOPES = [
  { key: 'all', label: 'All panels' },
  { key: 'participation-maps', label: 'Participation maps' },
  { key: 'merge', label: 'Salesforce merge' },
];

function Card({ k, v, s }) {
  return <div className="mx-card"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s || ''}</div></div>;
}

export default function Metrics({ user }) {
  const location = useLocation();
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState(/participation-maps/.test(location.pathname) ? 'participation-maps' : 'all');
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(false);
  const [showTest, setShowTest] = useState(true);   // default ON — show everything incl. test rows
  const [purgeMsg, setPurgeMsg] = useState('');
  const [theme, setTheme] = useState('');
  const [mtestOn, setMtestOn] = useState(metricsTestOn());
  const isAdmin = !!(user && user.role === 'admin');
  const panelParam = scope === 'all' ? null : scope;

  const load = () => api.metricsReport(days, panelParam, showTest).then((r) => {
    if (r.status === 200 && r.body.ok) { setRep(r.body.report); setErr(''); }
    else { setErr((r.body && r.body.error) || ('HTTP ' + r.status)); }
  });
  const toggleMtest = () => { const next = !mtestOn; setMetricsTest(next); setMtestOn(next); load(); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days, scope, showTest]);
  useEffect(() => { if (!auto) return; const id = setInterval(load, 60000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [auto, days, scope, showTest]);
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

  const scopeTabs = (
    <div className="mx-scope">
      <span className="mx-scope-label">Scope</span>
      <div className="mx-tabs">
        {SCOPES.map((sc) => <button key={sc.key} className={scope === sc.key ? 'on' : ''} onClick={() => setScope(sc.key)}>{sc.label}</button>)}
        <button className="soon" disabled title="module not live yet">Event analysis · soon</button>
      </div>
      <span className="mx-scope-hint">{scope === 'all' ? 'Platform roll-up across every panel.' : 'Scoped to the ' + scope + ' panel.'}</span>
    </div>
  );

  if (err) return (<div className="page"><h2>Usage metrics</h2>{scopeTabs}<p className="err">{err}</p></div>);
  if (!rep) return (<div className="page"><h2>Usage metrics</h2>{scopeTabs}<p className="muted">Loading…</p></div>);

  return (
    <div className="page">
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>📊 Usage metrics</h2>
        <span className="mx-last" style={{ marginLeft: 'auto' }}>
          <span className="mx-last-label">Last user activity</span>
          <span className="mx-last-val">{d.health.latest_mtn || '—'}</span>
        </span>
      </div>

      {scopeTabs}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 16px' }}>
        <div className="mx-periods">
          {[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([n, lbl]) => (
            <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>{lbl}</button>
          ))}
        </div>
        <button className="btn" onClick={load}>↻ Refresh</button>
        <label className="mx-auto"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        <label className="mx-auto" title="Include is_test=1 rows in every card/table so you can review flagged test activity before purging."><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Include test rows</label>
        {isAdmin && <button className="btn mx-purge" onClick={purge}>Purge test</button>}
        {purgeMsg && <span className="muted small">{purgeMsg}</span>}
        {isAdmin && (
          <label className="mx-auto" style={{ marginLeft: 'auto' }} title="Turns on ?metrics_test=1 for ALL your activity so it is flagged is_test and kept out of the real figures.">
            <input type="checkbox" checked={mtestOn} onChange={toggleMtest} /> Flag my activity as test (?metrics_test=1)
          </label>
        )}
      </div>

      <div className="mx-cards">
        <Card k="Visits" v={fmt(d.panel_views)} s={fmt(d.unique_users) + ' users · ' + fmt(d.unique_users - d.repeat_users) + ' new / ' + fmt(d.repeat_users) + ' return'} />
        <Card k="Sessions" v={fmt(d.sessions)} s="page-load" />
        <Card k="Unique users" v={fmt(d.unique_users)} s={fmt(d.repeat_users) + ' returning'} />
        <Card k="Filters run" v={fmt(d.filters_run)} s="filter + search" />
        <Card k="Exports" v={fmt(d.exports)} s="csv / xlsx" />
        <Card k="Actors" v={fmt(d.actors)} s="distinct staff" />
        <Card k="Test rows" v={fmt(d.health.test_rows)} s="is_test=1 (purgeable)" />
        <Card k="Row count DB" v={fmt(d.health.rows)} s={(d.health.mb != null ? d.health.mb + ' MB' : '')} />
      </div>

      <div className="mx-panel">
        <h2>Ask your data <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— read-only AI</span></h2>
        <AskData />
      </div>

      <ChartCard id="chart_days" title="Activity by day — views · filters · exports" type="multibar" theme={theme}
        labels={dayLabels}
        series={[
          { label: 'Views', color: COL.views, data: d.by_day.map((r) => r.views) },
          { label: 'Filters', color: COL.filters, data: d.by_day.map((r) => r.filters) },
          { label: 'Exports', color: COL.exports, data: d.by_day.map((r) => r.exports) },
        ]}
        headers={['Day', 'Views', 'Filters', 'Exports']}
        rows={d.by_day.map((r) => [r.day, r.views, r.filters, r.exports])} />

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
        <TablePanel id="tbl_errors" title="Errors" headers={['Error', 'Count']} rows={d.errors.map((e) => [e.type, e.n])}>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Error</th><th>Count</th></tr></thead>
            <tbody>
              {d.errors.length === 0 && <tr><td className="dim" colSpan={3}>none</td></tr>}
              {d.errors.map((e, i) => (<tr key={e.type + i}><td className="mx-rn">{i + 1}</td><td>{e.type}</td><td>{fmt(e.n)}</td></tr>))}
            </tbody>
          </table>
        </TablePanel>
      </div>

      <TablePanel id="tbl_by_view" title="Count by view" subtitle="— map styles, tabs, reports" headers={['View', 'Count']} rows={(d.by_view || []).map((v) => [v.view, v.n])}>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>View</th><th>Count</th></tr></thead>
          <tbody>
            {(!d.by_view || d.by_view.length === 0) && <tr><td className="dim" colSpan={3}>none</td></tr>}
            {(d.by_view || []).map((v, i) => (<tr key={v.view + i}><td className="mx-rn">{i + 1}</td><td>{v.view}</td><td>{fmt(v.n)}</td></tr>))}
          </tbody>
        </table>
      </TablePanel>

      {/* platform-only: broken links + access denials (not in the reporting dashboard) */}
      <div className="mx-grid2">
        <TablePanel id="tbl_404" title={<>Not found (404) — top paths <span className="mx-tag warn">{fmt(d.not_found)}</span></>} headers={['Path', 'Hits']} rows={(d.top_not_found || []).map((x) => [x.path, x.n])}>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Path</th><th>Hits</th></tr></thead>
            <tbody>
              {(!d.top_not_found || d.top_not_found.length === 0) && <tr><td className="dim" colSpan={3}>none</td></tr>}
              {(d.top_not_found || []).map((x, i) => (<tr key={x.path + i}><td className="mx-rn">{i + 1}</td><td className="mono">{x.path}</td><td>{fmt(x.n)}</td></tr>))}
            </tbody>
          </table>
        </TablePanel>
        <TablePanel id="tbl_403" title={<>Access denied (403) <span className="mx-tag warn">{fmt(d.not_authorized)}</span></>} headers={['Panel', 'Actor', 'Hits']} rows={(d.access_denied || []).map((x) => [x.panel, x.actor, x.n])}>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Panel</th><th>Actor</th><th>Hits</th></tr></thead>
            <tbody>
              {(!d.access_denied || d.access_denied.length === 0) && <tr><td className="dim" colSpan={4}>none</td></tr>}
              {(d.access_denied || []).map((x, i) => (<tr key={x.panel + x.actor + i}><td className="mx-rn">{i + 1}</td><td>{x.panel}</td><td>{x.actor}</td><td>{fmt(x.n)}</td></tr>))}
            </tbody>
          </table>
        </TablePanel>
      </div>

      <TablePanel id="tbl_recent" title="Most recent active users" headers={['Actor', 'Last active', 'Events', 'Exports']} rows={d.recent_active_users.map((u) => [u.actor || '—', u.last_seen || '—', u.events, u.exports])}>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Last active</th><th>Events</th><th>Exports</th></tr></thead>
          <tbody>
            {d.recent_active_users.length === 0 && <tr><td className="dim" colSpan={5}>none</td></tr>}
            {d.recent_active_users.map((u, i) => (<tr key={u.actor + i}><td className="mx-rn">{i + 1}</td><td>{u.actor || '—'}</td><td>{u.last_seen || '—'}</td><td>{fmt(u.events)}</td><td>{fmt(u.exports)}</td></tr>))}
          </tbody>
        </table>
      </TablePanel>

      <TablePanel id="tbl_visitors" title={<>Visitors <span className="mx-tag">anonymous</span> — with location (timezone)</>} headers={['Visitor', 'Actor', 'Visits', 'Events', 'Location (tz)', 'Device', 'Last activity', 'Type']} rows={d.visitors.map((v) => [v.id, v.actor || '—', v.visits, v.events, v.tz || '—', v.device, v.last_seen || '—', v.returning ? 'returning' : 'new'])}>
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
      </TablePanel>

      <TablePanel id="tbl_actors" title="Top actors (by events)" headers={['Actor', 'Events', 'Filters', 'Exports', 'Last seen']} rows={d.top_operators.map((o) => [o.actor || '—', o.events, o.filters, o.exports, o.last_seen || '—'])}>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Events</th><th>Filters</th><th>Exports</th><th>Last seen</th></tr></thead>
          <tbody>
            {d.top_operators.length === 0 && <tr><td className="dim" colSpan={6}>none</td></tr>}
            {d.top_operators.map((o, i) => (<tr key={o.actor + i}><td className="mx-rn">{i + 1}</td><td>{o.actor || '—'}</td><td>{fmt(o.events)}</td><td>{fmt(o.filters)}</td><td>{fmt(o.exports)}</td><td>{o.last_seen || '—'}</td></tr>))}
          </tbody>
        </table>
      </TablePanel>
    </div>
  );
}
