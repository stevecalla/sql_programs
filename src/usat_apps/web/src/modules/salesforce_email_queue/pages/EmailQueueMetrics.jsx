import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { metricsTestOn, setMetricsTest } from '../../../lib/track.js';
import ChartCard from '../components/ChartCard.jsx';
import AskData from '../components/AskData.jsx';
import MetricsControls from '../../../components/MetricsControls.jsx';
import SqlReference from '../../../components/SqlReference.jsx';
import { useMetricsTheme } from '../../../lib/useMetricsTheme.js';
import { formatMtn } from '../../../lib/mtnDate.js';

// Usage-analytics dashboard for the salesforce_email_queue module — a sibling of the SF Merge
// MergeMetrics page: same control surface, stat-card grid, Chart.js cards, Ask-your-data panel and
// tables, rewired to the email-queue metrics report (api.metricsReport → report.data). Covers the two
// funnels (thread + case), the AI flow (calls / success / latency / grounded / tokens / cost),
// provider/verdict/action/model breakdowns, real-vs-test spend, the cases-worked table, queues,
// operators/visitors, day/hour/dow activity, attachments/corrections/context/errors and a health footer.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const usd = (n, d = 2) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COL = { visits: '#6b7686', threads: '#2e75b6', ai: '#e4002b', acks: '#e0a200', green: '#16a34a', purple: '#7c3aed' };

function Card({ k, v, s }) {
  return <div className="mx-card"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s || ''}</div></div>;
}

// Render the human report.sections summary defensively — the backend may emit strings, {title,lines}
// or {title,text}; normalize whatever shape arrives into a titled list of lines.
function SectionBlock({ s }) {
  if (s == null) return null;
  if (typeof s === 'string') return <p className="muted small" style={{ margin: '2px 0' }}>{s}</p>;
  const title = s.title || s.name || s.heading;
  let lines = s.lines || s.items || (s.text != null ? [s.text] : (s.body != null ? [s.body] : []));
  if (!Array.isArray(lines)) lines = [lines];
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
      {title && <div style={{ fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5, color: 'var(--muted)' }}>{title}</div>}
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {lines.map((l, i) => <li key={i} className="small" style={{ margin: '3px 0' }}>{typeof l === 'string' ? l : JSON.stringify(l)}</li>)}
      </ul>
    </div>
  );
}

