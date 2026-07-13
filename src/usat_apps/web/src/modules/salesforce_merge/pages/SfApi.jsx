import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// SF API usage (Phases 1-4). On open it shows the LAST CAPTURED reading (cheap DB read — NO Salesforce
// call); Refresh is the only live call, and it records a fresh snapshot for the next viewer. Sandbox /
// Production tabs pick the org. Beyond the headroom gauge it shows an intraday trend, a per-activity
// attribution table, a PRE-FLIGHT estimate (cost to run the approved queue vs remaining budget, with a
// warning if it would exceed), and RECENT RUNS with their measured API cost.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
function band(pct) { return pct == null ? '#6b7686' : pct >= 85 ? '#e4002b' : pct >= 60 ? '#e0a200' : '#16a34a'; }
const ENVS = [['production', 'Production'], ['sandbox', 'Sandbox']];
const dim = { fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 };

function Sparkline({ points }) {
  const vals = points.map((p) => Number(p.api_used)).filter((n) => Number.isFinite(n));
  if (vals.length < 2) return <p className="muted small">Not enough readings yet for a trend — refresh across the day to build it.</p>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = (max - min) || 1;
  const W = 600;
  const H = 60;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 6) - 3;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60 }} aria-label="API usage trend">
      <polyline points={pts} fill="none" stroke="#2e75b6" strokeWidth="2" />
    </svg>
  );
}

