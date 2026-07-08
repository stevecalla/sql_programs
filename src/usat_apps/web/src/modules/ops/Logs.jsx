import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Logs — pick a pm2 process → its status tiles + a single-process live console (SSE), mirroring
// the proxy console's Logs pane: dropdown, ● live, Reconnect, ⤒ top / ⤓ bottom, copy, ⤢ expand, and a
// drag-to-resize log body.
const LS_SEL = 'usatapps_ops_logs_sel';
function fmtUptime(ms) { if (ms == null) return '—'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); if (d) return d + 'd ' + h + 'h'; if (h) return h + 'h ' + m + 'm'; if (m) return m + 'm'; return s + 's'; }
function lineClass(line) {
  if (/error|ECONNREFUSED|SERVER ERROR|✗|failed/i.test(line)) return 'l-err';
  if (/CLIENT ERROR|WARN|warning/i.test(line)) return 'l-sys';
  if (/\bOK\b|✓|online|listening|ready|Serving/i.test(line)) return 'l-ok';
  if (/^\s*(>>|<<)/.test(line) || /\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b/.test(line)) return 'l-meta';
  return '';
}

export default function OpsLogs() {
  const [procs, setProcs] = useState(null);
  const [sel, setSel] = useState(() => { try { return localStorage.getItem(LS_SEL) || ''; } catch (e) { return ''; } });
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const logRef = useRef(null);
  const esRef = useRef(null);

  const loadProcs = () => {
    api.opsPm2().then((r) => {
      if (r.status === 200 && r.body.ok) {
        const ps = r.body.processes || []; setProcs(ps);
        setSel((cur) => (cur || (ps[0] && ps[0].name) || ''));
      }
    }).catch(() => {});
  };
  useEffect(() => { loadProcs(); const id = setInterval(loadProcs, 30000); return () => clearInterval(id); }, []);

  const selProc = useMemo(() => (procs || []).find((p) => p.name === sel) || null, [procs, sel]);

  const appendLine = (line) => {
    const o = logRef.current; if (!o) return;
    if (o.dataset.fresh !== '1') { o.textContent = ''; o.dataset.fresh = '1'; }
    const atBottom = o.scrollHeight - o.scrollTop - o.clientHeight < 40;
    const div = document.createElement('div'); const cls = lineClass(line); if (cls) div.className = cls; div.textContent = line;
    o.appendChild(div); while (o.childNodes.length > 1000) o.removeChild(o.firstChild);
    if (atBottom) o.scrollTop = o.scrollHeight;
  };
  const openStream = (name) => {
    if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } esRef.current = null; }
    const o = logRef.current; if (o) { o.textContent = 'Loading ' + name + '…'; o.dataset.fresh = ''; }
    setLive(false);
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    let es;
    try { es = new EventSource(base + '/api/ops/logs/stream?name=' + encodeURIComponent(name)); } catch (e) { return; }
    esRef.current = es;
    es.onopen = () => setLive(true);
    es.addEventListener('line', (ev) => { try { appendLine(JSON.parse(ev.data).line); } catch (e) { /* skip */ } });
    es.onerror = () => setLive(false);
  };
  useEffect(() => {
    if (sel) { openStream(sel); try { localStorage.setItem(LS_SEL, sel); } catch (e) { /* ignore */ } }
    return () => { if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } } };
  }, [sel]);

  const copyLog = () => { try { navigator.clipboard.writeText(logRef.current ? logRef.current.innerText : ''); } catch (e) { /* ignore */ } };
  const tiles = selProc ? [
    ['Status', selProc.status], ['Uptime', fmtUptime(selProc.uptime_ms)], ['Restarts', selProc.restarts],
    ['CPU', selProc.cpu != null ? selProc.cpu + '%' : '—'], ['Memory', selProc.memory_mb != null ? selProc.memory_mb + ' MB' : '—'], ['PID', selProc.pid],
  ] : [];

  return (
    <div className="page">
      <h2>Logs</h2>

      <div className="card">
        <h3>Process (pm2)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {tiles.length ? tiles.map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="muted small">{k}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {k === 'Status'
                  ? <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: v === 'online' ? 'rgba(22,121,74,.15)' : 'rgba(194,14,47,.15)', color: v === 'online' ? '#16794a' : 'var(--red)' }}>{v || '—'}</span>
                  : (v == null ? '—' : String(v))}
              </div>
            </div>
          )) : <div className="muted">Pick a process…</div>}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Server console <span className="muted small" style={{ fontWeight: 400 }}>— auto-streaming (drag the bottom edge to resize)</span></h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {(procs || []).map((p) => <option key={(p.pm_id != null ? p.pm_id : p.name)} value={p.name}>{p.name}</option>)}
            </select>
            <span className="small" style={{ color: live ? '#16a34a' : 'var(--muted)' }}>{live ? '● live' : '○ connecting…'}</span>
            <button className="btn" onClick={() => { if (sel) openStream(sel); }}>↻ Reconnect</button>
            <button className="btn" onClick={() => { if (logRef.current) logRef.current.scrollTop = 0; }}>⤒ top</button>
            <button className="btn" onClick={() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }}>⤓ bottom</button>
            <button className="btn" onClick={copyLog}>copy</button>
            <button className="btn" onClick={() => setExpanded((e) => !e)}>{expanded ? '⤢ shrink' : '⤢ expand'}</button>
          </span>
        </div>
        <div ref={logRef} className="term" style={{ height: expanded ? 640 : 360, marginTop: 8 }}>Loading…</div>
      </div>
    </div>
  );
}
