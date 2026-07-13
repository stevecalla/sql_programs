import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// "Ask your data" — a faithful React port of the email-queue Ask box: model picker, raw-SQL toggle,
// follow-up conversation threads, suggestion chips, natural-language answers with a result table and
// collapsible SQL, and per-answer "Correct this" feedback.
const SUGGESTIONS = [
  'How many merges were executed per user in the last 30 days?',
  'Which panels are viewed most, in a table?',
  'Restore runs by day?',
  'Which filters are used most?',
  'Most recent active users, in a table?',
  'Data builds per day?',
];

function ResultTable({ rows }) {
  if (!rows || !rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="mx-tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}>
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (<tr key={i}>{cols.map((c) => <td key={c}>{r[c] == null ? '—' : String(r[c])}</td>)}</tr>))}
        </tbody>
      </table>
    </div>
  );
}

function Bubble({ turn, onCorrect }) {
  const [openCorrect, setOpenCorrect] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (!note.trim()) return;
    try { await api.metricsAskCorrect({ note, question: turn.question, answer: turn.answer }); setMsg('Saved — it will apply on the next ask.'); setNote(''); setOpenCorrect(false); onCorrect && onCorrect(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div className={'mx-ask-bubble' + (turn.error ? ' err' : '')}>
      <div className="mx-ask-bubble-top">
        <span className="q">Q: {turn.question}</span>
        <span className="meta">{turn.provider || ''}{turn.model ? ' · ' + turn.model : ''}</span>
      </div>
      {turn.error
        ? <div className="a" style={{ color: '#d32f2f' }}>{turn.error}</div>
        : <div className="a">{turn.answer}</div>}
      {!turn.error && <ResultTable rows={turn.rows} />}
      {!turn.error && turn.sql && (
        <details><summary>SQL</summary><pre>{turn.sql}</pre></details>
      )}
      {!turn.error && (
        <div className="mx-ask-correct">
          {!openCorrect && <button className="dl-link" onClick={() => setOpenCorrect(true)}>✎ Correct this</button>}
          {openCorrect && (
            <>
              <textarea rows={2} placeholder="What was wrong, or what should it know next time?" value={note} onChange={(e) => setNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn" onClick={save}>Save correction</button>
                <button className="dl-link" onClick={() => setOpenCorrect(false)}>Cancel</button>
                {msg && <span className="muted small">{msg}</span>}
              </div>
            </>
          )}
          {!openCorrect && msg && <span className="muted small" style={{ marginLeft: 8 }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

export default function AskData() {
  const [q, setQ] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [sqlMode, setSqlMode] = useState(false);
  const [convo, setConvo] = useState([]);       // [{question, answer, sql, rows, model, provider, error}]
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    api.metricsAskModels().then((r) => { setModels(r.models || []); setModel(r.default || (r.models && r.models[0] && r.models[0].id) || ''); if (!r.models || !r.models.length) setNoKey(true); }).catch(() => {});
  }, []);

  const autogrow = () => { const t = taRef.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight) + 'px'; } };

  const run = async (question) => {
    const text = (question != null ? question : q).trim();
    if (!text || busy) return;
    setBusy(true);
    const payload = sqlMode
      ? { mode: 'sql', sql: text, model }
      : { question: text, model, history: convo.filter((t) => !t.error).map((t) => ({ question: t.question, sql: t.sql })) };
    try {
      const r = await api.metricsAsk(payload);
      setConvo((c) => c.concat([{ question: sqlMode ? '(SQL) ' + text : text, answer: r.answer, sql: r.sql, rows: r.rows, row_count: r.row_count, model: r.model, provider: r.provider }]));
    } catch (e) {
      if (/AI key/i.test(e.message)) setNoKey(true);
      setConvo((c) => c.concat([{ question: text, error: e.message }]));
    } finally {
      setBusy(false); setQ(''); if (taRef.current) taRef.current.style.height = 'auto';
    }
  };

  const threadN = convo.filter((t) => !t.error).length;

  return (
    <div>
      <div className="mx-ask-box">
        <textarea ref={taRef} className="mx-ask-q" rows={1} value={q} placeholder={sqlMode ? 'Read-only SELECT over salesforce_merge_events…' : 'Ask about the usage data…  e.g. merges by user last week'}
          onChange={(e) => { setQ(e.target.value); autogrow(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }} />
        <div className="mx-ask-controls">
          <select value={model} onChange={(e) => setModel(e.target.value)} title="AI model">
            {models.length === 0 && <option value="">(no AI key)</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <label className={'mx-ask-sqltoggle mx-ask-chip' + (sqlMode ? ' on' : '')} title="Raw SQL mode — type a read-only SELECT instead of a question (guarded: SELECT-only, this table, capped).">
            <input type="checkbox" checked={sqlMode} onChange={(e) => setSqlMode(e.target.checked)} /> &lt;/&gt; SQL
          </label>
          {threadN > 0 && (
            <span className="mx-ask-chip mx-ask-threadchip" title="Follow-ups use the previous turns as context.">
              ↳ Follow-up ({threadN}) · <a onClick={() => setConvo([])}>new thread</a>
            </span>
          )}
          <span className="mx-ask-spacer" />
          <button className="btn" onClick={() => { setQ(''); if (taRef.current) taRef.current.style.height = 'auto'; }} title="Clear">✕</button>
          <button className="btn primary" style={{ width: 'auto', margin: 0 }} onClick={() => run()} disabled={busy || noKey}>{busy ? 'Asking…' : 'Ask'}</button>
        </div>
      </div>

      {noKey && <p className="muted small" style={{ marginTop: 8 }}>Ask-your-data needs an AI key — set <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> in the repo-root <code>.env</code>.</p>}

      <div className="mx-ask-suggest">
        {SUGGESTIONS.map((s) => <button key={s} onClick={() => { setQ(s); run(s); }} disabled={busy || noKey}>{s}</button>)}
      </div>

      {convo.length > 0 && (
        <>
          <div className="mx-ask-outbar">
            <button className="dl-link" onClick={() => setConvo([])}>Clear conversation</button>
          </div>
          <div className="mx-ask-thread">
            {convo.slice().reverse().map((t, i) => <Bubble key={convo.length - i} turn={t} />)}
          </div>
        </>
      )}
    </div>
  );
}
