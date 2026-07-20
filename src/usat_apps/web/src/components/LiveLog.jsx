// Shared live-log console — the same streaming + coloring the Ops "Server cards" use, packaged as a
// reusable component. Streams a single pm2 process's log over the platform SSE (/api/ops/logs/stream?name=)
// into a `.term` console (global CSS) with regex line-coloring, auto-scroll, and expand/copy/jump controls.
// Props: name (pm2 process to follow), streamUrl (SSE endpoint, default the Ops admin stream), height
// (px, default 200), expandedHeight (default '70vh'). Pass a panel-gated streamUrl for non-admin access.
import { useEffect, useRef, useState } from 'react';

// Same classifier as ServerCards so lines colorize identically (errors red, OK green, requests dim, etc.).
function lineClass(line) {
  if (/error|ECONNREFUSED|SERVER ERROR|✗|failed/i.test(line)) return 'l-err';
  if (/CLIENT ERROR|WARN|warning|paused|held/i.test(line)) return 'l-sys';
  if (/\bOK\b|✓|✔|online|listening|ready|Serving|done|complete|RESTORED|merged/i.test(line)) return 'l-ok';
  if (/^\s*(>>|<<)/.test(line) || /\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b/.test(line)) return 'l-meta';
  return '';
}

const LINE_CHOICES = [200, 500, 1000, 2000, 5000];

export default function LiveLog({ name, streamUrl = '/api/ops/logs/stream', height = 200, expandedHeight = '70vh', defaultLines = 500 }) {
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [reloadKey, setReloadKey] = useState(0);   // bump to tear down + reopen the stream (manual reconnect)
  const [lines, setLines] = useState(defaultLines);   // how many lines to backfill + keep in the buffer
  const termRef = useRef(null);
  const pinnedRef = useRef(true);   // follow the tail unless the user scrolls up

  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    const params = [];
    if (name) params.push('name=' + encodeURIComponent(name));
    params.push('lines=' + encodeURIComponent(lines));
    const url = base + streamUrl + (streamUrl.indexOf('?') >= 0 ? '&' : '?') + params.join('&');
    // Clear the console so the reconnect's backfill repaints a fresh, current tail.
    const o0 = termRef.current; if (o0) { o0.dataset.fresh = '0'; }
    let es;
    try { es = new EventSource(url); } catch (e) { setNote('cannot open stream'); return undefined; }
    es.onopen = () => { setLive(true); setNote(''); };
    es.addEventListener('line', (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (name && d.name !== name) return;
      const o = termRef.current; if (!o) return;
      if (o.dataset.fresh !== '1') { o.textContent = ''; o.dataset.fresh = '1'; }
      const atBottom = (o.scrollHeight - o.scrollTop - o.clientHeight) < 40;
      const div = document.createElement('div');
      const cls = lineClass(d.line || ''); if (cls) div.className = cls;
      // Prefix the pm2 instance (cluster worker number), dimmed, like `5| …` in the pm2 CLI.
      if (d.id !== undefined && d.id !== null) {
        const pre = document.createElement('span'); pre.className = 'l-meta'; pre.textContent = d.id + '| ';
        div.appendChild(pre);
      }
      div.appendChild(document.createTextNode(d.line || ''));
      o.appendChild(div);
      while (o.childNodes.length > lines) o.removeChild(o.firstChild);
      if (atBottom && pinnedRef.current) o.scrollTop = o.scrollHeight;
    });
    es.onerror = () => { setLive(false); setNote('stream closed — reconnect, or check admin/ops access'); };
    return () => { try { es.close(); } catch (e) { /* noop */ } };
  }, [name, streamUrl, reloadKey, lines]);

  const copy = () => { try { const o = termRef.current; if (o) navigator.clipboard.writeText(o.innerText || ''); } catch (e) { /* ignore */ } };
  const toTop = () => { pinnedRef.current = false; const o = termRef.current; if (o) o.scrollTop = 0; };
  const toBottom = () => { pinnedRef.current = true; const o = termRef.current; if (o) o.scrollTop = o.scrollHeight; };
  const cbtn = { padding: '1px 6px', fontSize: 12, width: 'auto' };

  return (
    <div>
      {/* Header controls mirror Ops → Server cards: status pill left, ⤒ ⤓ ⤢ copy right-aligned. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: live ? 'rgba(22,121,74,.15)' : 'rgba(194,14,47,.15)', color: live ? '#16794a' : 'var(--red)' }}>{live ? 'live' : 'offline'}</span>
        {note ? <span className="small" style={{ color: 'var(--dim)' }}>{note}</span> : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="tb-select" title="How many lines to load and keep in view">
            <select value={lines} onChange={(e) => setLines(Number(e.target.value))} style={{ fontSize: 12, padding: '1px 4px' }}>
              {LINE_CHOICES.map((n) => <option key={n} value={n}>{n} lines</option>)}
            </select>
          </span>
          <button className="btn" style={cbtn} title="reconnect / refresh the stream" onClick={() => { setNote(''); setReloadKey((k) => k + 1); }}>↻</button>
          <button className="btn" style={cbtn} title="top" onClick={toTop}>⤒</button>
          <button className="btn" style={cbtn} title="bottom" onClick={toBottom}>⤓</button>
          <button className="btn" style={cbtn} title="expand" onClick={() => setExpanded((v) => !v)}>⤢</button>
          <button className="btn" style={cbtn} title="copy" onClick={copy}>copy</button>
        </span>
      </div>
      <div
        ref={termRef}
        onScroll={(e) => { const el = e.currentTarget; pinnedRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40; }}
        className="term"
        style={{ height: expanded ? expandedHeight : height, fontSize: 12 }}
      >Loading…</div>
    </div>
  );
}
