import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import ChartCard from '../components/ChartCard.jsx';
import MetricsControls from '../../../components/MetricsControls.jsx';
import SqlReference from '../../../components/SqlReference.jsx';

// Chatbot usage + cost dashboard — a direct sibling of the SF Email Queue metrics page. Same chrome
// (MetricsControls), same stat-card grid (.mx-cards / Card), same Chart.js cards (ChartCard), and the
// SAME cost sections the email queue uses: the "AI spend" Real/Test/Total panel and the "AI cost by
// model" .mx-utable table. Rewired to the chatbot metrics report (api.metrics -> r.metrics). Sections the
// bot has no data for (operators, verdicts, SF sends, funnels-by-case, attachments) are dropped; the
// email queue's "Cases worked" becomes "Conversations worked" (turns worked).
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const usd = (n, d = 2) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const COL = { conv: '#e4002b', q: '#2e75b6', a: '#16a34a', cost: '#e0a200', purple: '#7c3aed', grey: '#6b7686' };

function Card({ k, v, s }) {
  return <div className="mx-card"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s || ''}</div></div>;
}

export default function ChatbotMetrics() {
  const [days, setDays] = useState(30);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(false);
  const [showTest, setShowTest] = useState(true);   // default ON — include is_test rows (aligned with the Email Queue page)
  const [theme, setTheme] = useState('');

  const load = () => {
    const opts = { days };
    if (!showTest) opts.test = 0;                    // unchecked → production traffic only
    return api.metrics(opts).then((r) => { setRep((r && r.metrics) || null); setErr(''); }).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days, showTest]);
  useEffect(() => { if (!auto) return; const id = setInterval(load, 60000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [auto, days, showTest]);

  // Recolor charts when the app theme toggles (mirrors the Merge/Email metrics pages).
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const m = rep;
  const dayLabels = useMemo(() => (m ? m.trend.map((r) => r.day) : []), [m]);

  if (err) return (<><h2>Chatbot metrics</h2><p className="err">{err}</p></>);
  if (!rep) return (<><h2>Chatbot metrics</h2><p className="muted">Loading…</p></>);

  const ov = m.overview, cost = m.cost, src = m.sources;
  const emb = m.embedding || { cost_usd: 0, tokens: 0, embedded: 0, chunks: 0, by_model: [] };
  const funnel = [
    ['Conversations', ov.conversations], ['Questions', ov.questions],
    ['Answers', ov.answers], ['Grounded', ov.grounded_answers],
  ];

  return (
    <>
      <MetricsControls
        title="🤖 Chatbot metrics"
        lastActivity={m.window.last_mtn}
        days={days} onDays={setDays}
        auto={auto} onAuto={setAuto}
        includeTest={{ checked: showTest, onChange: setShowTest, title: 'Include is_test=1 rows (operator test-console runs) in every card/table. Uncheck for production traffic only.' }}
        onRefresh={load}
        isAdmin={false}
      />

      {/* stat cards */}
      <div className="mx-cards">
        <Card k="Conversations" v={fmt(ov.conversations)} s={fmt(ov.questions) + ' questions'} />
        <Card k="Questions" v={fmt(ov.questions)} s="user turns" />
        <Card k="Answers" v={fmt(ov.answers)} s="bot turns" />
        <Card k="Grounded" v={(ov.grounded_pct != null ? ov.grounded_pct + '%' : '—')} s={fmt(ov.grounded_answers) + ' of ' + fmt(ov.answers)} />
        <Card k="Deflected" v={fmt(ov.deflected)} s="no curated answer" />
        <Card k="Avg response" v={ov.avg_latency_ms != null ? fmt(ov.avg_latency_ms) + ' ms' : '—'} s="bot turn latency" />
        <Card k="AI calls" v={fmt(cost.calls)} s="model turns (non-cached)" />
        <Card k="AI tokens" v={fmt((cost.prompt_tokens || 0) + (cost.completion_tokens || 0))} s={fmt(cost.prompt_tokens) + ' in / ' + fmt(cost.completion_tokens) + ' out'} />
        <Card k="AI cost" v={usd(cost.total_usd, 4)} s="estimated · tokens × price" />
        <Card k="Cost / conversation" v={usd(cost.per_conversation_usd, 4)} s="total ÷ conversations" />
        <Card k="Embedding cost" v={usd(emb.cost_usd, 4)} s={fmt(emb.embedded) + ' chunks · shared index'} />
        <Card k="Avg knowledge used" v={fmt(src.avg_knowledge_chars) + ' ch'} s={fmt(src.avg_corrections) + ' avg corrections'} />
      </div>

      {/* funnel + activity by day */}
      <div className="mx-grid2">
        <ChartCard id="chart_cbx_funnel" title="Funnel — conversations → questions → answers → grounded" theme={theme} color={COL.conv}
          labels={funnel.map((s) => s[0])} values={funnel.map((s) => s[1])}
          headers={['Stage', 'Count']} rows={funnel} />
        <ChartCard id="chart_cbx_grounding" title="Sources — grounded vs deflected answers" theme={theme} color={COL.purple}
          labels={['Grounded', 'Deflected']} values={[src.grounded, src.ungrounded]}
          headers={['Source', 'Answers']} rows={[['Grounded', src.grounded], ['Deflected', src.ungrounded]]} />
      </div>

      <ChartCard id="chart_cbx_days" title="Activity by day (MTN) — conversations · questions · answers" type="multibar" theme={theme}
        labels={dayLabels}
        series={[
          { label: 'Conversations', color: COL.conv, data: m.trend.map((r) => r.conversations) },
          { label: 'Questions', color: COL.q, data: m.trend.map((r) => r.questions) },
          { label: 'Answers', color: COL.a, data: m.trend.map((r) => r.answers) },
        ]}
        headers={['Day', 'Conversations', 'Questions', 'Answers', 'Est cost']}
        rows={m.trend.map((r) => [r.day, r.conversations, r.questions, r.answers, usd(r.cost_usd, 4)])} />

      {/* AI spend — real vs test vs total (reproduced from the Email Queue page) */}
      <div className="mx-panel">
        <h2>AI spend <span className="mx-tag">estimated</span></h2>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', margin: '2px 0 6px' }}>
          <div>
            <div className="muted small">Real (production)</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{usd(cost.real_usd, 4)}</div>
            <div className="muted small">{fmt(cost.real_calls)} calls</div>
          </div>
          <div>
            <div className="muted small">Test / QA</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25, color: '#e0a200' }}>{usd(cost.test_usd, 4)}</div>
            <div className="muted small">{fmt(cost.test_calls)} calls</div>
          </div>
          <div>
            <div className="muted small">Total (bill)</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{usd(cost.total_usd, 4)}</div>
            <div className="muted small">{fmt(cost.calls)} calls</div>
          </div>
        </div>
        <p className="muted small">
          Real = production widget usage. Test = operator test-console runs (<code>is_test=1</code>) — they still cost
          real money. <b>Total = Real + Test</b> and is what your OpenAI / Anthropic bill reflects. Cached answers cost $0.
        </p>
      </div>

      {/* AI cost by model — ESTIMATED table (reproduced from the Email Queue page) */}
      <div className="mx-panel">
        <h2>AI cost by model <span className="mx-tag">estimated</span></h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Model</th><th>Calls</th><th>Input tokens</th><th>Output tokens</th><th>Est. cost</th></tr></thead>
            <tbody>
              {cost.by_model.length === 0 && <tr><td className="dim" colSpan={6}>none</td></tr>}
              {cost.by_model.map((r, i) => (
                <tr key={r.model + i}><td className="mx-rn">{i + 1}</td><td>{r.model}</td><td>{fmt(r.calls)}</td><td>{fmt(r.prompt_tokens)}</td><td>{fmt(r.completion_tokens)}</td><td>{usd(r.cost_usd, 4)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Cost = tokens × per-model price (set in Admin → Settings). Models with no configured price show $0.</p>
      </div>

      {/* embedding spend — shared knowledge-index build cost (NOT per-conversation) */}
      <div className="mx-panel">
        <h2>Embedding spend <span className="mx-tag">estimated · shared index</span></h2>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', margin: '2px 0 6px' }}>
          <div>
            <div className="muted small">Index cost</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{usd(emb.cost_usd, 4)}</div>
            <div className="muted small">{fmt(emb.embedded)} of {fmt(emb.chunks)} chunks embedded</div>
          </div>
          <div>
            <div className="muted small">Tokens embedded</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>{fmt(emb.tokens)}</div>
            <div className="muted small">input tokens</div>
          </div>
        </div>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Embedding model</th><th>Chunks</th><th>Tokens</th><th>Est. cost</th></tr></thead>
            <tbody>
              {emb.by_model.length === 0 && <tr><td className="dim" colSpan={5}>none embedded yet</td></tr>}
              {emb.by_model.map((r, i) => (
                <tr key={r.model + i}><td className="mx-rn">{i + 1}</td><td>{r.model}</td><td>{fmt(r.chunks)}</td><td>{fmt(r.tokens)}</td><td>{usd(r.cost_usd, 4)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">One-time index-build cost (embeddings bill input tokens only), <b>shared by the chatbot + email queue</b>. A chunk is re-embedded only on Reindex or an embedding-model change — it is not a per-conversation cost. Prices are set in Admin → Knowledge &amp; AI → Embedding models.</p>
      </div>

      {/* frequent channels (the Email Queue "by queue" analog) */}
      <ChartCard id="chart_cbx_channels" title="Frequent channels — questions (conversations / cost in table)" theme={theme} color={COL.q}
        labels={m.channels.map((c) => c.channel)} values={m.channels.map((c) => c.questions)}
        headers={['Channel', 'Conversations', 'Questions', 'Answers', 'Est cost']}
        rows={m.channels.map((c) => [c.channel, c.conversations, c.questions, c.answers, usd(c.cost_usd, 4)])} />

      {/* conversations worked — the Email Queue "Cases worked" analog (turns worked) */}
      <div className="mx-panel">
        <h2>Conversations worked</h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr>
              <th className="mx-rn">#</th><th>Conversation</th><th>Channel</th><th>Questions</th><th>Answers</th>
              <th>Grounded</th><th>Cost</th><th>Last seen</th><th>Type</th>
            </tr></thead>
            <tbody>
              {m.conversations_list.length === 0 && <tr><td className="dim" colSpan={9}>none</td></tr>}
              {m.conversations_list.map((c, i) => (
                <tr key={c.id + i}>
                  <td className="mx-rn">{i + 1}</td>
                  <td className="mono">{String(c.id).slice(0, 18)}</td>
                  <td>{c.channel || '—'}</td>
                  <td>{fmt(c.questions)}</td><td>{fmt(c.answers)}</td><td>{fmt(c.grounded)}</td>
                  <td>{usd(c.cost_usd, 4)}</td><td>{c.last_mtn || '—'}</td>
                  <td><span className={'mx-tag' + (c.is_test ? '' : ' new')}>{c.is_test ? 'test' : 'live'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* most-asked questions (the "frequent searched" ask) */}
      <div className="mx-panel">
        <h2>Most-asked questions</h2>
        <div className="mx-tablewrap">
          <table className="mx-utable">
            <thead><tr><th className="mx-rn">#</th><th>Question</th><th>Times asked</th></tr></thead>
            <tbody>
              {m.questions.length === 0 && <tr><td className="dim" colSpan={3}>none</td></tr>}
              {m.questions.map((q, i) => (
                <tr key={i}><td className="mx-rn">{i + 1}</td><td>{q.text}</td><td>{fmt(q.n)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Top user messages, normalized (case/space-insensitive). A high repeat count is a good candidate for a curated answer or correction.</p>
      </div>

      {/* SQL reference — DDL to recreate the tables + the exact metric queries, runnable by hand */}
      <SqlReference schema={m.schema} queries={m.queries} title="SQL reference" />

      {/* footer */}
      <p className="muted small" style={{ marginTop: 12 }}>
        Window: last {m.window.days} days
        {m.window.first_mtn ? ' · ' + m.window.first_mtn + ' → ' + (m.window.last_mtn || '') + ' MTN' : ''}
        {' · cost = tokens × per-model price; cached answers cost $0.'}
      </p>
    </>
  );
}
