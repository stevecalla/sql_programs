import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMtn } from '../../../lib/mtnDate.js';
import DataTable from '../components/DataTable.jsx';
import ChartCard from '../components/ChartCard.jsx';
import { track } from '../../../lib/track.js';

// SF API usage (Phases 1-4). On open it shows the LAST CAPTURED reading (cheap DB read — NO Salesforce
// call); Refresh is the only live call, and it records a fresh snapshot for the next viewer. Sandbox /
// Production tabs pick the org. Beyond the headroom gauge it shows an intraday trend, a per-activity
// attribution table, a PRE-FLIGHT estimate (cost to run the approved queue vs remaining budget, with a
// warning if it would exceed), and RECENT RUNS with their measured API cost.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
function band(pct) { return pct == null ? '#6b7686' : pct >= 85 ? '#e4002b' : pct >= 60 ? '#e0a200' : '#16a34a'; }
const ENVS = [['production', 'Production'], ['sandbox', 'Sandbox']];
const dim = { fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 };

// Shared budget gauge — 3 cards (used / remaining / consumed) + a bar + a note. Used for BOTH the Daily
// API Requests and the Async Apex budgets so they render identically.
function BudgetGauge({ title, subtitle, usedLabel, remainingSub, consumedSub, used, max, remaining, pct, note }) {
  const color = band(pct);
  const bar = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="mx-panel" style={{ marginTop: 12, borderLeft: pct != null && pct >= 85 ? '3px solid #e4002b' : undefined }}>
      <h2>{title}{subtitle ? <span className="dim" style={dim}> {subtitle}</span> : null}</h2>
      <div className="mx-cards">
        <div className="mx-card"><div className="k">{usedLabel}</div><div className="v" style={{ color }}>{fmt(used)}</div><div className="s">of {fmt(max)}</div></div>
        <div className="mx-card"><div className="k">Remaining</div><div className="v">{fmt(remaining)}</div><div className="s">{remainingSub}</div></div>
        <div className="mx-card"><div className="k">Consumed</div><div className="v" style={{ color }}>{pct == null ? '\u2014' : pct + '%'}</div><div className="s">{consumedSub}</div></div>
      </div>
      <div style={{ background: 'var(--line, #e4e7ec)', borderRadius: 8, height: 22, overflow: 'hidden', marginTop: 8 }}>
        <div style={{ width: bar + '%', height: '100%', background: color, transition: 'width .3s' }} />
      </div>
      {note ? <p className="muted small" style={{ marginTop: 8 }}>{note}</p> : null}
    </div>
  );
}