export default function EmailQueueMetrics({ user }) {
  const [days, setDays] = useState(7);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState('');
  const theme = useMetricsTheme();
  const [mtestOn, setMtestOn] = useState(metricsTestOn());
  const [showTest, setShowTest] = useState(true);   // default ON — show everything incl. test rows (aligned with the Merge Metrics page)
  const [askOpen, setAskOpen] = useState(false);    // Ask-your-data ("insight") card — collapsed by default; "+ Show" to expand
  const [sumOpen, setSumOpen] = useState(false);    // Summary card — collapsed by default; expands to a scannable 2-col layout
  const isAdmin = !!(user && user.role === 'admin');

  const load = () => api.metricsReport(days, showTest).then((r) => { setRep(r.report); setErr(''); }).catch((e) => setErr(e.message));
  const toggleMtest = () => { const next = !mtestOn; setMetricsTest(next); setMtestOn(next); load(); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days, showTest]);
  useEffect(() => { if (!auto) return; const id = setInterval(load, 60000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [auto, days, showTest]);

  const d = rep && rep.data;
  const dayLabels = useMemo(() => (d ? d.by_day.map((r) => r.day) : []), [d]);

  const purge = async () => {
    if (!window.confirm('Delete all test rows (Sandbox / ?metrics_test=1)?')) return;
    setPurgeMsg('Purging…');
    try { const r = await api.metricsPurgeTest(); setPurgeMsg('Purged ' + (r.deleted != null ? r.deleted : '') + ' test rows.'); load(); }
    catch (e) { setPurgeMsg(e.message); }
  };

  if (err) return (<><h2>SF Email Queue metrics</h2><p className="err">{err}</p></>);
  if (!rep) return (<><h2>SF Email Queue metrics</h2><p className="muted">Loading…</p></>);

  const ai = d.ai || {};
  const sf = d.sf || {};
  const spend = d.spend || {};
  const corrAdded = (d.corrections || []).reduce((s, c) => s + (Number(c.n) || 0), 0);

  return (
    <>
      {mtestOn && (
        <div style={{ background: '#0e2a5e', color: '#9ec5ff', border: '1px solid #2e5db0', padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13, textAlign: 'center', marginBottom: 10 }}>
          🧪 TEST MODE — your activity is flagged is_test (toggle off with “Flag my activity as test”)
        </div>
      )}
      <MetricsControls
        title="📧 SF Email Queue metrics"
        lastActivity={formatMtn(d.health.latest_mtn)}
        days={days} onDays={setDays}
        auto={auto} onAuto={setAuto}
        includeTest={{ checked: showTest, onChange: setShowTest, title: 'Include is_test=1 rows in every card/table so you can review flagged test activity before purging.' }}
        onRefresh={load}
        isAdmin={isAdmin}
        showPurge onPurge={purge} purgeMsg={purgeMsg}
        mtestOn={mtestOn} onToggleMtest={toggleMtest}
      />

      {/* stat cards */}
      <div className="mx-cards">
        <Card k="Visits" v={fmt(d.visits)} s={fmt(d.unique_users) + ' users · ' + fmt(d.new_users) + ' new / ' + fmt(d.repeat_users) + ' return'} />
        <Card k="Operators" v={fmt(d.operators)} s="distinct staff" />
        <Card k="Threads opened" v={fmt(d.threads_opened)} s={fmt(d.acknowledgements) + ' acks'} />
        <Card k="Replies copied" v={fmt(d.replies_copied)} s="drafts used" />
        <Card k="AI calls" v={fmt(ai.calls)} s={(ai.success_pct != null ? ai.success_pct + '% ok' : '') + (ai.failed ? ' · ' + fmt(ai.failed) + ' failed' : '')} />
        <Card k="Drafts OK" v={fmt(ai.ok)} s={fmt(ai.failed) + ' failed'} />
        <Card k="Corrections" v={fmt(corrAdded)} s={fmt(ai.corrections_used) + ' applied to drafts'} />
        <Card k="Grounded" v={(ai.grounded_pct != null ? ai.grounded_pct + '%' : '—')} s={fmt(ai.grounded) + ' of ' + fmt(ai.calls) + ' calls'} />
        <Card k="Avg AI latency" v={ai.avg_ms != null ? fmt(ai.avg_ms) + ' ms' : '—'} s={ai.max_ms != null ? 'max ' + fmt(ai.max_ms) + ' ms' : ''} />
        <Card k="AI tokens" v={fmt((ai.prompt_tokens || 0) + (ai.completion_tokens || 0))} s={fmt(ai.prompt_tokens) + ' in / ' + fmt(ai.completion_tokens) + ' out'} />
        <Card k="AI cost" v={usd(ai.cost_usd, 4)} s="estimated · tokens × price" />
        <Card k="SF sends" v={fmt(sf.sends)} s={fmt(sf.sends_ok) + ' ok'} />
        <Card k="Status changes" v={fmt(sf.status_changes)} s={fmt(sf.status_ok) + ' ok'} />
        <Card k="With images" v={fmt(ai.with_images)} s={'avg reply ' + fmt(ai.avg_reply_chars) + ' chars'} />
        <Card k="Test rows" v={fmt(d.health.test_rows)} s="is_test=1 (purgeable)" />
        <Card k="Row count DB" v={fmt(d.health.rows)} s={(d.health.mb != null ? d.health.mb + ' MB' : '')} />
      </div>

      {/* human summary — collapsible + scannable 2-col cards */}
      {Array.isArray(rep.sections) && rep.sections.length > 0 && (
        <div className="mx-panel">
          <h2 style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setSumOpen((o) => !o)}>
            Summary <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>{rep.range || ''}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13 }}>{sumOpen ? '− Hide' : '+ Show'}</span>
          </h2>
          {sumOpen && (
            <div className="mx-grid2" style={{ marginTop: 4 }}>
              {rep.sections.map((s, i) => <SectionBlock key={i} s={s} />)}
            </div>
          )}
        </div>
      )}

      {/* ask your data — collapsible (restores the POC "− Hide") */}
      <div className="mx-panel">
        <h2 style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setAskOpen((o) => !o)}>
          Ask your data <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— read-only AI</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13 }}>{askOpen ? '− Hide' : '+ Show'}</span>
        </h2>
        {askOpen && <AskData />}
      </div>

      {/* funnels */}
      <div className="mx-grid2">
        <ChartCard id="chart_funnel" title="Thread funnel — visits → threads → AI calls → drafts → acks" theme={theme}
          labels={d.funnel.map((s) => s.stage)} values={d.funnel.map((s) => s.n)}
          headers={['Stage', 'Count']} rows={d.funnel.map((s) => [s.stage, s.n])} />
        <ChartCard id="chart_case_funnel" title="Case funnel — opened → AI-assisted → drafted → sent → status changed" theme={theme} color={COL.threads}
          labels={d.case_funnel.map((s) => s.stage)} values={d.case_funnel.map((s) => s.n)}
          headers={['Stage', 'Count']} rows={d.case_funnel.map((s) => [s.stage, s.n])} />
      </div>

      {/* activity by day */}
      <ChartCard id="chart_days" title="Activity by day (MTN) — visits · threads · AI calls · acks" type="multibar" theme={theme}
        labels={dayLabels}
        series={[
          { label: 'Visits', color: COL.visits, data: d.by_day.map((r) => r.visits) },
          { label: 'Threads', color: COL.threads, data: d.by_day.map((r) => r.threads) },
          { label: 'AI calls', color: COL.ai, data: d.by_day.map((r) => r.ai_calls) },
          { label: 'Acks', color: COL.acks, data: d.by_day.map((r) => r.acks) },
        ]}
        headers={['Day', 'Visits', 'Threads', 'AI calls', 'Acks', 'Est cost']}
        rows={d.by_day.map((r) => [r.day, r.visits, r.threads, r.ai_calls, r.acks, usd(r.cost_usd, 4)])} />

      {/* by hour / by day-of-week */}
      <div className="mx-grid2">
        <ChartCard id="chart_hour" title="Activity by hour (MTN)" theme={theme} color={COL.threads}
          labels={d.by_hour.map((h) => String(h.hour).padStart(2, '0'))} values={d.by_hour.map((h) => h.n)}
          headers={['Hour', 'Events']} rows={d.by_hour.map((h) => [h.hour, h.n])} />
        <ChartCard id="chart_dow" title="Activity by day of week (MTN)" theme={theme} color={COL.acks}
          labels={d.by_dow.map((r) => DOWS[r.dow] || r.dow)} values={d.by_dow.map((r) => r.n)}
          headers={['Day', 'Events']} rows={d.by_dow.map((r) => [DOWS[r.dow] || r.dow, r.n])} />
      </div>

      {/* AI provider / verdict */}
      <div className="mx-grid2">
        <ChartCard id="chart_provider" title="AI by provider (cost in table)" theme={theme} color={COL.ai}
          labels={d.by_provider.map((p) => p.provider)} values={d.by_provider.map((p) => p.n)}
          headers={['Provider', 'Calls', 'Avg ms', 'Est cost']} rows={d.by_provider.map((p) => [p.provider, p.n, p.avg_ms, usd(p.cost_usd, 4)])} />
        <ChartCard id="chart_verdict" title="AI verdicts" theme={theme} color={COL.purple}
          labels={d.by_verdict.map((v) => v.verdict)} values={d.by_verdict.map((v) => v.n)}
          headers={['Verdict', 'Count']} rows={d.by_verdict.map((v) => [v.verdict, v.n])} />
      </div>

      {/* events by action */}
      <ChartCard id="chart_action" title="Events by action" theme={theme} color={COL.visits}
        labels={d.by_action.map((a) => a.action)} values={d.by_action.map((a) => a.n)}
        headers={['Action', 'Count']} rows={d.by_action.map((a) => [a.action, a.n])} />

      {/* AI spend — real vs test vs total (matches the prior version's inline layout) */}
      <div className="mx-panel">
        <h2>AI spend <span className="mx-tag">estimated</span></h2>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', margin: '2px 0 6px' }}>
          <div>
            <div className="muted small">Real (production)</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{usd(spend.real_usd, 4)}</div>
            <div className="muted small">{fmt(spend.real_calls)} calls</div>
          </div>
          <div>
            <div className="muted small">Test / QA</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25, color: '#e0a200' }}>{usd(spend.test_usd, 4)}</div>
            <div className="muted small">{fmt(spend.test_calls)} calls</div>
          </div>
          <div>
            <div className="muted small">Total (bill)</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{usd(spend.total_usd, 4)}</div>
          </div>
        </div>
        <p className="muted small">
          Real = production usage (excluded from the usage stats above). Test = your <code>?metrics_test=1</code> / admin runs —
          they still cost real money. <b>Total = Real + Test</b> and is what your OpenAI / Anthropic bill reflects.
        </p>
      </div>

      {/* AI cost by model — ESTIMATED table (matches the prior version) */}
      <div className="mx-panel">
        <h2>AI cost by model <span className="mx-tag">estimated</span></h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Model</th><th>Calls</th><th>Input tokens</th><th>Output tokens</th><th>Est. cost</th></tr></thead>
            <tbody>
              {d.by_model.length === 0 && <tr><td className="dim" colSpan={6}>none</td></tr>}
              {d.by_model.map((m, i) => (
                <tr key={m.model + i}><td className="mx-rn">{i + 1}</td><td>{m.model}</td><td>{fmt(m.n)}</td><td>{fmt(m.prompt_tokens)}</td><td>{fmt(m.completion_tokens)}</td><td>{usd(m.cost_usd, 4)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Cost = tokens × per-model price (set in Admin → Settings). Models with no configured price show $0.</p>
      </div>
      <ChartCard id="chart_env" title="AI spend by environment (total $)" theme={theme} color={COL.green}
        labels={(spend.by_env || []).map((e) => e.env)} values={(spend.by_env || []).map((e) => Number(e.total_usd) || 0)}
        headers={['Environment', 'Real $', 'Test $', 'Total $']}
        rows={(spend.by_env || []).map((e) => [e.env, usd(e.real_usd, 4), usd(e.test_usd, 4), usd(e.total_usd, 4)])} />

      {/* by queue */}
      <ChartCard id="chart_queue" title="Activity by queue — events (AI calls / threads / cost in table)" theme={theme} color={COL.threads}
        labels={d.by_queue.map((q) => q.queue)} values={d.by_queue.map((q) => q.events)}
        headers={['Queue', 'Events', 'AI calls', 'Threads', 'Est cost']} rows={d.by_queue.map((q) => [q.queue, q.events, q.ai_calls, q.threads, usd(q.cost_usd, 4)])} />

      {/* cases worked */}
      <div className="mx-panel">
        <h2>Cases worked</h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr>
              <th className="mx-rn">#</th><th>Case</th><th>Queue</th><th>Actor</th><th>Events</th><th>AI</th><th>Asks</th>
              <th>Drafts</th><th>Corr.</th><th>Ctx</th><th>Sends</th><th>Status Δ</th><th>Attach</th><th>Cost</th><th>Last seen</th>
            </tr></thead>
            <tbody>
              {d.cases.length === 0 && <tr><td className="dim" colSpan={15}>none</td></tr>}
              {d.cases.map((c, i) => (
                <tr key={(c.case_id || c.case_number || '') + i}>
                  <td className="mx-rn">{i + 1}</td>
                  <td>{c.case_number || c.case_id || '—'}</td>
                  <td>{c.queue || '—'}</td>
                  <td>{c.actor || '—'}</td>
                  <td>{fmt(c.events)}</td><td>{fmt(c.ai_calls)}</td><td>{fmt(c.asks)}</td>
                  <td>{fmt(c.drafts)}</td><td>{fmt(c.corrections)}</td><td>{fmt(c.context_changes)}</td>
                  <td>{fmt(c.sends)}</td><td>{fmt(c.status_changes)}</td><td>{fmt(c.attachments)}</td>
                  <td>{usd(c.cost_usd, 4)}</td><td>{formatMtn(c.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* operators */}
      <div className="mx-grid2">
        <div className="mx-panel">
          <h2>Top operators (by AI calls)</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>AI calls</th><th>Threads</th><th>Events</th><th>Est cost</th><th>Last seen</th></tr></thead>
            <tbody>
              {d.top_operators.length === 0 && <tr><td className="dim" colSpan={7}>none</td></tr>}
              {d.top_operators.map((o, i) => (<tr key={o.actor + i}><td className="mx-rn">{i + 1}</td><td>{o.actor || '—'}</td><td>{fmt(o.ai_calls)}</td><td>{fmt(o.threads)}</td><td>{fmt(o.events)}</td><td>{usd(o.cost_usd, 4)}</td><td>{formatMtn(o.last_seen)}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="mx-panel">
          <h2>Most recent active operators</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Actor</th><th>Last active (MTN)</th><th>Events</th><th>AI calls</th></tr></thead>
            <tbody>
              {d.recent_operators.length === 0 && <tr><td className="dim" colSpan={5}>none</td></tr>}
              {d.recent_operators.map((u, i) => (<tr key={u.actor + i}><td className="mx-rn">{i + 1}</td><td>{u.actor || '—'}</td><td>{formatMtn(u.last_seen)}</td><td>{fmt(u.events)}</td><td>{fmt(u.ai_calls)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>

      {/* visitors */}
      <div className="mx-panel">
        <h2>Visitors <span className="mx-tag">anonymous</span> — with location (timezone)</h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Visitor</th><th>Actor</th><th>Visits</th><th>Threads</th><th>Queues</th><th>Events</th><th>Location (tz)</th><th>Device</th><th>Last activity</th><th>Type</th></tr></thead>
            <tbody>
              {d.visitors.length === 0 && <tr><td className="dim" colSpan={11}>none</td></tr>}
              {d.visitors.map((v, i) => (
                <tr key={v.id}><td className="mx-rn">{i + 1}</td><td className="mono">{String(v.id || '').slice(0, 18)}</td><td>{v.actor || (Array.isArray(v.actors) ? v.actors.join(', ') : v.actors) || '—'}</td><td>{fmt(v.visits)}</td><td>{fmt(v.threads)}</td><td>{fmt(v.queues)}</td><td>{fmt(v.events)}</td><td>{v.tz || '—'}</td><td>{v.viewport || '—'}</td><td>{formatMtn(v.last_seen)}</td><td><span className={'mx-tag' + (v.returning ? '' : ' new')}>{v.returning ? 'returning' : 'new'}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* attachments / corrections / context changes */}
      <div className="mx-grid2">
        <ChartCard id="chart_attach" title="Attachments by type" theme={theme} color={COL.purple}
          labels={d.attachments.map((a) => a.type)} values={d.attachments.map((a) => a.n)}
          headers={['Type', 'Count']} rows={d.attachments.map((a) => [a.type, a.n])} />
        <ChartCard id="chart_corr" title="Corrections by scope" theme={theme} color={COL.acks}
          labels={d.corrections.map((c) => c.scope)} values={d.corrections.map((c) => c.n)}
          headers={['Scope', 'Count']} rows={d.corrections.map((c) => [c.scope, c.n])} />
      </div>
      <ChartCard id="chart_ctx" title="Context changes by action" theme={theme} color={COL.visits}
        labels={d.context_changes.map((c) => c.action)} values={d.context_changes.map((c) => c.n)}
        headers={['Action', 'Count']} rows={d.context_changes.map((c) => [c.action, c.n])} />

      {/* errors */}
      <div className="mx-grid2">
        <div className="mx-panel">
          <h2>AI errors</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Error</th><th>Count</th></tr></thead>
            <tbody>
              {d.ai_errors.length === 0 && <tr><td className="dim" colSpan={3}>none</td></tr>}
              {d.ai_errors.map((e, i) => (<tr key={e.error + i}><td className="mx-rn">{i + 1}</td><td>{e.error}</td><td>{fmt(e.n)}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="mx-panel">
          <h2>Salesforce errors</h2>
          <table>
            <thead><tr><th className="mx-rn">#</th><th>Action</th><th>Error</th><th>Count</th></tr></thead>
            <tbody>
              {d.sf_errors.length === 0 && <tr><td className="dim" colSpan={4}>none</td></tr>}
              {d.sf_errors.map((e, i) => (<tr key={(e.action || '') + (e.error || '') + i}><td className="mx-rn">{i + 1}</td><td>{e.action}</td><td>{e.error}</td><td>{fmt(e.n)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mx-panel">
        <h2>Errors</h2>
        <table>
          <thead><tr><th className="mx-rn">#</th><th>Type</th><th>Count</th></tr></thead>
          <tbody>
            {d.errors.length === 0 && <tr><td className="dim" colSpan={3}>none</td></tr>}
            {d.errors.map((e, i) => (<tr key={e.type + i}><td className="mx-rn">{i + 1}</td><td>{e.type}</td><td>{fmt(e.n)}</td></tr>))}
          </tbody>
        </table>
      </div>

      {/* SQL reference — DDL to recreate the table + the exact metric queries, runnable by hand */}
      <SqlReference schema={rep.schema} queries={rep.queries} title="SQL reference" />

      {/* health footer */}
      <p className="muted small" style={{ marginTop: 12 }}>
        DB health: {fmt(d.health.rows)} rows{d.health.test_rows != null ? ' · ' + fmt(d.health.test_rows) + ' test rows' : ''}
        {d.health.mb != null ? ' · ' + d.health.mb + ' MB' : ''}
        {d.health.latest_mtn ? ' · latest activity ' + formatMtn(d.health.latest_mtn) : ''}
      </p>
    </>
  );
}
