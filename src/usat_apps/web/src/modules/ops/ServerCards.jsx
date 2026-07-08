import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Server cards — one card per pm2 process, each streaming its live pm2 log (via /api/ops/logs/stream,
// a single all-process SSE routed to cards by name) plus status/CPU/mem/uptime (polled from /api/ops/pm2).
// Features mirror the proxy console: layout (2/3/4/split), fullscreen, refresher, drag-to-reorder,
// per-card top/bottom/expand/copy.
const INTS = [[10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [600, '10m'], [900, '15m']];
const LAYOUTS = [['2', '2'], ['3', '3'], ['4', '4'], ['split', '⅔·⅓']];
const LS_LAYOUT = 'usatapps_ops_cards_layout', LS_ORDER = 'usatapps_ops_cards_order', LS_REF = 'usatapps_ops_cards_refresh_15m', LS_EXP = 'usatapps_ops_cards_expanded';
function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function fmtUptime(ms) { if (ms == null) return '—'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); if (d) return d + 'd ' + h + 'h'; if (h) return h + 'h ' + m + 'm'; if (m) return m + 'm'; return s + 's'; }
function lineClass(line) {
  if (/error|ECONNREFUSED|SERVER ERROR|✗|failed/i.test(line)) return 'l-err';
  if (/CLIENT ERROR|WARN|warning/i.test(line)) return 'l-sys';
  if (/\bOK\b|✓|online|listening|ready|Serving/i.test(line)) return 'l-ok';
  if (/^\s*(>>|<<)/.test(line) || /\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b/.test(line)) return 'l-meta';
  return '';
}

export default function OpsServerCards() {
  const [procs, setProcs] = useState(null);
  const [when, setWhen] = useState('');
  const [layout, setLayout] = useState(() => lsGet(LS_LAYOUT, '2'));
  const [order, setOrder] = useState(() => lsGet(LS_ORDER, []));
  const [refresh, setRefresh] = useState(() => lsGet(LS_REF, { sec: 900, paused: false }));
  const [expanded, setExpanded] = useState(() => lsGet(LS_EXP, {}));
  const [live, setLive] = useState(false);
  const [full, setFull] = useState(false);
  const timer = useRef(null);
  const wrapRef = useRef(null);
  const logRefs = useRef({});
  const dragName = useRef(null);

  const loadProcs = () => {
    api.opsPm2().then((r) => {
      if (r.status === 200 && r.body.ok) { setProcs(r.body.processes || []); setWhen('updated: ' + new Date(r.body.time).toLocaleString() + ' · ' + r.body.count + ' processes'); }
      else setWhen('pm2 error: ' + ((r.body && r.body.error) || r.status));
    }).catch((e) => setWhen('pm2 error: ' + e));
  };
  useEffect(() => { loadProcs(); }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!refresh.paused && refresh.sec > 0) timer.current = setInterval(loadProcs, refresh.sec * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  // Route each line to EVERY card whose process name matches (cards are keyed by unique pm_id, but the
  // log stream is tagged by name — so two same-named processes both receive their shared output).
  const appendLine = (name, line) => {
    const cls = lineClass(line);
    Object.keys(logRefs.current).forEach((k) => {
      const o = logRefs.current[k];
      if (!o || o.dataset.pname !== name) return;
      if (o.dataset.fresh !== '1') { o.textContent = ''; o.dataset.fresh = '1'; }
      const atBottom = o.scrollHeight - o.scrollTop - o.clientHeight < 40;
      const div = document.createElement('div'); if (cls) div.className = cls; div.textContent = line;
      o.appendChild(div); while (o.childNodes.length > 500) o.removeChild(o.firstChild);
      if (atBottom) o.scrollTop = o.scrollHeight;
    });
  };
  // One SSE stream for ALL processes; route each line to its card by name.
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    let es;
    try { es = new EventSource(base + '/api/ops/logs/stream'); } catch (e) { return undefined; }
    es.onopen = () => setLive(true);
    es.addEventListener('line', (ev) => { try { const d = JSON.parse(ev.data); appendLine(d.name, d.line); } catch (e) { /* skip */ } });
    es.onerror = () => setLive(false);
    return () => { try { es.close(); } catch (e) { /* noop */ } };
  }, []);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFull = () => { if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); } else if (wrapRef.current && wrapRef.current.requestFullscreen) wrapRef.current.requestFullscreen(); };

  const setSec = (sec) => { const n = { ...refresh, sec }; setRefresh(n); lsSet(LS_REF, n); };
  const setPaused = (p) => { const n = { ...refresh, paused: p }; setRefresh(n); lsSet(LS_REF, n); };
  const setLay = (l) => { setLayout(l); lsSet(LS_LAYOUT, l); };
  const toggleExp = (name) => { setExpanded((e) => { const n = { ...e, [name]: !e[name] }; lsSet(LS_EXP, n); return n; }); };

  const cards = useMemo(() => {
    if (!procs) return null;
    const byName = {}; procs.forEach((p) => { byName[p.name] = p; });
    const seen = {}; const out = [];
    (order || []).forEach((nm) => { if (byName[nm]) { out.push(byName[nm]); seen[nm] = 1; } });
    procs.forEach((p) => { if (!seen[p.name]) out.push(p); });
    return out;
  }, [procs, order]);

  const onDrop = (targetName) => {
    const from = dragName.current; dragName.current = null;
    if (!from || from === targetName || !cards) return;
    const names = cards.map((c) => c.name);
    const fi = names.indexOf(from), ti = names.indexOf(targetName);
    if (fi < 0 || ti < 0) return;
    names.splice(fi, 1); names.splice(ti, 0, from);
    setOrder(names); lsSet(LS_ORDER, names);
  };

  const gridCols = layout === 'split' ? '2fr 1fr' : ('repeat(' + layout + ', minmax(0,1fr))');
  const copyCard = (name) => { try { const o = logRefs.current[name]; navigator.clipboard.writeText(o ? o.innerText : ''); } catch (e) { /* ignore */ } };
  const cbtn = { padding: '1px 6px', fontSize: 12 };

  return (
    <div className="page" ref={wrapRef} style={full ? { background: 'var(--bg)', padding: 16, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Server cards</h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Layout
            <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
              {LAYOUTS.map(([v, l]) => (
                <button key={v} className="btn" style={{ padding: '2px 8px', ...(layout === v ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}) }} onClick={() => setLay(v)}>{l}</button>
              ))}
            </span>
          </span>
          <span className="small" style={{ color: live ? '#16a34a' : 'var(--muted)' }}>{live ? '● live' : '○ connecting…'}</span>
          <button className="btn" onClick={toggleFull}>{full ? 'Exit ⛶' : '⛶ Fullscreen'}</button>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
        <label className="small">Refresh <select value={refresh.sec} onChange={(e) => setSec(Number(e.target.value))}>{INTS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></label>
        <label className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={refresh.paused} onChange={(e) => setPaused(e.target.checked)} /> pause</label>
        <button className="btn" onClick={loadProcs}>↻ now</button>
        <span className="muted small">{when}</span>
      </div>
      <p className="muted small">Each card streams that server's pm2 log live plus status/CPU/mem. Drag a card's ⣿ handle to reorder; expand for a bigger view; copy to clipboard.</p>

      {!cards ? <div className="muted">Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, alignItems: 'start' }}>
          {cards.map((p, i) => {
            const uid = p.pm_id != null ? String(p.pm_id) : (p.name + '#' + i);
            return (
            <div key={uid} className="card" style={{ margin: 0, padding: 10 }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(p.name)}>
              <div draggable onDragStart={() => { dragName.current = p.name; }} onDragEnd={() => { dragName.current = null; }} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab', flexWrap: 'wrap' }}>
                <span aria-hidden="true" title="drag to reorder" style={{ color: 'var(--muted)' }}>⣿</span>
                <span style={{ display: 'inline-block', padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: p.status === 'online' ? 'rgba(22,121,74,.15)' : 'rgba(194,14,47,.15)', color: p.status === 'online' ? '#16794a' : 'var(--red)' }}>{p.status || '—'}</span>
                <b style={{ fontSize: 13 }}>{p.name}</b>{p.port ? <span className="muted small">:{p.port}</span> : null}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="btn" style={cbtn} title="top" onClick={() => { const o = logRefs.current[uid]; if (o) o.scrollTop = 0; }}>⤒</button>
                  <button className="btn" style={cbtn} title="bottom" onClick={() => { const o = logRefs.current[uid]; if (o) o.scrollTop = o.scrollHeight; }}>⤓</button>
                  <button className="btn" style={cbtn} title="expand" onClick={() => toggleExp(uid)}>⤢</button>
                  <button className="btn" style={cbtn} title="copy" onClick={() => copyCard(uid)}>copy</button>
                </span>
              </div>
              <div className="muted small" style={{ margin: '2px 0 6px' }}>cpu {p.cpu != null ? p.cpu + '%' : '—'} · {p.memory_mb != null ? p.memory_mb + 'MB' : '—'} · ↺{p.restarts != null ? p.restarts : '—'} · {fmtUptime(p.uptime_ms)} · #{i + 1}</div>
              <div ref={(el) => { if (el) { logRefs.current[uid] = el; el.dataset.pname = p.name; } else { delete logRefs.current[uid]; } }} className="term" style={{ height: expanded[uid] ? 460 : 180, fontSize: 11 }}>Loading…</div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
