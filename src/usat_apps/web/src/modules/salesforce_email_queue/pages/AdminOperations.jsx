import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Operations (the console). Ported 1:1 from the standalone /admin Operations pane:
// server-side commands run by id from an allow-list (no shell), with live stdout/stderr streamed over SSE
// into a terminal box. Read-only except the metrics purge/cleanup items, which confirm. Admin-only.

const TERM_STYLE = {
  background: '#0b0f16', color: '#cbd5e1', fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
  fontSize: 12, padding: '10px 12px', borderRadius: 8, minHeight: 300, maxHeight: '60vh',
  overflow: 'auto', whiteSpace: 'pre-wrap', resize: 'vertical',
};

function klassBadge(klass) {
  if (!klass || klass === 'na') return null;
  const color = klass === 'destruct' ? '#d32f2f' : klass === 'mutate' ? '#b7791f' : '#888';
  return <span className="small" style={{ marginLeft: 8, color, fontWeight: 700 }}>{klass}</span>;
}

// Inline param form for web:'form' items (e.g. the Ask-your-data command). Renders each param as a text
// input or enum select (seeded from its default), then hands the collected values to onRun.
function OpsForm({ item, running, onRun }) {
  const [vals, setVals] = useState(() => {
    const o = {};
    (item.params || []).forEach((p) => { o[p.name] = p.default != null ? String(p.default) : ''; });
    return o;
  });
  const set = (name, v) => setVals((s) => ({ ...s, [name]: v }));
  return (
    <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      {(item.params || []).map((p) => (
        <label key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted">{p.label || p.name}{p.required ? ' *' : ''}</span>
          {p.type === 'enum'
            ? (
              <select value={vals[p.name]} onChange={(e) => set(p.name, e.target.value)}>
                {(p.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type="text" value={vals[p.name]} onChange={(e) => set(p.name, e.target.value)} style={{ minWidth: 240 }} />
            )}
        </label>
      ))}
      <button className="btn" disabled={running} onClick={() => onRun(vals)}>Run</button>
    </div>
  );
}

export default function AdminOperations() {
  const [sections, setSections] = useState(null);
  const [err, setErr] = useState('');
  const [showCli, setShowCli] = useState(false);
  const [open, setOpen] = useState({}); // section index -> bool (start collapsed)
  const [runStatus, setRunStatus] = useState('No command running.');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]); // [{stream, line}]

  const esRef = useRef(null);
  const runIdRef = useRef(null);
  const termRef = useRef(null);

  useEffect(() => {
    api.adminConsoleCommands().then((r) => setSections(r.sections || [])).catch((e) => setErr(e.message));
  }, []);

  // auto-scroll terminal to bottom as lines arrive
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [lines]);

  // cleanup on unmount
  useEffect(() => () => { if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } } }, []);

  const opsRun = async (item, params = {}) => {
    let confirm;
    if (item.klass === 'destruct') {
      if (!window.confirm('This is destructive: ' + item.label + '\nRun it now?')) return;
      confirm = item.id;
    }
    // close any existing stream, reset terminal
    if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } esRef.current = null; }
    setLines([]);
    setRunStatus('Running: ' + item.label + '…');
    setRunning(true);

    let r;
    try {
      r = await api.adminConsoleRun({ id: item.id, params, confirm });
    } catch (e) {
      setLines([{ stream: 'err', line: e.message }]);
      setRunStatus('No command running.');
      setRunning(false);
      return;
    }
    if (!r || !r.ok) {
      setLines([{ stream: 'err', line: (r && r.error) || 'Failed to start.' }]);
      setRunStatus('No command running.');
      setRunning(false);
      return;
    }

    runIdRef.current = r.run_id;
    const es = new EventSource(api.adminConsoleStreamUrl(r.run_id));
    esRef.current = es;

    es.addEventListener('line', (e) => {
      const { stream, line } = JSON.parse(e.data);
      setLines((prev) => prev.concat([{ stream, line }]));
    });
    es.addEventListener('exit', (e) => {
      const { status, code, capped } = JSON.parse(e.data);
      setRunStatus('Finished: ' + status + ' (code ' + code + ')' + (capped ? ' · output truncated' : ''));
      setRunning(false);
      try { es.close(); } catch (er) { /* noop */ }
    });
    es.onerror = () => { /* leave it; the server closes on exit */ };
  };

  const kill = async () => {
    if (!runIdRef.current) return;
    try { await api.adminConsoleKill(runIdRef.current); } catch (e) { /* noop */ }
  };

  const lineColor = (stream) => (stream === 'err' ? '#ff8a8a' : stream === 'meta' ? '#7aa2f7' : '#cbd5e1');

  return (
    <div className="page">
      <h2>Email Queue · Operations</h2>

      <div className="card">
        <h3>Operations — run commands here; output streams live</h3>
        <label className="rowform small" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={showCli} onChange={(e) => setShowCli(e.target.checked)} /> show $ commands
        </label>
        <p className="muted small">Commands run server-side with no shell, by id from an allow-list (admin only). Read-only except the metrics purge/cleanup items, which ask to confirm.</p>
        <div className="small" style={{ marginTop: 8 }}>{runStatus}{running && <button className="btn warn" style={{ marginLeft: 10 }} onClick={kill}>Kill</button>}</div>
        <div ref={termRef} style={{ ...TERM_STYLE, marginTop: 8 }}>
          {lines.length === 0
            ? 'Pick a command below to run it.'
            : lines.map((l, i) => <div key={i} style={{ color: lineColor(l.stream) }}>{l.line}</div>)}
        </div>
      </div>

      {err && <div className="card"><p className="err">{err}</p></div>}
      {!err && !sections && <div className="card"><p className="muted">Loading…</p></div>}
      {!err && sections && sections.map((sec, si) => (
        <div className="card" key={si}>
          <h3 style={{ cursor: 'pointer', margin: 0 }} onClick={() => setOpen((o) => ({ ...o, [si]: !o[si] }))}>
            {open[si] ? '▾' : '▸'} {sec.label}
          </h3>
          {open[si] && (
            <div style={{ marginTop: 8 }}>
              {(sec.items || []).map((item) => (
                <div key={item.id} style={{ padding: '8px 0', borderTop: '1px solid #eee' }}>
                  <div>
                    <b>{item.id}. {item.label}</b>{klassBadge(item.klass)}
                  </div>
                  {item.desc && <div className="muted small" style={{ marginTop: 2 }}>{item.desc}</div>}
                  {showCli && item.cli && (
                    <div className="small" style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', marginTop: 4 }}>$ {item.cli}</div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    {item.web === 'terminal'
                      ? <span className="muted small">{item.note}</span>
                      : item.web === 'form'
                        ? <OpsForm item={item} running={running} onRun={(p) => opsRun(item, p)} />
                        : item.web === 'run'
                          ? <button className="btn" onClick={() => opsRun(item)} disabled={running}>Run</button>
                          : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
