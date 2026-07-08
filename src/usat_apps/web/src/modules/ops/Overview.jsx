import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Overview — mirrors the proxy console's Overview: App-status tiles, collapsible Routes chips,
// a sortable pm2 Process table (refresher: interval/pause/now), and a live Server console (SSE).
const INTS = [[10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [600, '10m'], [900, '15m'], [1800, '30m'], [3600, '1h']];
const PCOLS = [
  ['n', '#', false], ['name', 'Name', true], ['status', 'Status', true], ['cpu', 'CPU %', true],
  ['memory_mb', 'Mem MB', true], ['restarts', '↺', true], ['uptime_ms', 'Uptime', true], ['pid', 'PID', true],
];
const LS_REF = 'usatapps_ops_ov_refresh';
const LS_SORT = 'usatapps_ops_ov_sort';
function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function fmtUptime(ms) { if (ms == null) return '—'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); if (d) return d + 'd ' + h + 'h'; if (h) return h + 'h ' + m + 'm'; if (m) return m + 'm'; return s + 's'; }
function lineClass(line) {
  if (/error|ECONNREFUSED|SERVER ERROR|✗|failed/i.test(line)) return 'l-err';
  if (/CLIENT ERROR|WARN|warning/i.test(line)) return 'l-sys';
  if (/\bOK\b|✓|online|listening|ready|Serving/i.test(line)) return 'l-ok';
  if (/^\s*(>>|<<)/.test(line) || /\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b/.test(line)) return 'l-meta';
  return '';
}

