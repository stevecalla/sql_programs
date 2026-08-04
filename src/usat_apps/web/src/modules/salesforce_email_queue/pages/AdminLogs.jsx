import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Logs. Ported 1:1 from the standalone /admin Logs pane: a pm2 process card and a
// live-streaming server console tail (SSE). Admin-only (the route is require_admin server-side).

const TERM_STYLE = {
  background: '#0b0f16', color: '#cbd5e1', fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
  fontSize: 12, padding: '10px 12px', borderRadius: 8, minHeight: 300, maxHeight: '60vh',
  overflow: 'auto', whiteSpace: 'pre-wrap', resize: 'vertical',
};
const MAX_LINES = 600;

function fmtUptime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d + 'd ' + h + 'h';
}

function Pm2Card() {
  const [pm2, setPm2] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.adminPm2().then(setPm2).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="card">
      <h3>Process (pm2)</h3>
      {err && <p className="err">{err}</p>}
      {!err && !pm2 && <p className="muted">Loading…</p>}
      {!err && pm2 && !pm2.under_pm2 && (
        <p className="muted small">Not running under pm2 ({pm2.reason}) — the console tail below still works.</p>
      )}
      {!err && pm2 && pm2.under_pm2 && (
        <div className="mx-cards">
          <div className="mx-card">
            <div className="k">Status</div>
            <div className="v"><span style={{ color: pm2.status === 'online' ? '#16a34a' : '#d32f2f', fontWeight: 700 }}>{pm2.status}</span></div>
            <div className="s">{pm2.name}</div>
          </div>
          <div className="mx-card">
            <div className="k">Uptime</div>
            <div className="v">{fmtUptime(pm2.uptime_ms)}</div>
            <div className="s">since restart</div>
          </div>
          <div className="mx-card">
            <div className="k">Restarts</div>
            <div className="v">{pm2.restarts}</div>
            <div className="s">count</div>
          </div>
          <div className="mx-card">
            <div className="k">CPU</div>
            <div className="v">{pm2.cpu}%</div>
            <div className="s">pid {pm2.pid}</div>
          </div>
          <div className="mx-card">
            <div className="k">Memory</div>
            <div className="v">{Math.round((pm2.memory_bytes || 0) / 1048576)} MB</div>
            <div className="s">rss</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConsoleCard() {
  const [lines, setLines] = useState([]); // [{level, text}]
  const [live, setLive] = useState(false);
  const esRef = useRef(null);
  const termRef = useRef(null);

  const open = () => {
    if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } }
    setLive(false);
    const es = new EventSource(api.adminLogsStreamUrl());
    esRef.current = es;
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // browser auto-reconnects
    es.addEventListener('line', (e) => {
      const { at, level, line } = JSON.parse(e.data);
      const text = String(at || '').slice(11, 19) + ' ' + line;
      setLines((prev) => {
        const next = prev.concat([{ level, text }]);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
  };

  useEffect(() => {
    open();
    return () => { if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } } };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [lines]);

  const color = (level) => (level === 'error' ? '#ff8a8a' : level === 'warn' ? '#e0a200' : '#cbd5e1');

  return (
    <div className="card">
      <h3>Server console — auto-streaming</h3>
      <div className="rowform small" style={{ alignItems: 'center' }}>
        <span style={{ color: live ? '#16a34a' : '#888', fontWeight: 700 }}>{live ? '● live' : '○ reconnecting'}</span>
        <button className="btn" onClick={open}>↻ Reconnect</button>
      </div>
      <div ref={termRef} style={{ ...TERM_STYLE, marginTop: 8 }}>
        {lines.length === 0
          ? 'Waiting for output…'
          : lines.map((l, i) => <div key={i} style={{ color: color(l.level) }}>{l.text}</div>)}
      </div>
    </div>
  );
}

export default function AdminLogs() {
  return (
    <div className="page">
      <h2>Email Queue · Logs</h2>
      <Pm2Card />
      <ConsoleCard />
    </div>
  );
}
