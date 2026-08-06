import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card } from './ui.jsx';
import { track } from '../../../lib/track.js';

// Web pages (URL context): add an allow-listed page -> the server fetches, chunks, and stores it; the bot
// retrieves the relevant chunks. Sources list with status + last-fetched, expandable to their chunks
// (per-chunk include toggle), Refresh / Remove. Snapshots also refresh nightly (utilities/cron_get_url_context).
export function UrlContextCard({ queue }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState('queue');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [chunks, setChunks] = useState({});

  const load = async () => {
    setLoading(true);
    try { const r = await api.contextUrls(queue); setSources(r.sources || []); }
    catch (e) { setErr(e.message || 'load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { setErr(''); setMsg(''); setOpen({}); setChunks({}); load(); /* eslint-disable-next-line */ }, [queue]);

  const loadChunks = async (s) => {
    try { const r = await api.urlChunks(queue, s.source_ref, s.scope); setChunks((c) => Object.assign({}, c, { [s.source_ref]: r.chunks || [] })); }
    catch (e) { /* ignore */ }
  };
  const toggle = async (s) => {
    const isOpen = !open[s.source_ref];
    setOpen((o) => Object.assign({}, o, { [s.source_ref]: isOpen }));
    if (isOpen && !chunks[s.source_ref]) await loadChunks(s);
  };
  const add = async () => {
    const u = url.trim(); if (!u || busy) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.addUrl({ queue, url: u, scope });
      setUrl(''); setMsg('Added: ' + (r.title || u) + ' (' + (r.chunks || 0) + ' chunks' + (r.needs_js ? ', looks JS-rendered — little text found' : '') + ')');
      try { track('url_add', { panel: 'chatbot' }); } catch (e) { /* ignore */ }
      await load();
    } catch (e) { setErr(e.message || 'add failed'); }
    finally { setBusy(false); }
  };
  const refresh = async (s) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.refreshUrl({ queue, source_ref: s.source_ref, scope: s.scope, needs_js: !!s.needs_js });
      setMsg(r.ok ? ('Refreshed (' + (r.chunks || 0) + ' chunks)') : ('Refresh failed: ' + (r.reason || '')));
      await load(); if (open[s.source_ref]) await loadChunks(s);
    } catch (e) { setErr(e.message || 'refresh failed'); }
    finally { setBusy(false); }
  };
  const remove = async (s) => {
    setBusy(true); setErr('');
    try { await api.removeUrl({ queue, source_ref: s.source_ref, scope: s.scope }); await load(); }
    catch (e) { setErr(e.message || 'remove failed'); }
    finally { setBusy(false); }
  };
  const excludeChunk = async (s, ch, excluded) => {
    try { await api.chunkExclude(ch.id, excluded); await loadChunks(s); } catch (e) { /* ignore */ }
  };

  return (
    <Card title="Web pages (URL context)" summary={sources.length ? sources.length + ' source' + (sources.length === 1 ? '' : 's') : ''}>
      <div className="cbx-hint">Add an allow-listed page (e.g. usatriathlon.org). The bot fetches it, splits it into labeled chunks, and retrieves the relevant ones. Snapshots refresh nightly and on demand.</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input className="cbx-input" style={{ flex: '1 1 200px' }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.usatriathlon.org/…" />
        <select className="cbx-input" style={{ width: 'auto' }} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="queue">This queue</option><option value="global">All queues</option>
        </select>
        <button className="cbx-btn primary sm" onClick={add} disabled={busy || !url.trim()}>{busy ? 'Adding…' : 'Add URL'}</button>
      </div>
      {msg ? <div className="cbx-dim" style={{ marginTop: 6 }}>{msg}</div> : null}
      {err ? <div className="cbx-err" style={{ marginTop: 6 }}>{err}</div> : null}
      {loading ? <div className="cbx-dim" style={{ marginTop: 8 }}>Loading…</div> : null}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sources.map((s) => (
          <div key={s.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="cbx-btn xs" onClick={() => toggle(s)} title="Show chunks">{open[s.source_ref] ? '▾' : '▸'}</button>
              <span title="web page">🌐</span>
              <a href={s.source_ref} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-all' }}>{s.source_title || s.source_ref}</a>
              <span style={{ marginLeft: 'auto' }} className="cbx-badge">{s.chunk_count} chunks</span>
            </div>
            <div className="cbx-dim" style={{ fontSize: 11, marginTop: 2 }}>
              {s.scope === 'global' ? 'all queues' : 'this queue'} · {s.status === 'ok'
                ? ('fetched ' + (s.fetched_at_mtn || ''))
                : <span style={{ color: 'var(--red)' }}>{s.status}{s.error ? (' — ' + s.error) : ''}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button className="cbx-btn xs" onClick={() => refresh(s)} disabled={busy}>↻ Refresh</button>
              <button className="cbx-btn xs" onClick={() => remove(s)} disabled={busy}>Remove</button>
            </div>
            {open[s.source_ref] ? (
              <div style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(chunks[s.source_ref] || []).map((ch) => (
                  <div key={ch.id} style={{ fontSize: 11, opacity: ch.excluded ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <b style={{ flex: 1 }}>{ch.category || '(section)'}</b>
                      <span className="cbx-dim">{ch.char_len}c</span>
                      <label style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }} title="Include this chunk in grounding">
                        <input type="checkbox" checked={!ch.excluded} onChange={(e) => excludeChunk(s, ch, !e.target.checked)} />use
                      </label>
                    </div>
                    <div className="cbx-dim">{String(ch.preview || '').slice(0, 120)}</div>
                  </div>
                ))}
                {!(chunks[s.source_ref] || []).length ? <div className="cbx-dim">No chunks.</div> : null}
              </div>
            ) : null}
          </div>
        ))}
        {!loading && !sources.length ? <div className="cbx-dim" style={{ marginTop: 8 }}>No URL sources yet.</div> : null}
      </div>
    </Card>
  );
}

// Retrieval preview: type a question, see the top chunks the bot WOULD send (score + source + section).
// Creates no conversation turn — the "how is it pulling relevant data" window.
export function RetrievePreviewCard({ queue }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setRows(null); setErr(''); }, [queue]);
  const run = async () => {
    const s = q.trim(); if (!s || busy) return;
    setBusy(true); setErr('');
    try { const r = await api.retrievePreview({ queue, question: s }); setRows(r.results || []); try { track('retrieve_preview', { panel: 'chatbot' }); } catch (e) { /* ignore */ } }
    catch (e) { setErr(e.message || 'failed'); setRows([]); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Retrieval preview" summary="what the bot would pull">
      <div className="cbx-hint">Type a question to see the top chunks the bot would send for <b>{queue}</b> — score, source, and section. Creates no conversation.</div>
      <textarea className="cbx-input" style={{ minHeight: 60, marginTop: 8 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. how long does coaching renewal take?" />
      <button className="cbx-btn primary sm" onClick={run} disabled={busy || !q.trim()}>{busy ? 'Retrieving…' : 'Preview retrieval'}</button>
      {err ? <div className="cbx-err" style={{ marginTop: 6 }}>{err}</div> : null}
      {rows && rows.length === 0 && !busy ? <div className="cbx-dim" style={{ marginTop: 8 }}>No matching chunks. Add a URL or upload context first.</div> : null}
      {rows && rows.length ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="cbx-badge">{r.score}</span>
                <b style={{ fontSize: 12 }}>{r.source_title || r.source_ref}</b>
              </div>
              <div className="cbx-dim" style={{ fontSize: 11 }}>{r.category}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{String(r.text || '').slice(0, 180)}{(r.text || '').length > 180 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
