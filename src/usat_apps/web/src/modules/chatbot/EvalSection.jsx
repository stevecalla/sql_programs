import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import './chatbot.css';

// Bot Trainer — stress test. Runs a labeled bank of questions (curated golden + off-topic, plus AI/log-derived)
// through the bot, grades each with a separate judge model, and shows a scorecard + a review queue that turns
// failures into corrections or bank entries. Runs are background jobs; we poll status. Mirrors the metrics look.
const CAT = {
  'correct-grounded': { label: '✅ grounded', c: '#16a34a', bg: 'rgba(22,163,74,.16)' },
  'correct-deflected': { label: '✅ deflected', c: '#0ea5a3', bg: 'rgba(14,165,163,.16)' },
  'weak': { label: '⚠️ weak', c: '#e0a200', bg: 'rgba(224,162,0,.16)' },
  'missed-gap': { label: '🕳️ gap', c: '#7c3aed', bg: 'rgba(124,58,237,.16)' },
  'wrong': { label: '❌ wrong', c: '#e0503a', bg: 'rgba(224,80,58,.18)' },
  'error': { label: '⚠︎ error', c: '#8ea0bd', bg: 'rgba(142,160,189,.14)' },
};
const grade = (s) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F');
const gradeColor = (s) => (s >= 80 ? '#16a34a' : s >= 60 ? '#e0a200' : '#e0503a');
const num = (n) => (Number(n) || 0).toLocaleString();
const usd = (v, d = 4) => '$' + (Number(v) || 0).toFixed(d);