export default function OpsOverview() {
  const [status, setStatus] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [procs, setProcs] = useState(null);
  const [procWhen, setProcWhen] = useState('');
  const [routesOpen, setRoutesOpen] = useState(false);
  const [procsOpen, setProcsOpen] = useState(true);
  const [refresh, setRefresh] = useState(() => lsGet(LS_REF, { sec: 30, paused: false }));
  const [sort, setSort] = useState(() => lsGet(LS_SORT, { key: 'name', dir: 1 }));
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef(null);
  const logRef = useRef(null);

  const loadAll = () => {
    api.opsStatus().then((r) => { if (r.status === 200 && r.body.ok) setStatus(r.body); }).catch(() => {});
    api.opsHealth().then((r) => { if (r.status === 200 && r.body.ok) setRoutes(r.body.checked || []); }).catch(() => {});
    api.opsPm2().then((r) => {
      if (r.status === 200 && r.body.ok) { setProcs(r.body.processes || []); setProcWhen('updated: ' + new Date(r.body.time).toLocaleString() + ' · ' + r.body.count + ' processes'); }
      else setProcWhen('pm2 error: ' + ((r.body && r.body.error) || r.status));
    }).catch((e) => setProcWhen('pm2 error: ' + e));
  };
  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!refresh.paused && refresh.sec > 0) timer.current = setInterval(loadAll, refresh.sec * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const appendLine = (line) => {
    const o = logRef.current; if (!o) return;
    if (o.dataset.fresh !== '1') { o.textContent = ''; o.dataset.fresh = '1'; }
    const atBottom = o.scrollHeight - o.scrollTop - o.clientHeight < 40;
    const div = document.createElement('div'); const cls = lineClass(line); if (cls) div.className = cls; div.textContent = line;
    o.appendChild(div); while (o.childNodes.length > 700) o.removeChild(o.firstChild);
    if (atBottom) o.scrollTop = o.scrollHeight;
  };
  // Live console via SSE (the subscribe replays the last 100 lines, then streams).
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    let es;
    try { es = new EventSource(base + '/api/ops/console/stream'); } catch (e) { return undefined; }
    es.onopen = () => setLive(true);
    es.addEventListener('line', (ev) => { try { appendLine(JSON.parse(ev.data).line); } catch (e) { /* skip */ } });
    es.onerror = () => setLive(false);
    return () => { try { es.close(); } catch (e) { /* noop */ } };
  }, []);

  const setSec = (sec) => { const n = { ...refresh, sec }; setRefresh(n); lsSet(LS_REF, n); };
  const setPaused = (p) => { const n = { ...refresh, paused: p }; setRefresh(n); lsSet(LS_REF, n); };
  const clickCol = (key) => { const n = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 }; setSort(n); lsSet(LS_SORT, n); };
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  const sortedProcs = useMemo(() => {
    if (!procs) return null;
    const k = sort.key;
    return procs.slice().sort((a, b) => {
      const xv = a[k], yv = b[k];
      if (typeof xv === 'number' && typeof yv === 'number') return (xv - yv) * sort.dir;
      return String(xv == null ? '' : xv).localeCompare(String(yv == null ? '' : yv)) * sort.dir;
    });
  }, [procs, sort]);

  const tiles = status ? [
    ['App', status.app], ['Uptime (s)', status.uptime_seconds],
    ['RSS (MB)', status.memory_mb && status.memory_mb.rss], ['Heap (MB)', status.memory_mb && status.memory_mb.heap_used],
    ['node', status.node], ['pid', status.pid], ['pm2 name', status.pm2_name], ['Mountain time', status.now_mtn],
  ] : [];
  const copyLog = () => { try { navigator.clipboard.writeText(logRef.current ? logRef.current.innerText : ''); } catch (e) { /* ignore */ } };
  const collapser = (open, label, onClick) => (
    <button type="button" className="rail-group" style={{ padding: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)', width: 'auto', fontWeight: 700 }} onClick={onClick}>
      <span className="rail-caret" aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
    </button>
  );

  return (
    <div className="page">
      <h2>Overview</h2>

      <div className="card">
        <h3>App status</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {tiles.length ? tiles.map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="muted small">{k}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{v == null ? '—' : String(v)}</div>
            </div>
          )) : <div className="muted">Loading…</div>}
        </div>
      </div>

      <div className="card">
        {collapser(routesOpen, 'Routes', () => setRoutesOpen((o) => !o))}
        {routesOpen ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {routes ? (routes.length ? routes.map((c) => (
              <span key={c.prefix} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 999, padding: '2px 10px', fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.ok ? '#16a34a' : 'var(--red)' }} />{c.prefix}
              </span>
            )) : <span className="muted">no routes</span>) : <span className="muted">Loading…</span>}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          {collapser(procsOpen, 'Process (pm2)', () => setProcsOpen((o) => !o))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="small">Refresh&nbsp;
              <select value={refresh.sec} onChange={(e) => setSec(Number(e.target.value))}>{INTS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>
            </label>
            <label className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={refresh.paused} onChange={(e) => setPaused(e.target.checked)} /> pause</label>
            <button className="btn" onClick={loadAll}>↻ now</button>
          </span>
        </div>
        {procsOpen ? (
          <>
            <p className="muted small" style={{ margin: '6px 0' }}>{procWhen}</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead><tr>{PCOLS.map(([key, label, sortable]) => (
                  <th key={key} style={{ textAlign: key === 'name' ? 'left' : 'center', ...(sortable ? { cursor: 'pointer' } : {}) }} onClick={sortable ? () => clickCol(key) : undefined}>{label}{sortable ? arrow(key) : ''}</th>
                ))}</tr></thead>
                <tbody>
                  {!sortedProcs ? <tr><td className="muted" colSpan={PCOLS.length}>Loading…</td></tr>
                    : sortedProcs.map((p, i) => (
                      <tr key={(p.name || '') + i}>
                        <td className="muted" style={{ textAlign: 'center' }}>{i + 1}</td>
                        <td>{p.name}{p.port ? <span className="muted small"> :{p.port}</span> : ''}</td>
                        <td style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: p.status === 'online' ? 'rgba(22,121,74,.15)' : 'rgba(194,14,47,.15)', color: p.status === 'online' ? '#16794a' : 'var(--red)' }}>{p.status || '—'}</span></td>
                        <td style={{ textAlign: 'center' }}>{p.cpu != null ? p.cpu : '—'}</td>
                        <td style={{ textAlign: 'center' }}>{p.memory_mb != null ? p.memory_mb : '—'}</td>
                        <td style={{ textAlign: 'center' }}>{p.restarts != null ? p.restarts : '—'}</td>
                        <td style={{ textAlign: 'center' }}>{fmtUptime(p.uptime_ms)}</td>
                        <td style={{ textAlign: 'center' }}>{p.pid || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Server console — {status ? status.pm2_name : 'usat_apps'}</h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="small" style={{ color: live ? '#16a34a' : 'var(--muted)' }}>{live ? '● live' : '○ connecting…'}</span>
            <button className="btn" onClick={() => { if (logRef.current) logRef.current.scrollTop = 0; }}>⤒ top</button>
            <button className="btn" onClick={() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }}>⤓ bottom</button>
            <button className="btn" onClick={copyLog}>copy</button>
            <button className="btn" onClick={() => setExpanded((e) => !e)}>{expanded ? '⤢ shrink' : '⤢ expand'}</button>
          </span>
        </div>
        <div ref={logRef} className="term" style={{ height: expanded ? 560 : 260, marginTop: 8 }}>Loading…</div>
      </div>
    </div>
  );
}
