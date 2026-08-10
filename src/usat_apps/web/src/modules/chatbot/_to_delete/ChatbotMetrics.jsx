import { useEffect, useState } from 'react';
import { Card } from './components/ui.jsx';
import { api } from './lib/api.js';
import './chatbot.css';

// Chatbot metrics page (mounted at /chatbot/metrics via nav.js). Reads GET /api/chatbot/metrics and renders
// usage, grounding, cost, frequent channels, and the most-asked questions — the chatbot analog of the email
// queue's Metrics page. Cost comes from the per-turn token capture in public.js (via services/ai cost_for).
const DAYS_OPTS = [7, 30, 90];
const num = (n) => (Number(n) || 0).toLocaleString();
const usd = (v, dp = 2) => '$' + (Number(v) || 0).toFixed(dp);

function Tile({ label, value, sub, accent }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--panel)', padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</div>
      <div className="cbx-dim" style={{ marginTop: 2 }}>{label}</div>
      {sub ? <div className="cbx-hint" style={{ marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}
function Th({ children, right }) {
  return <th style={{ textAlign: right ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, right, mono, colSpan, className }) {
  return <td colSpan={colSpan} className={className} style={{ textAlign: right ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: 13, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit' }}>{children}</td>;
}

export default function ChatbotMetrics() {
  const [days, setDays] = useState(30);
  const [test, setTest] = useState('all');   // 'all' | 'real' | 'test'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true); setErr('');
    const opts = { days };
    if (test === 'real') opts.test = 0; else if (test === 'test') opts.test = 1;
    api.metrics(opts)
      .then((r) => { if (live) { setData((r && r.metrics) || null); setLoading(false); } })
      .catch((e) => { if (live) { setErr((e && e.message) || 'Failed to load metrics'); setLoading(false); } });
    return () => { live = false; };
  }, [days, test]);

  const m = data;
  const maxTrend = (m && m.trend.length) ? Math.max(1, ...m.trend.map((d) => d.conversations)) : 1;

  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">AI Chat Bot <span className="cbx-pill">Metrics</span></h2>
        <span className="cbx-dim">Public widget usage, grounding, and AI cost{m && m.window ? ' · last ' + m.window.days + ' days' : ''}</span>
      </div>

      <div className="cbx-row-between" style={{ padding: '8px 14px', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {DAYS_OPTS.map((d) => (
            <button key={d} className={'cbx-segbtn' + (days === d ? ' on' : '')} style={{ minWidth: 60 }} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', 'All'], ['real', 'Live'], ['test', 'Test']].map((o) => (
            <button key={o[0]} className={'cbx-segbtn' + (test === o[0] ? ' on' : '')} style={{ minWidth: 60 }} onClick={() => setTest(o[0])}>{o[1]}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="cbx-dim" style={{ padding: 16 }}>Loading metrics…</div> : null}
      {err ? <div style={{ padding: 16, color: 'var(--danger, #c0392b)' }}>{err}</div> : null}

      {m && !loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 14px 20px', overflow: 'auto' }}>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Tile label="Conversations" value={num(m.overview.conversations)} />
            <Tile label="Questions asked" value={num(m.overview.questions)} />
            <Tile label="Grounded answers" value={m.overview.grounded_pct + '%'} sub={num(m.overview.grounded_answers) + ' of ' + num(m.overview.answers) + ' · ' + num(m.overview.deflected) + ' deflected'} />
            <Tile label="Avg response" value={num(m.overview.avg_latency_ms) + ' ms'} />
            <Tile label="Total AI cost" value={usd(m.cost.total_usd)} accent sub={'live ' + usd(m.cost.real_usd) + ' · test ' + usd(m.cost.test_usd)} />
            <Tile label="Cost / conversation" value={usd(m.cost.per_conversation_usd, 4)} sub={num(m.cost.prompt_tokens) + ' in / ' + num(m.cost.completion_tokens) + ' out tokens'} />
          </div>

          <Card title="Daily trend" open>
            {m.trend.length ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, padding: '6px 2px' }}>
                {m.trend.map((d) => (
                  <div key={d.day} title={d.day + ' · ' + num(d.conversations) + ' conv · ' + num(d.questions) + ' Q · ' + usd(d.cost_usd, 4)}
                    style={{ flex: 1, minWidth: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <div style={{ width: '100%', height: Math.round((d.conversations / maxTrend) * 100) + '%', background: 'var(--accent)', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                  </div>
                ))}
              </div>
            ) : <div className="cbx-dim">No activity in this window.</div>}
            <div className="cbx-hint">Bars = conversations per day. Hover a bar for questions + cost.</div>
          </Card>

          <Card title="Cost by model" open>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><Th>Model</Th><Th right>Calls</Th><Th right>Tokens (in / out)</Th><Th right>Cost</Th></tr></thead>
              <tbody>
                {m.cost.by_model.length ? m.cost.by_model.map((r) => (
                  <tr key={r.model}><Td mono>{r.model}</Td><Td right>{num(r.calls)}</Td><Td right>{num(r.prompt_tokens) + ' / ' + num(r.completion_tokens)}</Td><Td right>{usd(r.cost_usd, 4)}</Td></tr>
                )) : <tr><Td colSpan={4} className="cbx-dim">No AI calls yet in this window.</Td></tr>}
              </tbody>
            </table>
          </Card>

          <Card title="Sources & grounding" open summary={m.sources.grounded_pct + '% grounded'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Tile label="Grounded" value={num(m.sources.grounded)} />
              <Tile label="Ungrounded (deflected)" value={num(m.sources.ungrounded)} />
              <Tile label="Avg knowledge used" value={num(m.sources.avg_knowledge_chars) + ' ch'} />
              <Tile label="Avg corrections" value={num(m.sources.avg_corrections)} />
            </div>
            <div className="cbx-hint">“Grounded” = the answer came from curated knowledge; ungrounded answers are the polite “I don’t have that” deflections.</div>
          </Card>

          <Card title="Frequent channels" open>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><Th>Channel</Th><Th right>Conversations</Th><Th right>Questions</Th><Th right>Cost</Th></tr></thead>
              <tbody>
                {m.channels.length ? m.channels.map((r) => (
                  <tr key={r.channel}><Td>{r.channel}</Td><Td right>{num(r.conversations)}</Td><Td right>{num(r.questions)}</Td><Td right>{usd(r.cost_usd, 4)}</Td></tr>
                )) : <tr><Td colSpan={4} className="cbx-dim">No channels yet.</Td></tr>}
              </tbody>
            </table>
          </Card>

          <Card title="Most-asked questions" open>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><Th right>Count</Th><Th>Question</Th></tr></thead>
              <tbody>
                {m.questions.length ? m.questions.map((r, i) => (
                  <tr key={i}><Td right>{num(r.n)}</Td><Td>{r.text}</Td></tr>
                )) : <tr><Td right>0</Td><Td className="cbx-dim">No questions yet.</Td></tr>}
              </tbody>
            </table>
          </Card>

        </div>
      ) : null}
    </div>
  );
}
