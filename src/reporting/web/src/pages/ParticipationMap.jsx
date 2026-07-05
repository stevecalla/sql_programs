import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { api } from '../lib/api.js';
import { headlineKPIs } from '../lib/compute.js';

// Native React participation map: a Plotly USA-states choropleth driven by Year + Metric selectors,
// plus headline KPIs — all from the live /api/bootstrap payload. First native view; pins / YoY /
// flows / matrices / tables are added as further native components (see PHASE_PLAN.md, task 47).
export default function ParticipationMap() {
  const [st, setSt] = useState({ loading: true });
  const [year, setYear] = useState(null);
  const [metricIdx, setMetricIdx] = useState(0);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status, body } = await api.bootstrap();
      if (status === 200 && body.ok) {
        const p = body.data;
        const years = Object.keys(p.byYear || {}).sort();
        setSt({ loading: false, p, source: body.source });
        setYear(years[years.length - 1]);
      } else {
        setSt({ loading: false, error: body.error || ('HTTP ' + status), code: body.code });
      }
    })();
  }, []);

  useEffect(() => {
    if (st.loading || st.error || !year || !mapRef.current) return;
    const p = st.p;
    const yb = p.byYear[year];
    const m = yb.metrics[metricIdx] || yb.metrics[0];
    const z = m.statez;
    const locations = p.abbr;
    const text = locations.map((ab, i) => (p.names[i] || ab) + ': ' + (z[i] != null ? Number(z[i]).toLocaleString() : '—'));
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    Plotly.react(mapRef.current, [{
      type: 'choropleth', locationmode: 'USA-states', locations, z, text,
      hovertemplate: '%{text}<extra></extra>',
      colorscale: [[0, dark ? '#0b1220' : '#eef2ff'], [1, '#082240']],
      marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
      colorbar: { title: { text: m.label }, thickness: 12 },
    }], {
      geo: { scope: 'usa', bgcolor: 'rgba(0,0,0,0)', lakecolor: 'rgba(0,0,0,0)' },
      margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', height: 560,
    }, { displayModeBar: false, responsive: true });
  }, [st, year, metricIdx]);

  const kpis = useMemo(() => (st.p && year ? headlineKPIs(st.p, year) : null), [st, year]);

  if (st.loading) return <div className="loading">Loading participation data…</div>;
  if (st.error) {
    return (
      <div className="card">
        <h2>Participation maps</h2>
        <p className="err">Couldn’t load data: {st.error}</p>
        {st.code === 'NO_DATA'
          ? <p className="muted">Seed the fixture or wire MySQL: <code>node src/reporting/store/make_fixture.js &lt;standalone-html&gt;</code></p>
          : null}
      </div>
    );
  }

  const p = st.p;
  const years = Object.keys(p.byYear).sort();
  const metrics = p.byYear[year].metrics;
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

  return (
    <div className="page">
      <div className="page-head">
        <h2>Participation maps</h2>
        <span className="muted small">{p.abbr.length} states · {metrics.length} metrics</span>
      </div>

      {kpis ? (
        <div className="kpis">
          <Kpi v={fmt(kpis.participants)} l={`Participants (${year})`} />
          <Kpi v={fmt(kpis.unique)} l="Unique athletes" />
          <Kpi v={kpis.homePct == null ? '—' : kpis.homePct + '%'} l="Home (in-state)" />
          <Kpi v={fmt(kpis.away)} l="Traveled away" />
        </div>
      ) : null}

      <div className="toolbar">
        <label>Year&nbsp;
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Metric&nbsp;
          <select value={metricIdx} onChange={(e) => setMetricIdx(Number(e.target.value))}>
            {metrics.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
          </select>
        </label>
      </div>

      <div className="card"><div ref={mapRef} className="mapdiv" /></div>
      <p className="muted small">More views (pins · YoY · flows · region &amp; state matrices · events) are being ported to native components next.</p>
    </div>
  );
}

function Kpi({ v, l }) {
  return <div className="kpi"><div className="v">{v}</div><div className="l">{l}</div></div>;
}
