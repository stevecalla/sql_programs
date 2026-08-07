import { useEffect, useMemo, useState } from 'react';
import { Collapsible } from '../../lib/ui.jsx';   // shared collapsible card (common component)
import { ReorderableList, resetOrder } from '../../lib/ReorderableList.jsx';   // shared drag-to-reorder wrapper
import './knowledge_admin.css';

// Shared "Knowledge & AI" admin surface — the single place for the controls BOTH the chatbot and the email
// queue share: retrieval blend, embedding model + reindex, AI model registry, queue access, web allowlist.
// Admin-only; neutral /api/knowledge-admin/* endpoints. Cards are collapsible (collapsed by default),
// self-documenting ("What this controls"), and drag-reorderable (order saved per browser).
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
async function req(path, opts) {
  const r = await fetch(BASE + '/api/knowledge-admin' + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
  }, opts));
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { try { window.dispatchEvent(new CustomEvent('usatapps:unauthorized')); } catch (e) { /* noop */ } }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

const S = {
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  hint: { color: 'var(--dim,#6b7280)', fontSize: 12.5, marginBottom: 12 },
  lbl: { fontSize: 12, fontWeight: 600, color: 'var(--dim,#6b7280)', textTransform: 'uppercase', letterSpacing: '.03em', margin: '16px 0 6px' },
  row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  btn: { cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--line,#e4e7ec)', background: 'var(--panel, #fff)', color: 'var(--ink, inherit)' },
  btnPri: { cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 11px', borderRadius: 8, border: '1px solid #3b82f6', background: '#3b82f6', color: '#fff' },
  pill: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid #cfe0ff', background: '#eff5ff', color: '#3b82f6' },
  muted: { color: 'var(--dim,#6b7280)', fontSize: 12 },
  status: { display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg,#fbfcfe)', border: '1px solid var(--line,#e4e7ec)', borderRadius: 10, padding: '10px 12px' },
  note: { fontSize: 12, color: '#b45309', background: '#fff8ee', border: '1px solid #fde9cf', borderRadius: 8, padding: '8px 10px', marginTop: 12 },
  demo: { border: '1px solid var(--line,#e4e7ec)', borderRadius: 10, padding: 12, marginTop: 8, background: 'var(--bg,#fbfcfe)' },
  inp: { font: 'inherit', padding: '6px 8px', border: '1px solid var(--line,#e4e7ec)', borderRadius: 7, background: 'var(--panel, #fff)', color: 'var(--ink, inherit)' },
  ref: { fontSize: 12, lineHeight: 1.5, color: 'var(--dim,#6b7280)', background: 'var(--bg,#fbfcfe)', border: '1px solid var(--line,#e4e7ec)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 12 },
  err: { color: '#dc2626', fontSize: 12 },
};
function Ref({ children }) { return <div style={S.ref}><b style={{ color: 'inherit' }}>ℹ What this controls</b> — {children}</div>; }
function Applies() { return <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--dim,#6b7280)' }}> · chatbot + email queue</span>; }

// Collapsible card via the SHARED Collapsible component — collapsed by default; each card owns its open state.
function Collapse({ title, summary, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible title={title} summary={summary} open={open} onToggle={() => setOpen((o) => !o)}
      classes={{ card: 'ka-card', head: 'ka-cardhead', h: 'ka-h', summary: 'ka-summary', chev: 'ka-chev', body: 'ka-body' }}>
      {children}
    </Collapsible>
  );
}

const DEMO = [
  { t: 'Membership — annual dues & renewal', c: 'Membership › Fees', k: 0.92, s: 0.86 },
  { t: 'Coaching certification — renewal timeline', c: 'Coaching › Renewal', k: 0.31, s: 0.74 },
  { t: 'One-day / event membership options', c: 'Membership › Event pass', k: 0.58, s: 0.69 },
  { t: '2026 Nationals — schedule & venue', c: 'Events › Nationals', k: 0.66, s: 0.22 },
];
function Stat({ n, label, color }) {
  return <div><b style={{ display: 'block', fontSize: 17, color: color || 'inherit' }}>{n}</b><span style={{ fontSize: 11, color: 'var(--dim,#6b7280)' }}>{label}</span></div>;
}

// ---------- shared retrieval/embeddings/allowlist state (one fetch, three cards read it) ----------
function useRetrieval() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [weight, setWeight] = useState(0);
  const [busy, setBusy] = useState('');
  const [host, setHost] = useState('');
  const [reidxMsg, setReidxMsg] = useState('');
  useEffect(() => { req('/settings').then((r) => { setData(r); setWeight(Math.round((r.settings.retrieval_weight || 0) * 100)); }).catch((e) => setErr(e.message)); }, []);
  const commitWeight = async (v) => { setBusy('w'); try { const r = await req('/settings', { method: 'POST', body: JSON.stringify({ retrieval_weight: v / 100 }) }); setData(r); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const changeModel = async (model) => { setBusy('m'); setReidxMsg(''); try { const r = await req('/settings', { method: 'POST', body: JSON.stringify({ embedding_model: model }) }); setData(r); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const reindex = async () => { setBusy('r'); setReidxMsg('Embedding…'); try { const r = await req('/reindex', { method: 'POST', body: JSON.stringify({ max: 500 }) }); setData((d) => Object.assign({}, d, { status: r.status })); setReidxMsg(r.remaining > 0 ? ('Embedded ' + r.embedded + ' · ' + r.remaining + ' remaining — click again') : ('Done · embedded ' + r.embedded)); } catch (e) { setReidxMsg(''); setErr(e.message); } finally { setBusy(''); } };
  const saveAllow = async (list) => { try { const r = await req('/allowlist', { method: 'POST', body: JSON.stringify({ allowlist: list }) }); setData((d) => Object.assign({}, d, { allowlist: r.allowlist })); } catch (e) { setErr(e.message); } };
  const addHost = () => { const h = host.trim(); if (!h) return; saveAllow((data && data.allowlist || []).concat([h])); setHost(''); };
  const ranked = useMemo(() => {
    const sw = weight / 100, kw = 1 - sw;
    const maxK = Math.max.apply(null, DEMO.map((x) => x.k)), maxS = Math.max.apply(null, DEMO.map((x) => x.s));
    return DEMO.map((x) => { const kn = x.k / maxK, sn = x.s / maxS; return { x, kn, sn, b: kw * kn + sw * sn }; }).sort((a, b) => b.b - a.b);
  }, [weight]);
  return { data, err, weight, setWeight, busy, host, setHost, reidxMsg, commitWeight, changeModel, reindex, saveAllow, addHost, ranked };
}
const bar = (pct, color) => <div style={{ height: 6, background: 'var(--line, #eef1f5)', borderRadius: 3, overflow: 'hidden' }}><i style={{ display: 'block', height: 6, width: Math.max(2, pct) + '%', background: color, borderRadius: 3 }} /></div>;

function RetrievalBlendCard({ r }) {
  const { data, weight, setWeight, busy, commitWeight, ranked } = r;
  const modeName = weight === 0 ? 'Keyword only · embeddings off' : weight === 100 ? 'Semantic only' : 'Hybrid';
  return (
    <Collapse title={<>Retrieval blend<Applies /></>} summary={modeName}>
      <Ref>How the assistant <b>picks which knowledge to send the AI</b> for every draft, chat, and ask. It scores your queue’s chunks two ways — <b>keyword</b> (BM25-lite: exact words) and <b>semantic</b> (embeddings: meaning) — and blends them. The single slider is the semantic weight: <b>0% = keyword only (embeddings off)</b>, 100% = semantic only, in between = a mix. Keyword% is just 100 − the slider; each chunk’s own scores don’t move — only the blended ranking does.</Ref>
      {!data ? <div style={S.muted}>Loading…</div> : (
        <>
          <input type="range" min="0" max="100" value={weight} style={{ width: '100%', accentColor: '#3b82f6' }}
            onChange={(e) => setWeight(Number(e.target.value))} onPointerUp={(e) => commitWeight(Number(e.target.value))} onKeyUp={(e) => commitWeight(Number(e.target.value))} />
          <div style={{ ...S.row, marginTop: 8 }}>
            <b style={{ fontSize: 14 }}>{modeName}</b>
            <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line,#e4e7ec)', minWidth: 220, flex: 1 }}>
              <div style={{ width: (100 - weight) + '%', background: '#8b5cf6' }} /><div style={{ width: weight + '%', background: '#0ea5e9' }} />
            </div>
            {busy === 'w' ? <span style={S.muted}>saving…</span> : <span style={S.muted}>keyword {100 - weight}% · semantic {weight}%</span>}
          </div>
          <div style={S.lbl}>Illustration — query: “how much does it cost to join?”</div>
          <div style={S.demo}>
            {ranked.map((row, i) => (
              <div key={i} style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#e4e7ec)', borderRadius: 9, padding: '9px 11px', marginBottom: i < ranked.length - 1 ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontWeight: 600, fontSize: 13 }}>{row.x.t}</span><span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dim,#6b7280)' }}>#{i + 1}</span></div>
                <div style={{ ...S.muted, fontSize: 11 }}>{row.x.c}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '62px 1fr 40px', gap: '5px 8px', alignItems: 'center', marginTop: 7, fontSize: 11, color: 'var(--dim,#6b7280)' }}>
                  <span>keyword</span>{bar(row.kn * 100, '#8b5cf6')}<span style={{ textAlign: 'right' }}>{row.kn.toFixed(2)}</span>
                  <span>semantic</span>{bar(row.sn * 100, '#0ea5e9')}<span style={{ textAlign: 'right' }}>{row.sn.toFixed(2)}</span>
                  <span style={{ color: '#3b82f6', fontWeight: 600 }}>blended</span>{bar(row.b * 100, '#3b82f6')}<span style={{ textAlign: 'right', color: '#3b82f6', fontWeight: 600 }}>{row.b.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Collapse>
  );
}

function EmbeddingCard({ r }) {
  const { data, busy, changeModel, reindex, reidxMsg } = r;
  const st = data && data.settings, status = data && data.status;
  return (
    <Collapse title={<>Embedding model<Applies /></>} summary={st ? (st.embeddings_enabled ? st.embedding_model : 'off') : ''}>
      <Ref>The model that turns each chunk into a <b>vector</b> (used for the semantic score above). Only matters when the blend is above 0%. <b>Changing it invalidates every stored vector</b> — vectors from different models aren’t comparable — so you must <b>Reindex</b> to rebuild them. Requires <code>OPENAI_API_KEY</code> on the server. If a vector is missing or the key fails, that chunk falls back to keyword — grounding never breaks.</Ref>
      {!data ? <div style={S.muted}>Loading…</div> : (
        <>
          <div style={{ ...S.row, justifyContent: 'space-between' }}>
            <select value={st.embedding_model} onChange={(e) => changeModel(e.target.value)} disabled={busy === 'm'} style={{ ...S.inp, minWidth: 300 }}>
              {(st.models || []).map((m) => <option key={m.id} value={m.id}>{m.label} ({m.dim}d){m.id === 'text-embedding-3-small' ? ' — default' : ''}</option>)}
            </select>
            <span style={S.muted}>Scope: Global (all queues)</span>
          </div>
          <div style={S.lbl}>Index status</div>
          <div style={S.status}>
            <Stat n={status.total} label="chunks" />
            <Stat n={status.embedded} label="embedded" color="#16a34a" />
            <Stat n={status.stale} label="stale / other model" color={status.stale ? '#b45309' : undefined} />
            <Stat n={status.missing} label="not embedded" color={status.missing ? '#b45309' : undefined} />
            <div style={{ marginLeft: 'auto', ...S.row }}>
              {reidxMsg ? <span style={S.muted}>{reidxMsg}</span> : (status.stale + status.missing > 0 ? <span style={{ ...S.muted, color: '#b45309' }}>{status.stale + status.missing} to embed</span> : <span style={S.muted}>Up to date</span>)}
              <button style={S.btnPri} onClick={reindex} disabled={busy === 'r'}>{busy === 'r' ? 'Reindexing…' : '↻ Reindex'}</button>
            </div>
          </div>
          {!st.embeddings_enabled ? <div style={S.note}>Embeddings are <b>off</b> (weight 0). You can still Reindex now so it’s ready when you raise the blend.</div> : null}
        </>
      )}
    </Collapse>
  );
}

function AllowlistCard({ r }) {
  const { data, host, setHost, saveAllow, addHost } = r;
  const allow = (data && data.allowlist) || [];
  return (
    <Collapse title={<>Web allowlist<Applies /></>} summary={data ? (allow.length + ' host' + (allow.length === 1 ? '' : 's')) : ''}>
      <Ref>The hostnames operators are allowed to add as <b>URL context</b> (web pages the bot snapshots and chunks). A page whose host isn’t here is rejected. Add/remove is shared — it governs URL-adding on both surfaces.</Ref>
      {!data ? <div style={S.muted}>Loading…</div> : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allow.map((h) => <span key={h} style={{ fontSize: 12, background: 'var(--line, #eef1f5)', borderRadius: 6, padding: '3px 8px' }}><b>{h}</b> <button onClick={() => saveAllow(allow.filter((x) => x !== h))} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--dim,#6b7280)' }} title="Remove">✕</button></span>)}
            {!allow.length ? <span style={S.muted}>(none — defaults to usatriathlon.org)</span> : null}
          </div>
          <div style={S.lbl}>Add host</div>
          <div style={S.row}>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHost(); }} placeholder="e.g. learn.usatriathlon.org" style={{ ...S.inp, flex: 1 }} />
            <button style={S.btnPri} onClick={addHost}>Add</button>
          </div>
        </>
      )}
    </Collapse>
  );
}

// ---------- AI model registry ----------
function ModelRegistry() {
  const [models, setModels] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { req('/models').then((r) => setModels((r.ai_models || []).map((m) => ({ ...m })))).catch((e) => setErr(e.message)); }, []);
  const setM = (i, patch) => setModels((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const setDefault = (i) => setModels((ms) => ms.map((m, j) => ({ ...m, is_default: j === i })));
  const add = () => setModels((ms) => (ms || []).concat([{ provider: 'openai', model: '', label: '', is_default: (ms || []).length === 0, price_in: 0, price_out: 0 }]));
  const del = (i) => setModels((ms) => ms.filter((_, j) => j !== i));
  const save = async () => {
    const rows = (models || []).filter((m) => String(m.model || '').trim());
    if (!rows.length) { setMsg(''); setErr('Add at least one model.'); return; }
    setErr(''); setMsg('');
    try { const r = await req('/models', { method: 'POST', body: JSON.stringify({ ai_models: rows.map((m) => ({ provider: m.provider, model: String(m.model).trim(), label: m.label || m.model, is_default: !!m.is_default, price_in: parseFloat(m.price_in) || 0, price_out: parseFloat(m.price_out) || 0 })) }) }); setModels((r.ai_models || []).map((m) => ({ ...m }))); setMsg('Saved ' + (r.ai_models || []).length + ' model(s).'); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Collapse title={<>AI model registry<Applies /></>} summary={models ? models.length + ' models' : ''}>
      <Ref>The <b>list of AI models</b> the chatbot and email queue can pick from, plus their <b>prices</b> (USD per 1M tokens) for cost tracking. This is the shared menu — each surface still chooses its own model from it. One model is the <b>Default</b>. API keys live in the server <code>.env</code>, not here.</Ref>
      {models == null ? <div style={S.muted}>{err || 'Loading…'}</div> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--dim,#6b7280)', fontSize: 11 }}>
                <th style={{ padding: 4 }}>Default</th><th style={{ padding: 4 }}>Provider</th><th style={{ padding: 4 }}>Model</th><th style={{ padding: 4 }}>Label</th><th style={{ padding: 4 }}>In $/1M</th><th style={{ padding: 4 }}>Out $/1M</th><th></th>
              </tr></thead>
              <tbody>
                {models.length === 0 ? <tr><td colSpan={7} style={S.muted}>No models — add one below.</td></tr> : null}
                {models.map((m, i) => (
                  <tr key={i}>
                    <td style={{ padding: 4, textAlign: 'center' }}><input type="radio" name="kaModelDefault" checked={!!m.is_default} onChange={() => setDefault(i)} /></td>
                    <td style={{ padding: 4 }}><select value={m.provider} onChange={(e) => setM(i, { provider: e.target.value })} style={S.inp}><option value="openai">openai</option><option value="anthropic">anthropic</option></select></td>
                    <td style={{ padding: 4 }}><input value={m.model} onChange={(e) => setM(i, { model: e.target.value })} placeholder="gpt-4o-mini" style={{ ...S.inp, minWidth: 170 }} /></td>
                    <td style={{ padding: 4 }}><input value={m.label} onChange={(e) => setM(i, { label: e.target.value })} placeholder="ChatGPT" style={S.inp} /></td>
                    <td style={{ padding: 4 }}><input type="number" step="0.01" min="0" value={m.price_in} onChange={(e) => setM(i, { price_in: e.target.value })} style={{ ...S.inp, width: 80 }} /></td>
                    <td style={{ padding: 4 }}><input type="number" step="0.01" min="0" value={m.price_out} onChange={(e) => setM(i, { price_out: e.target.value })} style={{ ...S.inp, width: 80 }} /></td>
                    <td style={{ padding: 4 }}><button style={S.btn} onClick={() => del(i)}>remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.row, marginTop: 10 }}>
            <button style={S.btn} onClick={add}>+ Add model</button>
            <button style={S.btnPri} onClick={save}>Save models</button>
            {msg ? <span style={S.ok}>{msg}</span> : null}{err ? <span style={S.err}>{err}</span> : null}
          </div>
        </>
      )}
    </Collapse>
  );
}

// ---------- Queue access ----------
function QueueAccess() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [defMode, setDefMode] = useState('all'); const [defSet, setDefSet] = useState(new Set());
  const [selUser, setSelUser] = useState(''); const [userMode, setUserMode] = useState('default'); const [userSet, setUserSet] = useState(new Set());
  const [msg, setMsg] = useState({});
  const applyDefault = (access) => { if (access.default === 'all' || access.default == null) { setDefMode('all'); setDefSet(new Set()); } else { setDefMode('some'); setDefSet(new Set(access.default)); } };
  function applyUser(user, access) { const v = (access.users || {})[user]; if (v === undefined) { setUserMode('default'); setUserSet(new Set()); } else if (v === 'all') { setUserMode('all'); setUserSet(new Set()); } else { setUserMode('some'); setUserSet(new Set(v)); } }
  useEffect(() => { req('/queue-access').then((r) => { setData(r); applyDefault(r.access || { default: 'all', users: {} }); const u = (r.users || [])[0] || ''; setSelUser(u); applyUser(u, r.access || {}); }).catch((e) => setErr(e.message)); }, []);
  const toggle = (set, setSet) => (id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setSet(n); };
  const saveDefault = async () => { setMsg((s) => ({ ...s, def: null })); try { const r = await req('/queue-access', { method: 'POST', body: JSON.stringify({ default: defMode === 'all' ? 'all' : Array.from(defSet) }) }); setData((d) => ({ ...d, access: r.access })); setMsg((s) => ({ ...s, def: { ok: true, text: 'Saved.' } })); } catch (e) { setMsg((s) => ({ ...s, def: { ok: false, text: e.message } })); } };
  const saveUser = async () => { if (!selUser) return; setMsg((s) => ({ ...s, user: null })); const payload = userMode === 'default' ? { user: selUser, clear: true } : { user: selUser, queues: userMode === 'all' ? 'all' : Array.from(userSet) }; try { const r = await req('/queue-access', { method: 'POST', body: JSON.stringify(payload) }); setData((d) => ({ ...d, access: r.access })); setMsg((s) => ({ ...s, user: { ok: true, text: 'Saved.' } })); } catch (e) { setMsg((s) => ({ ...s, user: { ok: false, text: e.message } })); } };
  const Checks = ({ set, onToggle }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 14px', margin: '6px 0' }}>
      {(data.queues || []).map((q) => <label key={q.id} style={{ ...S.muted, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={set.has(q.id)} onChange={() => onToggle(q.id)} /> {q.name}</label>)}
    </div>
  );
  return (
    <Collapse title={<>Queue access<Applies /></>}>
      <Ref>Which Salesforce <b>queues each non-admin user can see</b> — the same allow-list the chatbot’s queue picker and the email queue both honor. Set a <b>general default</b>, then <b>per-user overrides</b>. Admins always see every queue. App logins/roles are managed separately in <b>Users &amp; access</b>; this only governs queue visibility. Needs a working Salesforce connection to list queues.</Ref>
      {err ? <div style={S.err}>{err}</div> : !data ? <div style={S.muted}>Loading…</div> : (
        <>
          <div style={S.lbl}>General default</div>
          <label style={{ ...S.muted, display: 'block', margin: '4px 0' }}><input type="radio" name="kaDef" checked={defMode === 'all'} onChange={() => setDefMode('all')} /> All queues</label>
          <label style={{ ...S.muted, display: 'block', margin: '4px 0' }}><input type="radio" name="kaDef" checked={defMode === 'some'} onChange={() => setDefMode('some')} /> Only selected</label>
          {defMode === 'some' ? <Checks set={defSet} onToggle={toggle(defSet, setDefSet)} /> : null}
          <div style={{ ...S.row, marginTop: 6 }}><button style={S.btnPri} onClick={saveDefault}>Save default</button>{msg.def ? <span style={msg.def.ok ? S.ok : S.err}>{msg.def.text}</span> : null}</div>
          <div style={S.lbl}>Per-user override</div>
          <div style={S.row}>
            <span style={S.muted}>User:</span>
            <select value={selUser} onChange={(e) => { setSelUser(e.target.value); applyUser(e.target.value, (data && data.access) || {}); setMsg((s) => ({ ...s, user: null })); }} style={S.inp}>
              {(data.users || []).length === 0 ? <option value="">(no named users)</option> : null}
              {(data.users || []).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <label style={{ ...S.muted, display: 'block', margin: '4px 0' }}><input type="radio" name="kaUser" checked={userMode === 'default'} onChange={() => setUserMode('default')} /> Use default</label>
          <label style={{ ...S.muted, display: 'block', margin: '4px 0' }}><input type="radio" name="kaUser" checked={userMode === 'all'} onChange={() => setUserMode('all')} /> All queues</label>
          <label style={{ ...S.muted, display: 'block', margin: '4px 0' }}><input type="radio" name="kaUser" checked={userMode === 'some'} onChange={() => setUserMode('some')} /> Only selected</label>
          {userMode === 'some' ? <Checks set={userSet} onToggle={toggle(userSet, setUserSet)} /> : null}
          <div style={{ ...S.row, marginTop: 6 }}><button style={S.btnPri} onClick={saveUser} disabled={!selUser}>Save user</button>{msg.user ? <span style={msg.user.ok ? S.ok : S.err}>{msg.user.text}</span> : null}</div>
        </>
      )}
    </Collapse>
  );
}

// ---------- main ----------
const ORDER_KEY = 'ka_card_order';   // default order = the items order below (queue first)

export default function KnowledgeAdminSection() {
  const r = useRetrieval();
  const [nonce, setNonce] = useState(0);   // bump to remount ReorderableList after a reset
  const items = [
    { key: 'queue', node: <QueueAccess /> },
    { key: 'retrieval', node: <RetrievalBlendCard r={r} /> },
    { key: 'embedding', node: <EmbeddingCard r={r} /> },
    { key: 'allowlist', node: <AllowlistCard r={r} /> },
    { key: 'models', node: <ModelRegistry /> },
  ];
  const doReset = () => { resetOrder(ORDER_KEY); setNonce((n) => n + 1); };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Knowledge &amp; AI</h1>
          <div style={{ ...S.muted, marginTop: 2 }}>Shared settings for the chatbot and the email queue. Expand a card to see what it controls; drag the <b>⠿</b> handle to reorder. <button onClick={doReset} style={{ border: 0, background: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, padding: 0 }}>reset order</button></div>
        </div>
        <div style={S.row}><span style={S.pill}>◆ Chatbot</span><span style={S.pill}>◆ Email queue</span><span style={{ ...S.pill, color: '#b45309', borderColor: '#fde9cf', background: '#fff8ee' }}>admin only</span></div>
      </div>
      {r.err && !r.data ? <div style={{ ...S.note, color: '#dc2626', background: '#fef2f2', borderColor: '#fecaca' }}>{r.err}</div> : null}
      <ReorderableList key={nonce} storageKey={ORDER_KEY} items={items} />
    </div>
  );
}
