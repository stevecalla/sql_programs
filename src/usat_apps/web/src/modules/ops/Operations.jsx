import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Operations — the fleet command runner. Reads the allow-listed catalog (/api/ops/console) and
// runs an item by id (/api/ops/console/run). Destructive/confirm items prompt first; form items collect
// a validated param; streaming items are greyed (run in a terminal). Mirrors the proxy console.
const BADGE = {
  test: ['rgba(59,130,246,.16)', '#2563eb'],
  mutate: ['rgba(212,146,10,.20)', '#b45309'],
  read: ['rgba(100,116,139,.18)', 'var(--muted)'],
  destruct: ['rgba(194,14,47,.15)', '#c20e2f'],
  na: ['rgba(100,116,139,.14)', 'var(--muted)'],
};

export default function OpsOperations() {
  const [sections, setSections] = useState(null);
  const [showCli, setShowCli] = useState(false);
  const [status, setStatus] = useState('No command running.');
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState({});
  const [open, setOpen] = useState({});   // section label -> expanded; collapsed by default
  const outRef = useRef(null);
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

  useEffect(() => {
    api.opsConsole().then((r) => { if (r.status === 200 && r.body.ok) setSections(r.body.sections || []); else setStatus(r.body.error || ('HTTP ' + r.status)); }).catch((e) => setStatus(String(e)));
  }, []);
  const setOut = (text) => { if (outRef.current) outRef.current.textContent = text; };

  const runItem = async (item) => {
    if (item.confirm && !window.confirm('Run "' + item.label + '"? This is a ' + item.klass + ' action.')) return;
    const p = params[item.id] || {};
    if ((item.params || []).some((pp) => pp.required && !(p[pp.name] && String(p[pp.name]).trim()))) { setStatus('Fill the required field first.'); return; }
    setBusy(true); setStatus('Running "' + item.label + '"…'); setOut('Running…');
    const r = await api.opsConsoleRun({ id: item.id, params: p, confirm: !!item.confirm });
    setBusy(false);
    const b = r.body || {};
    setStatus(b.ok ? '✓ ' + item.label + ' done' + (b.code != null ? ' (exit ' + b.code + ')' : '') : '✗ ' + item.label + (b.error ? ': ' + b.error : ' failed'));
    setOut(b.output || b.error || '(no output)');
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Operations <span className="muted small" style={{ fontWeight: 400 }}>— run menu commands here; output captured</span></h2>
        <label className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={showCli} onChange={(e) => setShowCli(e.target.checked)} /> show $ commands</label>
      </div>
      <p className="muted small">Commands run server-side from an allow-list (admin only), no shell on the server. Destructive ones confirm first. Interactive/streaming items are greyed — run those from a terminal.</p>
      <p className="muted small" style={{ marginTop: -4 }}>Links: <a href={base + '/api/status'} target="_blank" rel="noopener">/api/status ↗</a>{' · '}<a href={base + '/api/ops/health'} target="_blank" rel="noopener">/api/ops/health ↗</a></p>
      <p className="muted small" style={{ marginTop: -4 }}>{status}</p>
      <div ref={outRef} className="term" style={{ height: 260, marginBottom: 16 }}>Pick a command below to run it.</div>

      {!sections ? <div className="muted">Loading…</div> : sections.map((s) => {
        const isOpen = !!open[s.label];
        return (
        <div className="card" key={s.label} style={{ padding: '10px 14px' }}>
          <button type="button" onClick={() => setOpen((o) => ({ ...o, [s.label]: !o[s.label] }))} aria-expanded={isOpen}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '2px 0', border: 'none', background: 'none', color: 'var(--ink)', cursor: 'pointer', font: 'inherit' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</span>
            <span className="rail-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          </button>
          {isOpen && s.items.map((it) => {
            const runnable = it.web === 'run' || it.web === 'form';
            const bc = BADGE[it.klass] || BADGE.na;
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap', opacity: runnable ? 1 : 0.55 }}>
                <div style={{ flex: '1 1 300px' }}>
                  <div style={{ fontWeight: 700 }}>{it.id}. {it.label} <span style={{ display: 'inline-block', padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: bc[0], color: bc[1] }}>{it.klass}</span></div>
                  <div className="muted small">{it.desc}{it.note ? ' — ' + it.note : ''}{showCli && it.cli ? <> · <code>{it.cli}</code></> : null}</div>
                </div>
                {it.web === 'form' ? (it.params || []).map((pp) => (
                  <input key={pp.name} placeholder={pp.label} value={(params[it.id] && params[it.id][pp.name]) || ''} onChange={(e) => setParams((cur) => ({ ...cur, [it.id]: { ...(cur[it.id] || {}), [pp.name]: e.target.value } }))} style={{ minWidth: 180 }} />
                )) : null}
                {runnable
                  ? <button className="btn primary" disabled={busy} onClick={() => runItem(it)}>Run</button>
                  : it.web === 'link'
                    ? <a className="btn" href={base + (it.href || '')} target="_blank" rel="noopener">Open ↗</a>
                    : <span className="muted small">terminal</span>}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}