export default function SfApi() {
  const [env, setEnv] = useState('production');
  const [byEnv, setByEnv] = useState({});          // { [env]: { usage, live, err } }
  const [loading, setLoading] = useState(false);   // cached load (DB, no SF call)
  const [refreshing, setRefreshing] = useState(false); // live SF call
  const [opsOpen, setOpsOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(true);
  const [budgetTab, setBudgetTab] = useState('apex');
  const pickTab = (t) => { setBudgetTab(t); track('sf_api_view', { panel: 'merge', view: t }); };

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
  const dapex = view && view.daily_apex;
  const apexPct = dapex ? dapex.pct_used : null;
  const apexColor = band(apexPct);
  const apexBar = apexPct == null ? 0 : Math.max(0, Math.min(100, apexPct));
  const points = (usage && usage.points) || [];
  const mtnToday = (usage && usage.mtn_today) || null;
  const usagePts = points.map((p) => ({ v: Number(p.api_used), a: (p.apex_used != null ? Number(p.apex_used) : null), t: String(p.created_at_mtn || '') })).filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t.localeCompare(b.t));
  const usageLabels = usagePts.map((p) => (String(p.t).match(/(\d{2}:\d{2})/) || [null, ''])[1] || String(p.t).slice(11, 16));
  const usageSeries = [
    { label: 'Daily API used', data: usagePts.map((p) => p.v), color: '#2e75b6' },
    { label: 'Async Apex used', data: usagePts.map((p) => (p.a != null && Number.isFinite(p.a) ? p.a : null)), color: '#e0a200' },
  ];
  const usageRows = usagePts.map((p, i) => [usageLabels[i], p.v, (p.a != null ? p.a : '')]);
  const byOp = (usage && usage.by_op) || [];
  const runs = (usage && usage.runs) || [];
  const byOpRows = byOp.map((r) => ({ ...r, span: (r.max_used != null && r.min_used != null) ? (r.max_used - r.min_used) : null }));
  const preflight = usage && usage.preflight;
  const envLabel = env === 'production' ? 'Production' : 'Sandbox';

  return (
    <>
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>📡 SF API usage</h2>
        <span className="mx-last" style={{ marginLeft: 'auto' }}>
          <span className="mx-last-label">{isLive ? 'Live reading' : 'Last reading'}</span>
          <span className="mx-last-val">{view && view.at_mtn ? formatMtn(view.at_mtn) + ' MTN' : '—'}</span>
        </span>
      </div>

      <div className="mx-scope">
        <span className="mx-scope-label">Environment</span>
        <div className="mx-tabs">
          {ENVS.map(([k, lbl]) => (
            <button key={k} className={env === k ? 'on' : ''} onClick={() => { setEnv(k); track('sf_api_env', { panel: 'merge', view: k }); }}>{lbl}</button>
          ))}
        </div>
        <span className="mx-scope-hint">Shows the last captured reading — no API call. Refresh pulls a live reading (the only call it makes).</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 16px' }}>
        <button className="btn" onClick={() => { track('sf_api_refresh', { panel: 'merge', view: 'live' }); refreshLive(env); }} disabled={refreshing}>{refreshing ? '…' : '↻ Refresh (live)'}</button>
        {view && <span className={'mx-tag' + (view.environment === 'Production' ? '' : ' new')}>{view.environment || envLabel}</span>}
        {view && view.org_id && <span className="muted small">Org {view.org_id}</span>}
        {view && !isLive && <span className="muted small">cached{view.op ? ' · ' + view.op : ''}</span>}
        {loading && <span className="muted small">…</span>}
      </div>

      {err && <p className="err">{err}</p>}
      {!err && !view && !loading && (
        <p className="muted">No reading captured yet for {envLabel}. Hit <strong>Refresh (live)</strong> to pull the current usage — that uses one API call.</p>
      )}

      {(d || dapex || points.length > 0 || (preflight && preflight.approved_sets > 0)) && (
        <>
          <div className="mx-tabbar">
            <button className={budgetTab === 'apex' ? 'on' : ''} onClick={() => pickTab('apex')}>Async Apex budget</button>
            <button className={budgetTab === 'api' ? 'on' : ''} onClick={() => pickTab('api')}>Daily API budget</button>
            <button className={budgetTab === 'preflight' ? 'on' : ''} onClick={() => pickTab('preflight')}>Pre-flight cost</button>
            <button className={budgetTab === 'usage' ? 'on' : ''} onClick={() => pickTab('usage')}>Usage today</button>
          </div>

          {budgetTab === 'apex' && (dapex
            ? <BudgetGauge title={'Async Apex budget — ' + envLabel} subtitle="— the binding limit (merges trigger rollups)" usedLabel="Async Apex used" remainingSub="executions left today" consumedSub="of daily Apex limit" used={dapex.used} max={dapex.max} remaining={dapex.remaining} pct={apexPct} note={fmt(dapex.used) + ' used · ' + fmt(dapex.remaining) + ' remaining · ' + fmt(dapex.max) + ' daily max. A merge spends ~100 of these (measured ~74/merge), so this — not the API budget — is what limits a large bulk run.'} />
            : <p className="muted" style={{ marginTop: 12 }}>No Apex reading yet — hit Refresh (live).</p>)}

          {budgetTab === 'api' && (d
            ? <BudgetGauge title={'Daily API request budget — ' + envLabel} usedLabel="Daily API used" remainingSub="calls left today" consumedSub="of daily budget" used={d.used} max={d.max} remaining={d.remaining} pct={pct} note={fmt(d.used) + ' used · ' + fmt(d.remaining) + ' remaining · ' + fmt(d.max) + ' daily max · ' + (isLive ? 'live' : 'cached') + ' reading'} />
            : <p className="muted" style={{ marginTop: 12 }}>No API reading yet — hit Refresh (live).</p>)}

          {budgetTab === 'preflight' && (preflight && preflight.approved_sets > 0 ? (
            <div className="mx-panel" style={{ marginTop: 12, ...((preflight.would_exceed || preflight.apex_would_exceed) ? { borderLeft: '3px solid #e4002b' } : {}) }}>
              <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>Pre-flight <span className="dim" style={dim}>— cost to run the approved queue</span><button type="button" className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }} title="Pull a fresh live reading and recompute the estimate vs remaining budget" onClick={() => { track('sf_api_refresh', { panel: 'merge', view: 'preflight' }); refreshLive(env); }} disabled={refreshing}>{refreshing ? '…' : '↻ Refresh'}</button></h2>
              <div className="mx-cards">
                <div className="mx-card"><div className="k">Approved sets</div><div className="v">{fmt(preflight.approved_sets)}</div><div className="s">queued to run</div></div>
                <div className="mx-card"><div className="k">Est. API calls</div><div className="v" style={{ color: preflight.would_exceed ? '#e4002b' : 'var(--ink)' }}>{fmt(preflight.estimate)}</div><div className="s">{fmt(preflight.merge_calls)} merge + {fmt(preflight.overhead_calls)} overhead</div></div>
                <div className="mx-card"><div className="k">Est. async Apex</div><div className="v" style={{ color: preflight.apex_would_exceed ? '#e4002b' : 'var(--ink)' }}>{fmt(preflight.apex_estimate)}</div><div className="s">the run's cost</div></div>
                <div className="mx-card"><div className="k">Apex remaining</div><div className="v" style={{ color: preflight.apex_would_exceed ? '#e4002b' : 'var(--ink)' }}>{fmt(preflight.apex_remaining)}</div><div className="s">{preflight.apex_pct_after != null ? preflight.apex_pct_after + '% after (the ceiling)' : 'of ~250K'}</div></div>
                <div className="mx-card"><div className="k">API remaining</div><div className="v">{fmt(preflight.remaining)}</div><div className="s">{preflight.pct_after != null ? preflight.pct_after + '% after (not the ceiling)' : 'no reading'}</div></div>
              </div>
              {preflight.would_exceed === true && (
                <p className="err" style={{ marginTop: 8 }}>⚠ Estimated API cost ({fmt(preflight.estimate)}) exceeds the remaining budget ({fmt(preflight.remaining)}). Split the run or wait for the daily reset.</p>
              )}
              {preflight.apex_would_exceed === true && (
                <p className="err" style={{ marginTop: 8 }}>⚠ Est. async Apex ({fmt(preflight.apex_estimate)}) exceeds the remaining Apex budget ({fmt(preflight.apex_remaining)}). Async Apex (≈250K/day) is the binding limit — split the run or wait for the daily reset.</p>
              )}
              {preflight.would_exceed === false && preflight.apex_would_exceed !== true && (
                <p className="muted small" style={{ marginTop: 8 }}>Fits within today's budget. The <strong>binding limit is async Apex</strong>: {fmt(preflight.apex_remaining)} left{preflight.apex_pct_after != null ? ' · ' + preflight.apex_pct_after + '% used after this run' : ''} — the API budget ({fmt(preflight.remaining)} left) is far larger and not the constraint.{preflight.reading_at ? ' Reading as of ' + formatMtn(preflight.reading_at) + ' MTN.' : ''}</p>
              )}
              {preflight.remaining == null && (
                <p className="muted small" style={{ marginTop: 8 }}>No live reading yet — hit Refresh to compare the estimate against the remaining budget.</p>
              )}
            </div>
          ) : <p className="muted" style={{ marginTop: 12 }}>No approved sets queued — nothing to pre-flight.</p>)}

          {budgetTab === 'usage' && (usagePts.length > 1
            ? <div style={{ marginTop: 12 }}><ChartCard id="sf-api-usage-today" title={'Usage today — API + async Apex used (' + (mtnToday || 'today') + ', MTN)'} type="line" labels={usageLabels} series={usageSeries} headers={['Time (MTN)', 'Daily API used', 'Async Apex used']} rows={usageRows} height={250} /></div>
            : <p className="muted" style={{ marginTop: 12 }}>No readings captured today (MTN) yet — hit Refresh (live) to add points.</p>)}
        </>
      )}


      {byOp.length > 0 && (
        <div className="mx-panel">
          <h2 onClick={() => setOpsOpen((o) => !o)} style={{ cursor: 'pointer', userSelect: 'none' }}>{opsOpen ? '▾' : '▸'} By activity <span className="dim" style={dim}>— what generated the readings</span></h2>
          {opsOpen && (
          <DataTable
            rows={byOpRows}
            rowNumbers={true}
            maxHeight={280}
            clientExport="sf_api_by_activity"
            searchCols="activity"
            columns={[
              { key: 'op', label: 'Activity', sort: true, align: 'left', help: 'The operation that produced these readings — merge, restore, recreate, probe or build.' },
              { key: 'snapshots', label: 'Readings', sort: true, help: 'Number of API-usage snapshots recorded for this activity in the window.', render: (r) => fmt(r.snapshots) },
              { key: 'runs', label: 'Runs', sort: true, help: 'Distinct runs (run_id) that recorded at least one reading for this activity.', render: (r) => fmt(r.runs) },
              { key: 'span', label: 'Used span', sort: true, help: 'Daily API Requests consumed across this activity\'s readings (max used − min used).', render: (r) => (r.span == null ? '—' : fmt(r.span)) },
            ]}
          />
          )}
        </div>
      )}

      {runs.length > 0 && (
        <div className="mx-panel">
          <h2 onClick={() => setRunsOpen((o) => !o)} style={{ cursor: 'pointer', userSelect: 'none' }}>{runsOpen ? '▾' : '▸'} Recent runs <span className="dim" style={dim}>— measured API cost · latest 20</span></h2>
          {runsOpen && (
          <DataTable
            rows={runs}
            rowNumbers={true}
            maxHeight={340}
            clientExport="sf_api_recent_runs"
            searchCols="run, activity, actor"
            columns={[
              { key: 'run_id', label: 'Run', sort: true, copy: true, align: 'left', help: 'The run identifier. Use the copy button to grab the full id.', exportValue: (r) => r.run_id, render: (r) => <span className="mono">{String(r.run_id).slice(0, 18)}</span> },
              { key: 'op', label: 'Activity', sort: true, help: 'Operation this run performed — merge, restore or recreate.' },
              { key: 'actor', label: 'Actor', sort: true, help: 'The app user who initiated the run.', render: (r) => r.actor || '—' },
              { key: 'cost', label: 'API cost', sort: true, help: 'Daily API Requests consumed by this run (last reading − first reading; needs ≥2 snapshots).', exportValue: (r) => r.cost, render: (r) => (Number(r.snapshots) >= 2 ? fmt(r.cost) : '—') },
              { key: 'apex_cost', label: 'Apex cost', sort: true, help: 'DailyAsyncApexExecutions consumed by this run — merges trigger async Apex (rollups, managed-package logic). This limit is far smaller than the API budget.', exportValue: (r) => r.apex_cost, render: (r) => (Number(r.snapshots) >= 2 && r.apex_cost != null ? fmt(r.apex_cost) : '—') },
              { key: 'last_seen', label: 'Last seen (MTN)', sort: true, help: 'Timestamp of the run\'s most recent reading, Mountain time.', exportValue: (r) => formatMtn(r.last_seen), render: (r) => formatMtn(r.last_seen) },
            ]}
          />
          )}
          <p className="muted small" style={{ marginTop: 8 }}>Cost = Daily API Requests consumed between a run's first and last reading (needs ≥2 snapshots per run). Showing the 20 most recent runs.</p>
        </div>
      )}

      {view && view.other && Object.keys(view.other).length > 0 && (
        <div className="mx-panel">
          <h2 onClick={() => setOtherOpen((o) => !o)} style={{ cursor: 'pointer', userSelect: 'none' }}>{otherOpen ? '▾' : '▸'} Other limits <span className="dim" style={dim}>— live reading only</span></h2>
          {otherOpen && (
          <DataTable
            rows={Object.entries(view.other).map(([k, v]) => ({ limit: k, used: v.used, remaining: v.remaining, max: v.max }))}
            rowNumbers={true}
            maxHeight={340}
            clientExport="sf_api_other_limits"
            searchCols="limit"
            columns={[
              { key: 'limit', label: 'Limit', sort: true, align: 'left', help: 'Salesforce org limit name, from the live /limits reading.' },
              { key: 'used', label: 'Used', sort: true, help: 'Amount of this limit consumed.', render: (r) => fmt(r.used) },
              { key: 'remaining', label: 'Remaining', sort: true, help: 'Amount of this limit still available.', render: (r) => fmt(r.remaining) },
              { key: 'max', label: 'Max', sort: true, help: 'The limit\'s allocated maximum.', render: (r) => fmt(r.max) },
            ]}
          />
          )}
        </div>
      )}
    </>
  );
}