export default function SfApi() {
  const [env, setEnv] = useState('production');
  const [byEnv, setByEnv] = useState({});          // { [env]: { usage, live, err } }
  const [loading, setLoading] = useState(false);   // cached load (DB, no SF call)
  const [refreshing, setRefreshing] = useState(false); // live SF call

  const loadCached = (e) => {
    setLoading(true);
    api.sfApiUsage(e)
      .then((r) => setByEnv((m) => ({ ...m, [e]: { ...(m[e] || {}), usage: r, err: '' } })))
      .catch((er) => setByEnv((m) => ({ ...m, [e]: { ...(m[e] || {}), err: er.message } })))
      .finally(() => setLoading(false));
  };
  const refreshLive = (e) => {
    setRefreshing(true);
    api.sfApiLimits(e)
      .then((r) => { setByEnv((m) => ({ ...m, [e]: { ...(m[e] || {}), live: r, err: '' } })); loadCached(e); })
      .catch((er) => setByEnv((m) => ({ ...m, [e]: { ...(m[e] || {}), err: er.message } })))
      .finally(() => setRefreshing(false));
  };
  // On open / tab-switch: load the cached reading only (no SF call).
  useEffect(() => { if (!byEnv[env] || !byEnv[env].usage) loadCached(env); /* eslint-disable-next-line */ }, [env]);

  const cur = byEnv[env] || {};
  const err = cur.err;
  const usage = cur.usage;
  const live = cur.live;
  const view = live || (usage && usage.latest);    // gauge: live after a refresh, else the cached latest
  const isLive = !!live;
  const d = view && view.daily_api;
  const pct = d ? d.pct_used : null;
  const color = band(pct);
  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const points = (usage && usage.points) || [];
  const byOp = (usage && usage.by_op) || [];
  const runs = (usage && usage.runs) || [];
  const preflight = usage && usage.preflight;
  const envLabel = env === 'production' ? 'Production' : 'Sandbox';

  return (
    <>
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>📡 SF API usage</h2>
        <span className="mx-last" style={{ marginLeft: 'auto' }}>
          <span className="mx-last-label">{isLive ? 'Live reading' : 'Last reading'}</span>
          <span className="mx-last-val">{view && view.at_mtn ? view.at_mtn : '—'}</span>
        </span>
      </div>

      <div className="mx-scope">
        <span className="mx-scope-label">Environment</span>
        <div className="mx-tabs">
          {ENVS.map(([k, lbl]) => (
            <button key={k} className={env === k ? 'on' : ''} onClick={() => setEnv(k)}>{lbl}</button>
          ))}
        </div>
        <span className="mx-scope-hint">Shows the last captured reading — no API call. Refresh pulls a live reading (the only call it makes).</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 16px' }}>
        <button className="btn" onClick={() => refreshLive(env)} disabled={refreshing}>{refreshing ? '…' : '↻ Refresh (live)'}</button>
        {view && <span className={'mx-tag' + (view.environment === 'Production' ? '' : ' new')}>{view.environment || envLabel}</span>}
        {view && view.org_id && <span className="muted small">Org {view.org_id}</span>}
        {view && !isLive && <span className="muted small">cached{view.op ? ' · ' + view.op : ''}</span>}
        {loading && <span className="muted small">…</span>}
      </div>

      {err && <p className="err">{err}</p>}
      {!err && !view && !loading && (
        <p className="muted">No reading captured yet for {envLabel}. Hit <strong>Refresh (live)</strong> to pull the current usage — that uses one API call.</p>
      )}

      {d && (
        <>
          <div className="mx-cards">
            <div className="mx-card"><div className="k">Daily API used</div><div className="v" style={{ color }}>{fmt(d.used)}</div><div className="s">of {fmt(d.max)}</div></div>
            <div className="mx-card"><div className="k">Remaining</div><div className="v">{fmt(d.remaining)}</div><div className="s">calls left today</div></div>
            <div className="mx-card"><div className="k">Consumed</div><div className="v" style={{ color }}>{pct == null ? '—' : pct + '%'}</div><div className="s">of daily budget</div></div>
          </div>

          <div className="mx-panel">
            <h2>Daily API request budget — {envLabel}</h2>
            <div style={{ background: 'var(--line, #e4e7ec)', borderRadius: 8, height: 22, overflow: 'hidden' }}>
              <div style={{ width: barPct + '%', height: '100%', background: color, transition: 'width .3s' }} />
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {fmt(d.used)} used · {fmt(d.remaining)} remaining · {fmt(d.max)} daily max · {isLive ? 'live' : 'cached'} reading
            </p>
          </div>
        </>
      )}

      {preflight && preflight.approved_sets > 0 && (
        <div className="mx-panel" style={preflight.would_exceed ? { borderLeft: '3px solid #e4002b' } : undefined}>
          <h2>Pre-flight <span className="dim" style={dim}>— cost to run the approved queue</span></h2>
          <div className="mx-cards">
            <div className="mx-card"><div className="k">Approved sets</div><div className="v">{fmt(preflight.approved_sets)}</div><div className="s">queued to run</div></div>
            <div className="mx-card"><div className="k">Est. API calls</div><div className="v" style={{ color: preflight.would_exceed ? '#e4002b' : 'var(--ink)' }}>{fmt(preflight.estimate)}</div><div className="s">{fmt(preflight.merge_calls)} merge + {fmt(preflight.overhead_calls)} overhead</div></div>
            <div className="mx-card"><div className="k">Remaining</div><div className="v">{fmt(preflight.remaining)}</div><div className="s">{preflight.pct_after != null ? preflight.pct_after + '% after' : 'no reading'}</div></div>
          </div>
          {preflight.would_exceed === true && (
            <p className="err" style={{ marginTop: 8 }}>⚠ Estimated cost ({fmt(preflight.estimate)}) exceeds the remaining budget ({fmt(preflight.remaining)}). Split the run or wait for the daily reset.</p>
          )}
          {preflight.would_exceed === false && (
            <p className="muted small" style={{ marginTop: 8 }}>Fits within today's remaining budget{preflight.reading_at ? ' (reading as of ' + preflight.reading_at + ')' : ''}. Estimate is conservative — it refines as measured run costs accumulate below.</p>
          )}
          {preflight.remaining == null && (
            <p className="muted small" style={{ marginTop: 8 }}>No live reading yet — hit Refresh to compare the estimate against the remaining budget.</p>
          )}
        </div>
      )}

      {d && points.length > 0 && (
        <div className="mx-panel">
          <h2>Usage today <span className="dim" style={dim}>· {points.length} reading{points.length === 1 ? '' : 's'}</span></h2>
          <Sparkline points={points} />
        </div>
      )}

      {byOp.length > 0 && (
        <div className="mx-panel">
          <h2>By activity <span className="dim" style={dim}>— what generated the readings</span></h2>
          <table>
            <thead><tr><th>Activity</th><th>Readings</th><th>Runs</th><th>Used span</th></tr></thead>
            <tbody>
              {byOp.map((r) => (
                <tr key={r.op}>
                  <td>{r.op}</td>
                  <td>{fmt(r.snapshots)}</td>
                  <td>{fmt(r.runs)}</td>
                  <td>{(r.max_used != null && r.min_used != null) ? fmt(r.max_used - r.min_used) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runs.length > 0 && (
        <div className="mx-panel">
          <h2>Recent runs <span className="dim" style={dim}>— measured API cost</span></h2>
          <table>
            <thead><tr><th>Run</th><th>Activity</th><th>Actor</th><th>API cost</th><th>Last seen (MTN)</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td className="mono">{String(r.run_id).slice(0, 18)}</td>
                  <td>{r.op}</td>
                  <td>{r.actor || '—'}</td>
                  <td>{r.cost != null ? fmt(r.cost) : '—'}</td>
                  <td>{r.last_seen || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>Cost = Daily API Requests consumed between a run's first and last reading (needs ≥2 snapshots per run).</p>
        </div>
      )}

      {view && view.other && Object.keys(view.other).length > 0 && (
        <div className="mx-panel">
          <h2>Other limits <span className="dim" style={dim}>— live reading only</span></h2>
          <table>
            <thead><tr><th>Limit</th><th>Used</th><th>Remaining</th><th>Max</th></tr></thead>
            <tbody>
              {Object.entries(view.other).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{fmt(v.used)}</td><td>{fmt(v.remaining)}</td><td>{fmt(v.max)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