const S = {
  panel: { border: '1px solid var(--line)', borderRadius: 12, background: 'var(--panel)', padding: '14px 16px', marginBottom: 14 },
  h: { fontSize: 15, fontWeight: 700, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' },
  f: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' },
  inp: { font: 'inherit', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--panel2, var(--bg))', color: 'var(--ink)' },
  btn: { cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' },
  btnP: { cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid #3b82f6', background: '#3b82f6', color: '#fff' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 },
  kpi: { border: '1px solid var(--line)', borderRadius: 11, background: 'var(--bg)', padding: '12px 14px' },
  bar: { height: 12, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--line)', overflow: 'hidden', flex: 1 },
  chip: (cat) => ({ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', color: (CAT[cat] || CAT.error).c, background: (CAT[cat] || CAT.error).bg, border: '1px solid ' + (CAT[cat] || CAT.error).c }),
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', whiteSpace: 'nowrap' },
  td: { padding: '8px 8px', borderBottom: '1px solid var(--line)', fontSize: 13, verticalAlign: 'top' },
  fbtn: (on) => ({ fontSize: 12, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', background: on ? '#152C53' : 'var(--bg)', color: on ? '#cfe0ff' : 'var(--muted)' }),
};

function Bar({ pct, color }) { return <div style={S.bar}><i style={{ display: 'block', height: '100%', width: Math.max(2, pct) + '%', background: color }} /></div>; }

export default function EvalSection() {
  const [models, setModels] = useState([]);
  const [queue, setQueue] = useState('');
  const [answerModel, setAnswerModel] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [batch, setBatch] = useState(100);
  const [onPct, setOnPct] = useState(70);
  const [src, setSrc] = useState({ golden: true, log: true, knowledge: true });
  const [run, setRun] = useState(null);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [bank, setBank] = useState({ golden: 0, offtopic: 0 });
  const [bankOpen, setBankOpen] = useState(false);
  const [bankRows, setBankRows] = useState(null);
  const [addQ, setAddQ] = useState({ question: '', bucket: 'golden', expected: 'answer', topic: '' });
  const [bulk, setBulk] = useState('');
  const [runs, setRuns] = useState([]);
  const [fixId, setFixId] = useState(-1);
  const [fixText, setFixText] = useState('');
  const [msg, setMsg] = useState('');
  const poll = useRef(null);

  useEffect(() => {
    api.aiModels().then((r) => { const list = r.models || r.ai_models || []; setModels(list); }).catch(() => {});
    api.evalLast().then((r) => { if (r.run) { setRun(r.run); setResults(r.results || []); } }).catch(() => {});
    api.evalQuestions().then((r) => setBank(r.count || { golden: 0, offtopic: 0 })).catch(() => {});
    api.evalRuns(12).then((r) => setRuns(r.runs || [])).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  const startRun = async () => {
    setErr(''); setMsg(''); setRunning(true); setProg({ graded: 0, total: batch });
    try {
      const r = await api.evalRun({ queue: queue || undefined, total: Number(batch) || 100, on_pct: Number(onPct), sources: src, answer_model: answerModel || undefined, judge_model: judgeModel || undefined });
      const rid = r.run_id;
      setProg({ graded: 0, total: r.total || batch });
      poll.current = setInterval(async () => {
        try {
          const st = await api.evalStatus(rid);
          if (st.progress) setProg({ graded: st.progress.graded, total: st.progress.total, cost: st.progress.cost_usd });
          const done = (st.run && st.run.status === 'done') || (st.progress && st.progress.status === 'done');
          const errored = (st.run && st.run.status === 'error') || (st.progress && st.progress.status === 'error');
          if (done || errored) {
            clearInterval(poll.current); poll.current = null; setRunning(false);
            if (errored) { setErr((st.run && st.run.error) || 'Run failed.'); return; }
            const d = await api.evalRunDetail(rid); setRun(d.run); setResults(d.results || []);
            api.evalRuns(12).then((x) => setRuns(x.runs || [])).catch(() => {});
          }
        } catch (e) { /* keep polling */ }
      }, 2000);
    } catch (e) { setRunning(false); setErr(e.message || 'Failed to start run.'); }
  };

  const rerun = async () => {
    if (!run) return;
    setErr(''); setRunning(true); setProg({ graded: 0, total: 0 });
    try { const r = await api.evalRerun(run.run_id); const rid = r.run_id; setProg({ graded: 0, total: r.total });
      poll.current = setInterval(async () => {
        try { const st = await api.evalStatus(rid);
          if (st.progress) setProg({ graded: st.progress.graded, total: st.progress.total });
          const done = st.run && st.run.status === 'done'; const errored = st.run && st.run.status === 'error';
          if (done || errored) { clearInterval(poll.current); poll.current = null; setRunning(false);
            if (errored) { setErr(st.run.error || 'Re-run failed.'); return; }
            const d = await api.evalRunDetail(rid); setRun(d.run); setResults(d.results || []); }
        } catch (e) {}
      }, 2000);
    } catch (e) { setRunning(false); setErr(e.message); }
  };

  const openBank = async () => {
    setBankOpen((o) => !o);
    if (!bankRows) { try { const r = await api.evalQuestions(); setBankRows(r.questions || []); setBank(r.count || bank); } catch (e) { setErr(e.message); } }
  };
  const reloadBank = async () => { const r = await api.evalQuestions(); setBankRows(r.questions || []); setBank(r.count || bank); };
  const addQuestion = async () => {
    if (!addQ.question.trim()) return;
    try { await api.evalAddQuestions(addQ); setAddQ({ question: '', bucket: addQ.bucket, expected: addQ.bucket === 'offtopic' ? 'deflect' : 'answer', topic: '' }); reloadBank(); setMsg('Added.'); } catch (e) { setErr(e.message); }
  };
  const addBulk = async () => {
    const lines = bulk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const questions = lines.map((l) => { const [q, expected, topic] = l.split('|').map((x) => (x || '').trim()); return { question: q, bucket: expected === 'deflect' ? 'offtopic' : (addQ.bucket || 'golden'), expected: expected || (addQ.bucket === 'offtopic' ? 'deflect' : 'answer'), topic: topic || '' }; });
    try { const r = await api.evalAddQuestions({ questions }); setBulk(''); reloadBank(); setMsg('Added ' + r.added + ' (skipped ' + r.skipped + ').'); } catch (e) { setErr(e.message); }
  };
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const start = /question/i.test(rows[0] || '') ? 1 : 0;   // skip a header row
        const questions = rows.slice(start).map((line) => {
          const cells = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
          return { question: cells[0], expected: cells[1] || 'answer', topic: cells[2] || '', bucket: (cells[3] || (cells[1] === 'deflect' ? 'offtopic' : 'golden')) };
        }).filter((q) => q.question);
        const r = await api.evalAddQuestions({ questions }); reloadBank(); setMsg('Imported ' + r.added + ' question(s).');
      } catch (x) { setErr('CSV import failed: ' + (x.message || x)); }
    };
    reader.readAsText(file); e.target.value = '';
  };
  const delQuestion = async (id) => { try { await api.evalDeleteQuestion(id); reloadBank(); } catch (e) { setErr(e.message); } };
  const promote = async (r) => { try { await api.evalPromote({ question: r.question, expected: r.expected, topic: r.topic, bucket: r.expected === 'deflect' ? 'offtopic' : 'golden', queue: (run && run.queue) || undefined }); setMsg('Added to bank.'); } catch (e) { setErr(e.message); } };
  const saveCorrection = async (r) => {
    if (!fixText.trim()) return;
    try { await api.addCorrection({ queue: (run && run.queue) || undefined, note: 'Q: ' + r.question + '\nCorrect answer: ' + fixText.trim(), scope: 'queue' }); setFixId(-1); setFixText(''); setMsg('Correction saved.'); } catch (e) { setErr(e.message); }
  };

  const shown = results.filter((r) => filter === 'all' ? true
    : filter === 'failures' ? (r.category === 'wrong' || r.category === 'error')
    : filter === 'gaps' ? r.category === 'missed-gap'
    : filter === 'weak' ? r.category === 'weak'
    : filter === 'offtopic' ? r.expected === 'deflect' : true);
  const counts = results.reduce((m, r) => { m[r.category] = (m[r.category] || 0) + 1; return m; }, {});
  const projected = (Number(batch) || 0) * 0.002;
  const maxRun = Math.max(1, ...runs.map((r) => Number(r.score_overall) || 0));

  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">Bot Trainer <span className="cbx-pill">Stress test</span></h2>
        <span className="cbx-dim">Runs a labeled question bank through the bot, grades each answer, and turns failures into corrections.</span>
      </div>

      <div style={{ padding: '0 14px 24px', overflow: 'auto' }}>
        {err ? <div style={{ ...S.panel, color: '#e0503a', borderColor: '#e0503a' }}>{err}</div> : null}

        {/* RUN CONTROL */}
        <div style={S.panel}>
          <h2 style={S.h}>Run stress test <span className="cbx-pill">test channel · is_test=1</span></h2>
          <div style={S.row}>
            <label style={S.f}>Queue (bot)<input style={{ ...S.inp, minWidth: 140 }} placeholder="Team USA" value={queue} onChange={(e) => setQueue(e.target.value)} /></label>
            <label style={S.f}>Answering model
              <select style={S.inp} value={answerModel} onChange={(e) => setAnswerModel(e.target.value)}>
                <option value="">(default)</option>
                {models.map((m) => <option key={m.model} value={m.model}>{m.label || m.model}</option>)}
              </select>
            </label>
            <label style={S.f}>Judge model
              <select style={S.inp} value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)}>
                <option value="">(default · impartial)</option>
                {models.map((m) => <option key={m.model} value={m.model}>{m.label || m.model}</option>)}
              </select>
            </label>
            <label style={S.f}>Batch<input type="number" min="2" max="300" style={{ ...S.inp, width: 72 }} value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
            <label style={S.f}>On-topic %<input type="number" min="0" max="100" style={{ ...S.inp, width: 72 }} value={onPct} onChange={(e) => setOnPct(e.target.value)} /></label>
            <div style={S.f}>Sources
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                {['golden', 'log', 'knowledge'].map((k) => <label key={k} style={{ fontSize: 12, color: 'var(--ink)', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={!!src[k]} onChange={(e) => setSrc((s) => ({ ...s, [k]: e.target.checked }))} />{k}</label>)}
              </div>
            </div>
            <button style={{ ...S.btnP, opacity: running ? 0.6 : 1 }} disabled={running} onClick={startRun}>{running ? 'Running…' : '▶ Run stress test'}</button>
            <span className="cbx-dim" style={{ fontSize: 12 }}>~{usd(projected, 2)} · a minute or two</span>
          </div>
          {running && prog ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}><span>Grading… {num(prog.graded)} / {num(prog.total)}</span><span>{prog.cost != null ? usd(prog.cost, 4) : ''}</span></div>
              <Bar pct={prog.total ? (prog.graded / prog.total) * 100 : 4} color="#3b82f6" />
            </div>
          ) : null}
          {msg ? <div className="cbx-dim" style={{ marginTop: 8, color: '#16a34a', fontSize: 12 }}>{msg}</div> : null}
        </div>

        {/* SCORECARD */}
        {run ? (
          <div style={S.panel}>
            <h2 style={S.h}>Last run scorecard
              <span style={{ marginLeft: 6, fontWeight: 800, fontSize: 15, padding: '2px 9px', borderRadius: 8, color: '#fff', background: gradeColor(run.score_overall) }}>{grade(run.score_overall)} · {num(run.score_overall)}</span>
              <button style={{ ...S.btn, marginLeft: 'auto', fontSize: 12 }} disabled={running} onClick={rerun}>↻ Re-run failures</button>
            </h2>
            <div className="cbx-dim" style={{ fontSize: 12, marginBottom: 8 }}>{num(run.total)} questions · {num(run.on_topic)} on / {num(run.off_topic)} off · {run.answer_model} · {run.created_at_mtn} MTN · {usd(run.cost_usd)}</div>
            <div style={S.kpis}>
              <div style={S.kpi}><div style={{ fontSize: 28, fontWeight: 800 }}>{num(run.score_overall)}<span className="cbx-dim" style={{ fontSize: 15 }}>/100</span></div><div className="cbx-dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>Overall score</div></div>
              <div style={S.kpi}><div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a' }}>{num(run.coverage_pct)}%</div><div className="cbx-dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>Coverage · on-topic grounded</div></div>
              <div style={S.kpi}><div style={{ fontSize: 28, fontWeight: 800, color: '#0ea5a3' }}>{num(run.safety_pct)}%</div><div className="cbx-dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>Safety · off-topic deflected</div></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {['correct-grounded', 'correct-deflected', 'weak', 'missed-gap', 'wrong', 'error'].filter((k) => counts[k]).map((k) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span><span style={S.chip(k)}>{CAT[k].label}</span></span>
                  <Bar pct={results.length ? (counts[k] / results.length) * 100 : 0} color={CAT[k].c} />
                  <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{counts[k]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* RESULTS / REVIEW */}
        {results.length ? (
          <div style={S.panel}>
            <h2 style={S.h}>Results — review &amp; fix</h2>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {[['all', 'All ' + results.length], ['failures', 'Failures ' + ((counts.wrong || 0) + (counts.error || 0))], ['gaps', 'Gaps ' + (counts['missed-gap'] || 0)], ['weak', 'Weak ' + (counts.weak || 0)], ['offtopic', 'Off-topic ' + results.filter((r) => r.expected === 'deflect').length]].map(([k, lbl]) => (
                <span key={k} style={S.fbtn(filter === k)} onClick={() => setFilter(k)}>{lbl}</span>
              ))}
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={S.th}>Question</th><th style={S.th}>Expect</th><th style={S.th}>Outcome</th><th style={S.th}>Gr.</th><th style={S.th}>Score</th><th style={S.th}>Fix</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>
                      <td style={S.td}>{r.question}<div className="cbx-dim" style={{ fontSize: 11 }}>{r.topic || ''}{r.source ? ' · ' + r.source : ''}</div>
                        {fixId === i ? (
                          <div style={{ marginTop: 6 }}>
                            <textarea style={{ ...S.inp, width: '100%', minHeight: 54 }} placeholder="Correct answer to teach the bot…" value={fixText} onChange={(e) => setFixText(e.target.value)} />
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}><button style={S.btnP} onClick={() => saveCorrection(r)}>Save correction</button><button style={S.btn} onClick={() => { setFixId(-1); setFixText(''); }}>Cancel</button></div>
                          </div>
                        ) : null}
                      </td>
                      <td style={{ ...S.td, color: 'var(--muted)', fontSize: 11 }}>{r.expected}</td>
                      <td style={S.td}><span style={S.chip(r.category)}>{(CAT[r.category] || CAT.error).label}</span></td>
                      <td style={{ ...S.td, color: 'var(--muted)' }}>{r.expected === 'deflect' ? '—' : (r.grounded ? 'yes' : 'no')}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: gradeColor(r.score) }}>{num(r.score)}</td>
                      <td style={S.td}>
                        {(r.category === 'wrong' || r.category === 'weak' || r.category === 'missed-gap') && r.expected !== 'deflect'
                          ? <button style={{ ...S.btn, fontSize: 12, padding: '4px 9px' }} onClick={() => { setFixId(fixId === i ? -1 : i); setFixText(''); }}>+ Correction</button>
                          : <button style={{ ...S.btn, fontSize: 12, padding: '4px 9px' }} onClick={() => promote(r)}>+ Bank</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cbx-dim" style={{ fontSize: 11, marginTop: 8 }}>Nothing changes the bot until you approve it — <b>+ Correction</b> saves a scoped correction; <b>+ Bank</b> adds the question to the curated set so it's always tested.</div>
          </div>
        ) : null}

        {/* QUESTION BANK */}
        <div style={S.panel}>
          <h2 style={{ ...S.h, cursor: 'pointer' }} onClick={openBank}>Question bank <span className="cbx-pill">{bank.golden} golden · {bank.offtopic} off-topic</span><span style={{ marginLeft: 'auto', fontSize: 13 }}>{bankOpen ? '− Hide' : '+ Manage'}</span></h2>
          {bankOpen ? (
            <>
              <div style={{ ...S.row, marginBottom: 10 }}>
                <label style={S.f}>Question<input style={{ ...S.inp, minWidth: 280 }} value={addQ.question} onChange={(e) => setAddQ({ ...addQ, question: e.target.value })} placeholder="How much are annual dues?" /></label>
                <label style={S.f}>Bucket<select style={S.inp} value={addQ.bucket} onChange={(e) => setAddQ({ ...addQ, bucket: e.target.value, expected: e.target.value === 'offtopic' ? 'deflect' : 'answer' })}><option value="golden">golden (answer)</option><option value="offtopic">off-topic (deflect)</option></select></label>
                <label style={S.f}>Topic<input style={{ ...S.inp, width: 130 }} value={addQ.topic} onChange={(e) => setAddQ({ ...addQ, topic: e.target.value })} placeholder="membership" /></label>
                <button style={S.btnP} onClick={addQuestion}>+ Add</button>
                <label style={{ ...S.btn, cursor: 'pointer' }}>⬆ Import CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFile} /></label>
              </div>
              <div style={{ ...S.f, marginBottom: 10 }}>Bulk paste — one per line, <span className="mono">question | expected | topic</span>
                <textarea style={{ ...S.inp, width: '100%', minHeight: 60, marginTop: 4 }} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'How do I renew? | answer | membership\nWhat is the weather? | deflect | off-topic'} />
                <div><button style={{ ...S.btn, marginTop: 4 }} onClick={addBulk}>Add pasted</button></div>
              </div>
              <div style={{ overflow: 'auto', maxHeight: 260 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={S.th}>Question</th><th style={S.th}>Bucket</th><th style={S.th}>Expect</th><th style={S.th}>Topic</th><th style={S.th}></th></tr></thead>
                  <tbody>
                    {(bankRows || []).map((r) => (
                      <tr key={r.id}><td style={S.td}>{r.question}</td><td style={{ ...S.td, color: 'var(--muted)' }}>{r.bucket}</td><td style={{ ...S.td, color: 'var(--muted)' }}>{r.expected}</td><td style={{ ...S.td, color: 'var(--muted)' }}>{r.topic || ''}</td>
                        <td style={S.td}>{r.locked ? <span className="cbx-dim">locked</span> : <button style={{ ...S.btn, fontSize: 12, padding: '3px 8px' }} onClick={() => delQuestion(r.id)}>remove</button>}</td></tr>
                    ))}
                    {(bankRows && !bankRows.length) ? <tr><td style={S.td} colSpan={5}><span className="cbx-dim">Empty — add golden + off-topic questions above. The stress test falls back to a built-in off-topic set until you add your own.</span></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        {/* TREND */}
        {runs.length > 1 ? (
          <div style={S.panel}>
            <h2 style={S.h}>Score trend <span className="cbx-pill">last {runs.length} runs</span></h2>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 70 }}>
              {runs.slice().reverse().map((r, i) => (
                <div key={i} title={(r.created_at_mtn || '') + ' · ' + num(r.score_overall)} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
                  <span className="cbx-dim" style={{ fontSize: 10 }}>{num(r.score_overall)}</span>
                  <div style={{ width: '100%', height: Math.round(((Number(r.score_overall) || 0) / maxRun) * 100) + '%', minHeight: 4, background: 'linear-gradient(180deg,#3b82f6,#274a86)', borderRadius: '3px 3px 0 0' }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
