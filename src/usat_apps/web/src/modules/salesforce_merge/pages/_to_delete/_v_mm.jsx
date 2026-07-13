import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { metricsTestOn, setMetricsTest } from '../../../lib/track.js';
import ChartCard from '../components/ChartCard.jsx';
import AskData from '../components/AskData.jsx';

// Usage analytics dashboard — a React port of the email-queue metrics_dashboard.html: the same
// intentional layout (stat cards → ask → funnel → activity-by-day → 2x2 charts → recent users →
// visitors → top actors/errors), the same Chart.js chart cards, restyled for the merge app's data.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COL = { views: '#6b7686', merges: '#e4002b', restores: '#2e75b6', builds: '#e0a200' };

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

  const load = () => api.metricsReport(days).then((r) => { setRep(r.report); setErr(''); }).catch((e) => setErr(e.message));
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
    if (!window.confirm('Delete all test rows (Sandbox / ?metrics_test=1)?')) return;
    setPurgeMsg('Purging…');
    try { const r = await api.metricsPurgeTest(); setPurgeMsg('Purged ' + (r.deleted != null ? r.deleted : '') + ' test rows.'); load(); }
    catch (e) { setPurgeMsg(e.message); }
  };

  if (err) return (<><h2>Metrics</h2><p className="err">{err}</p></>);
  if (!rep) return (<><h2>Metrics</h2><p className="muted">Loading…</p></>);

  return (
    <>
      {/* header: title + last activity */}
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>📊 Metrics</h2>
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
        <button className="btn mx-purge" onClick={purge}>Purge test</button>
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
        <Card k="Merges" v={fmt(d.merge.execute_runs)} s={d.merge.success_pct + '% ok'} />
        <Card k="Sets merged" v={fmt(d.merge.sets_merged)} s={fmt(d.merge.accounts_merged) + ' accounts'} />
        <Card k="Preview runs" v={fmt(d.merge.simulate_runs)} s="simulate" />
        <Card k="Restores" v={fmt(d.restore_funnel[1] ? d.restore_funnel[1].n : 0)} s={fmt(d.restore_funnel[3] ? d.restore_funnel[3].n : 0) + ' recreated'} />
        <Card k="Queue adds" v={fmt(d.merge_funnel[0] ? d.merge_funnel[0].n : 0)} />
        <Card k="Exports" v={fmt(d.exports)} s={fmt(d.filters_run) + ' filters run'} />
        <Card k="Data builds" v={fmt(d.builds.runs)} s={fmt(d.builds.rows_built) + ' rows'} />
        <Card k="Actors" v={fmt(d.actors)} s="distinct staff" />
        <Card k="Test rows" v={fmt(d.health.test_rows)} s="is_test=1 (purgeable)" />
        <Card k="Row count DB" v={fmt(d.health.rows)} s={(d.health.mb != null ? d.health.mb + ' MB' : '')} />
      </div>

      {/* ask your data */}
      <div className="mx-panel">
        <h2>Ask your data <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— read-only AI</span></h2>
        <AskData />
      </div>

      {/* funnel */}
      <ChartCard id="chart_funnel" title="Funnel — queued → approved → simulated → executed → sets merged" theme={theme}
        labels={d.merge_funnel.map((s) => s.stage)} values={d.merge_funnel.map((s) => s.n)}
        headers={['Stage', 'Count']} rows={d.merge_funnel.map((s) => [s.stage, s.n])} />

      {/* activity by day */}
      <ChartCard id="chart_days" title="Activity by day — views · merges · restores · builds" type="multibar" theme={theme}
        labels={dayLabels}
        series={[
          { label: 'Views', color: COL.views, data: d.by_day.map((r) => r.views) },
          { label: 'Merges', color: COL.merges, data: d.by_day.map((r) => r.merges) },
          { label: 'Restores', color: COL.restores, data: d.by_day.map((r) => r.restores) },
          { label: 'Builds', color: COL.builds, data: d.by_day.map((r) => r.builds) },
        ]}
        headers={['Day', 'Views', 'Merges', 'Restores', 'Builds']}
        rows={d.by_day.map((r) => [r.day, r.views, r.merges, r.restores, r.builds])} />

      {/* 2x2 charts */}
      <div className="mx-grid2">
        <ChartCard id="chart_panel" title="Activity by panel" theme={theme}
          labels={d.by_panel.map((p) => p.panel)} values={d.by_panel.map((p) => p.events)}
          headers={['Panel', 'Events', 'Views', 'Filters', 'Exports']} rows={d.by_panel.map((p) => [p.panel, p.events, p.views, p.filters, p.exports])} />
        <ChartCard id="chart_env" title="By environment — merges" theme={theme} color="#2e75b6"
          labels={d.by_env.map((e) => (e.env === 'sandbox' ? 'Sandbox' : 'Production'))} values={d.by_env.map((e) => e.merges)}
          headers={['Environment', 'Merges', 'Restores', 'Events']} rows={d.by_env.map((e) => [e.env, e.merges, e.restores, e.events])} />
      </div>
      <div className="mx-grid2">
        <ChartCard id="chart_filters" title="Top filters" theme={theme} color="#e0a200"
          labels={d.top_filters.map((f) => f.filter)} values={d.top_filters.map((f) => f.n)}
          headers={['Filter', 'Count']} rows={d.top_filters.map((f) => [f.filter, f.n])} />
        <ChartCard id="chart_exports" title="Exports by view" theme={theme} color="#16a34a"
          labels={d.exports_by_view.map((x) => x.view + ' (' + x.format + ')')} values={d.exports_by_view.map((x) => x.n)}
          headers={['View', 'Format', 'Count']} rows={d.exports_by_view.map((x) => [x.view, x.format, x.n])} />
      </div>

      {/* most recent active users */}
      <div className="mx-panel">
        <h2>Most recent active users</h2>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Last active (MTN)</th><th>Events</th><th>Merges</th></tr></thead>
          <tbody>
            {d.recent_active_users.length === 0 && <tr><td className="dim" colSpan={5}>none</td></tr>}
            {d.recent_active_users.map((u, i) => (<tr key={u.actor + i}><td className="mx-rn">{i + 1}</td><td>{u.actor || '—'}</td><td>{u.last_seen || '—'}</td><td>{fmt(u.events)}</td><td>{fmt(u.merges)}</td></tr>))}
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

      {/* top actors + errors */}
      <div className="mx-grid2">
        <div className="mx-panel">
          <h2>Top actors (by merges)</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Merges</th><th>Restores</th><th>Exports</th><th>Last seen</th></tr></thead>
            <tbody>
              {d.top_operators.length === 0 && <tr><td className="dim" colSpan={6}>none</td></tr>}
              {d.top_operators.map((o, i) => (<tr key={o.actor + i}><td className="mx-rn">{i + 1}</td><td>{o.actor || '—'}</td><td>{fmt(o.merges)}</td><td>{fmt(o.restores)}</td><td>{fmt(o.exports)}</td><td>{o.last_seen || '—'}</td></tr>))}
            </tbody>
          </table>
        </div>
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
    </>
  );
}
