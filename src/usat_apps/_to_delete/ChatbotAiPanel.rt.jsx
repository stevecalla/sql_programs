import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Modal, fmtBytes } from './ui.jsx';
import { track } from '../../../lib/track.js';
import { ContextAddFiles, AskPanel, CorrectionsList } from '../../../lib/ui.jsx';
import { UrlContextCard, RetrievePreviewCard } from './UrlContext.jsx';

function fileLocation(dir, scope, name, queueSlug) {
  const root = (dir || '').replace(/[\\/]+$/, '');
  const sub = scope === 'global' ? '_global' : (queueSlug || 'queue');
  const sep = root.indexOf('\\') >= 0 ? '\\' : '/';
  return [root, sub, name].filter(Boolean).join(sep);
}

// ---- Ask a question (INSPECTION) — shared AskPanel; answers about the selected conversation and/or the
// queue's knowledge. Does NOT create a turn (separate from the chat bubble). Same panel as the email queue. ----
const ASK_PRESETS = ['Summarize this conversation', 'Did the last answer match the knowledge?', 'What is missing from the knowledge to answer this?'];
function AskCard({ queue, selectedId }) {
  const [question, setQuestion] = useState('');
  const [hist, setHist] = useState([]);         // { q, a, ts }
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setHist([]); setErr(''); setExpanded(false); }, [queue]);
  const ask = async (q) => {
    const q0 = String(q == null ? question : q).trim(); if (!q0 || busy) return;
    setBusy(true); setErr('');
    const ts = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    try {
      const r = await api.ask({ queue, question: q0, conversation_id: selectedId || undefined });
      setHist((h) => h.concat([{ q: q0, a: r.answer || '(no answer)', ts: ts }]));
      setQuestion('');
      try { track('ask_question', { panel: 'chatbot', view: 'ask' }); } catch (e) { /* noop */ }
    } catch (e) { setHist((h) => h.concat([{ q: q0, a: '(error) ' + (e.message || 'failed'), ts: ts }])); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Ask a question" open summary={selectedId ? 'about selected' : 'about knowledge'}>
      <div className="cbx-hint">Answers about the {selectedId ? <b>selected conversation</b> : <span>queue <b>knowledge</b></span>} for <b>{queue}</b>. Does <b>not</b> create a turn — a review tool, separate from the chat bubble.</div>
      <AskPanel
        question={question} onQuestion={setQuestion} onAsk={ask}
        hist={hist} busy={busy} busyLabel="Thinking…"
        placeholder="Ask about the selected conversation or the knowledge…"
        presets={ASK_PRESETS}
        expanded={expanded} onToggleExpanded={() => setExpanded((x) => !x)}
        renderCopy={(t) => <button className="cbx-btn xs" onClick={() => { try { navigator.clipboard.writeText(t); } catch (e) { /* ignore */ } }}>📋 Copy</button>}
        onReset={() => { setHist([]); setQuestion(''); setExpanded(false); setErr(''); }}
        classes={{ chips: 'cbx-chips', chip: 'cbx-chip', hist: 'cbx-ask-hist', dim: 'cbx-dim', qa: 'cbx-qa', q: 'cbx-q', ts: 'cbx-ts', a: 'cbx-a', ta: 'cbx-input cbx-ask-ta', askBtn: 'cbx-btn primary sm', seeMore: 'cbx-btn xs', resetBtn: 'cbx-btn xs' }}
      />
      {err ? <div className="cbx-err">{err}</div> : null}
    </Card>
  );
}

// ---- Corrections (teach the AI) ----
function CorrectionsCard({ queue }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => { api.corrections(queue).then((r) => setRows(r.corrections || [])).catch((e) => setErr(e.message)); };
  useEffect(() => { setRows(null); setErr(''); load(); }, [queue]);
  const add = async () => {
    if (!note.trim() || busy) return; setBusy(true); setErr('');
    try { await api.addCorrection({ queue, question: q.trim(), note: note.trim(), scope: 'queue' }); setQ(''); setNote(''); load(); try { track('correction_add', { panel: 'chatbot', view: 'corrections' }); } catch (e2) { /* noop */ } }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const active = (rows || []).filter((r) => r.active);
  return (
    <Card title="Corrections (teach the AI)" summary={active.length ? active.length + ' active' : ''}>
      <div className="cbx-hint">A correction here also sharpens the email queue for <b>{queue}</b> — same shared brain.</div>
      <input className="cbx-input" placeholder="Question (optional)" value={q} onChange={(e) => setQ(e.target.value)} />
      <textarea className="cbx-input" rows={2} placeholder="Correction / note the AI should follow *" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="cbx-row-end"><button className="cbx-btn primary sm" onClick={add} disabled={busy || !note.trim()}>Add correction</button></div>
      {err ? <div className="cbx-err">{err}</div> : null}
      <CorrectionsList rows={rows} classes={{ list: 'cbx-corr-list', item: 'cbx-corr', note: 'cbx-corr-note', dim: 'cbx-dim' }} />
    </Card>
  );
}

// ---- Context files (knowledge the AI reads) ----
function ContextCard({ queue }) {
  const [ctx, setCtx] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState(null);
  const [upScope, setUpScope] = useState('queue');
  const [upMsg, setUpMsg] = useState('');
  const load = () => { setErr(''); api.context(queue).then(setCtx).catch((e) => setErr(e.message)); };
  useEffect(() => { setCtx(null); load(); }, [queue]);

  async function viewFile(f) {
    const loc = fileLocation(ctx && ctx.dir, f.scope, f.name, ctx && ctx.scope);
    setView({ name: f.base || f.name, node: <div className="cbx-dim">Loading…</div>, loc });
    try {
      try { track('context_view', { panel: 'chatbot', view: 'context' }); } catch (e2) { /* noop */ }
      const r = await api.contextFile(queue, f.scope, f.name);
      let node;
      if (r.kind === 'image') node = <img className="cbx-att-img" src={'data:' + r.media_type + ';base64,' + r.data_base64} alt={r.name} />;
      else if (r.kind === 'pdf') node = <iframe className="cbx-att-pdf" src={api.contextRawUrl(queue, f.name)} title={r.name} />;
      else if (r.kind === 'table') node = (
        <div className="cbx-att-tablewrap"><table className="cbx-att-table"><tbody>
          {(r.rows || []).slice(0, 200).map((row, i) => <tr key={i}>{(Array.isArray(row) ? row : [row]).map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>)}
        </tbody></table>{r.note ? <div className="cbx-dim">{r.note}</div> : null}</div>
      );
      else node = <pre className="cbx-att-text">{(r.text || '(no extractable text)') + (r.note ? '\n\n[' + r.note + ']' : '')}</pre>;
      setView({ name: r.name || f.base, node, dl: api.contextRawUrl(queue, f.name), loc });
    } catch (e) { setView({ name: f.base || f.name, node: <div className="cbx-err">Error: {e.message}</div>, loc }); }
  }
  async function toggleExclude(f) { try { await api.contextExclude(f.key, !f.excluded); load(); } catch (e) { setErr(e.message); } }
  function readB64(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '').split(',').pop()); fr.onerror = rej; fr.readAsDataURL(file); }); }
  async function uploadFiles(files, folder) {
    const arr = Array.from(files || []); if (!arr.length) return;
    let done = 0, skipped = 0;
    for (const f of arr) {
      setUpMsg('Uploading ' + (done + 1) + '/' + arr.length + '…');
      try { if (f.size > 25 * 1024 * 1024) { skipped++; continue; } const b64 = await readB64(f); await api.uploadContext({ queue, scope: upScope, name: f.name, data_base64: b64, folder: folder || '' }); done++; }
      catch (e) { skipped++; }
    }
    setUpMsg('Uploaded ' + done + ' file(s)' + (skipped ? ' · skipped ' + skipped : '') + (folder ? ' into folder "' + folder + '"' : '') + '.');
    if (done) { try { track('context_upload', { panel: 'chatbot', view: 'context' }); } catch (e2) { /* noop */ } }
    load();
  }

  const files = (ctx && ctx.files) || [];
  return (
    <Card title="Context files (knowledge the AI reads)" summary={ctx ? files.length + ' files' : ''}>
      <div className="cbx-row-between">
        <span className="cbx-dim">{ctx ? (Number(ctx.knowledge_chars || 0).toLocaleString() + ' chars · ' + (ctx.corrections_used || 0) + ' corrections') : (err ? 'error' : 'loading…')}</span>
        <button className="cbx-btn xs" onClick={load} title="Refresh">↻ Refresh</button>
      </div>
      {ctx && ctx.dir ? <div className="cbx-dir" title={ctx.dir}>📂 {ctx.dir}</div> : null}
      {err ? <div className="cbx-err">{err}</div> : null}
      <div className="cbx-ctx-list">
        {files.map((f, i) => (
          <div className={'cbx-ctx-row' + (f.excluded ? ' ex' : '')} key={i}>
            <span className="cbx-ctx-name" title={fileLocation(ctx.dir, f.scope, f.name, ctx.scope)}>{f.folder ? '📁 ' + f.folder + '/' : ''}{f.base || f.name}</span>
            <span className="cbx-ctx-sc">{f.scope === 'global' ? 'global' : (ctx.scope || 'queue')} · {fmtBytes(f.size)}</span>
            <button className="cbx-btn xs" onClick={() => viewFile(f)}>view</button>
            <button className="cbx-btn xs" onClick={() => toggleExclude(f)}>{f.excluded ? 'include' : 'exclude'}</button>
          </div>
        ))}
        {ctx && files.length === 0 && !err ? <div className="cbx-dim">No context files for {ctx.scope}. Add some below.</div> : null}
      </div>
      <ContextAddFiles scope={upScope} onScope={setUpScope} onUpload={uploadFiles} busyMsg={upMsg}
        classes={{ h: 'cbx-addh', row: 'cbx-addrow', select: 'cbx-select', btn: 'cbx-btn xs', msg: 'cbx-dim' }} />
      {view ? <Modal title={view.name} wide onClose={() => setView(null)} actions={view.dl ? <a className="cbx-btn sm" href={view.dl} target="_blank" rel="noopener">⬇ Download</a> : null}>
        {view.node}{view.loc ? <div className="cbx-modal-loc" title={view.loc}>{view.loc}</div> : null}
      </Modal> : null}
    </Card>
  );
}

// ---- Reference (how this works) — mirrors the email-queue reference card ----
function ReferenceCard({ queue }) {
  return (
    <Card title="How this works (reference)">
      <ul className="cbx-ref">
        <li><b>Pick a queue.</b> The <b>{queue}</b> queue sets the bot’s context space — its knowledge, web pages, and corrections. Switching queues switches the whole surface. The picker shows the live Salesforce queues you’re allowed to see (same access rules as the email queue).</li>
        <li><b>Grounding: Strict vs Broad.</b> The <b>Grounding</b> control at the top of this panel sets how far the bot can range.
          <ul>
            <li><i>Strict</i> (default) — answers <b>only</b> from this queue’s curated knowledge + corrections. If the answer isn’t there, it says so and points to USA Triathlon. Best for the public / member-facing bot.</li>
            <li><i>Broad</i> — still prefers the curated knowledge, but may fall back to general USA Triathlon and triathlon knowledge when the curated content doesn’t cover it. It will <b>not</b> invent specific policy, prices, fees, dates, deadlines, phone numbers, emails, or URLs, and still refuses off-topic questions.</li>
          </ul>
          It’s a chatbot-only setting and applies to every queue. The email queue is always strict by design.</li>
        <li><b>How it grounds.</b> For each question the bot retrieves the most relevant chunks from this queue’s <i>Context files</i> and <i>Web pages</i>, adds any <i>Corrections</i>, and answers from that. Use <i>Retrieval preview</i> to see exactly which chunks a question pulls.</li>
        <li><b>How it ranks (keyword + semantic).</b> Each chunk is scored two ways: <b>keyword</b> (BM25‑lite — a search‑engine formula: rarer/more‑specific words and heading matches count more, filler is ignored; fast and <i>literal</i>, matches words not meaning) and, when enabled, <b>semantic</b> (<i>embeddings</i> — the server sends each chunk (once, at ingest) and your question to an <b>embedding model</b>, e.g. OpenAI’s <code>text‑embedding‑3‑small</code>, which turns text into number vectors; chunks are then ranked by how close their vectors are = closeness of <b>meaning</b>, so “how much to join” finds “membership fee.” It’s a small, cheap lookup — <b>not</b> the ChatGPT/Claude call that actually writes the answer). A single <b>blend weight</b> decides how much each counts; the top blended chunks become the grounding. Use <i>Retrieval preview</i> to see the keyword/semantic/blended score per chunk.</li>
        <li><b>Where these are set.</b> The <b>blend weight</b>, the <b>embedding model</b> + reindex, the web allowlist, the AI model list, and queue access all live in <b>Admin → Knowledge &amp; AI</b> — one shared place that governs both this bot and the email queue. This bot’s <i>Strict vs Broad</i> control (top of this panel) is chatbot‑only.</li>
        <li><b>Add knowledge.</b> Upload files in <i>Context files</i>, or add allow-listed <i>Web pages</i> (URLs) that the bot snapshots and chunks. Exclude any file or chunk you don’t want grounding answers, and refresh a page to re-pull its content.</li>
        <li><b>Teach it.</b> Add a <i>Correction</i> to fix or sharpen an answer — corrections are authoritative and override the rest. They also improve the email queue, since both share the same brain.</li>
        <li><b>Ask about it.</b> Use <i>Ask a question</i> above (a review tool — it doesn’t create a turn) to check the bot against its knowledge; the bottom-right bubble runs the live grounding and logs as a <i>test</i> conversation. <i>Reset</i> (top of the Ask card) clears the box and its history.</li>
        <li><b>No member PII.</b> The bot never reads live Salesforce cases or member emails — only curated knowledge. Conversations logged here are the bot’s own turns.</li>
      </ul>
    </Card>
  );
}

// ---- Settings (AI model choice) — mirrors the email-queue Settings model picker ----
function SettingsCard() {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState('');       // "provider|model"
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.settings().then((r) => {
      setData(r);
      const st = r.settings || {};
      const models = r.models || [];
      const cur = st.model ? (st.provider + '|' + st.model) : (function () { const d = models.find((m) => m.is_default) || models[0]; return d ? (d.provider + '|' + d.model) : ''; })();
      setSel(cur);
    }).catch((e) => setErr(e.message));
  }, []);
  const save = async () => {
    if (!sel || busy) return; setBusy(true); setErr(''); setSaved(false);
    const [provider, model] = sel.split('|');
    try { const r = await api.saveSettings({ provider, model }); setData((d) => Object.assign({}, d, { settings: r.settings })); setSaved(true); setTimeout(() => setSaved(false), 1800); try { track('model_change', { panel: 'chatbot', view: 'settings' }); } catch (e2) { /* noop */ } }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const models = (data && data.models) || [];
  const byProvider = { openai: [], anthropic: [] };
  models.forEach((m) => { (byProvider[m.provider] || (byProvider[m.provider] = [])).push(m); });
  const label = (p) => (p === 'anthropic' ? 'Claude (Anthropic)' : 'ChatGPT (OpenAI)');
  return (
    <Card title="Settings — AI model" summary={data && data.settings ? (data.settings.model || 'default') : ''}>
      <div className="cbx-hint">The model this bot uses to answer. Same shared registry the email queue edits.</div>
      <select className="cbx-select" value={sel} onChange={(e) => setSel(e.target.value)}>
        {Object.keys(byProvider).filter((p) => byProvider[p] && byProvider[p].length).map((p) => (
          <optgroup key={p} label={label(p)}>
            {byProvider[p].map((m) => <option key={m.provider + '|' + m.model} value={m.provider + '|' + m.model}>{m.label}{m.is_default ? ' (default)' : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <div className="cbx-row-end" style={{ gap: 8, alignItems: 'center' }}>
        {saved ? <span className="cbx-dim" style={{ color: '#16a34a' }}>saved ✓</span> : null}
        <button className="cbx-btn primary sm" onClick={save} disabled={busy || !sel}>Save</button>
      </div>
      {err ? <div className="cbx-err">{err}</div> : null}
    </Card>
  );
}

// ==== Public widget panel (Chatbot → Public widget) ==================================================
// Three cards, laid out by WidgetSection.jsx as main preview + right rail (how-to + embed code), the same
// shell the operator/email-queue pages use. The server pins the queue (Team USA) + strict grounding.

// ---- Live preview (main area) — what you see here is EXACTLY what embeds ----
export function WidgetPreviewCard() {
  const [theme, setTheme] = useState('light');
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const src = base + '/api/public-chatbot/widget?theme=' + theme;
  return (
    <Card title="Public widget — live preview">
      <div className="cbx-hint">This is the <b>real</b> embeddable widget (pinned to <b>Team USA</b>, strict grounding, curated knowledge only — no PII). Style changes to the widget show up here immediately. Open the bubble to try it.</div>
      <div className="cbx-row-between" style={{ marginBottom: 8 }}>
        <span className="cbx-dim">Preview theme</span>
        <select className="cbx-select" style={{ width: 'auto' }} value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
      <div style={{ position: 'relative', height: 560, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: theme === 'dark' ? '#0f172a' : '#eef1f5' }}>
        <iframe title="Widget preview" src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
      </div>
    </Card>
  );
}

// ---- GTM step-by-step how-to (right rail) ----
export function WidgetGtmCard() {
  return (
    <Card title="How to embed with GTM">
      <ol className="cbx-ref">
        <li><b>New tag.</b> In Google Tag Manager, open the site’s container, then <i>Tags → New → Tag Configuration → Custom HTML</i>.</li>
        <li><b>Paste the loader.</b> Use <i>Option A</i> from the <b>Embed code</b> card below — the one-line <code>&lt;script async src="…/widget.js"&gt;</code>. Leave “Support document.write” unchecked; set <code>data-theme</code> to <code>light</code> or <code>dark</code>.</li>
        <li><b>Trigger.</b> Add a trigger — <i>All Pages</i> for site-wide, or a page-path trigger for one page (e.g. the test page <code>/iframe-test-page2</code>).</li>
        <li><b>Allow the origin.</b> The embedding site must be in the server’s <code>frame-ancestors</code> allow-list (env <code>CHATBOT_WIDGET_FRAME_ANCESTORS</code>). The preview / www / <code>*.usatriathlon.org</code> origins are allowed by default.</li>
        <li><b>Preview.</b> Click <i>Preview</i> in GTM, load the page, and confirm the bubble appears bottom-right and answers a Team USA question.</li>
        <li><b>Publish.</b> <i>Submit → Publish</i> the container version.</li>
        <li><b>GA4 events.</b> The widget pushes <code>chatbot_open</code>, <code>chatbot_ask</code>, <code>chatbot_answer</code>, and <code>chatbot_error</code> to the page’s <code>dataLayer</code>. Add GA4 Event tags fired on those as <i>Custom Event</i> triggers, then watch them in GA4 <i>DebugView</i>.</li>
      </ol>
      <div className="cbx-hint" style={{ marginTop: 10 }}>Verify the endpoints directly: <code>/api/public-chatbot/widget</code> (HTML), <code>/widget.js</code> (loader JS), <code>POST /ask</code> (answer). The chatbot module menu — <code>node …/modules/chatbot/menu.js</code> — probes all three on :5175 and :8022.</div>
    </Card>
  );
}

// ---- Embed code (right rail) — Option A: GTM loader script · Option B: raw iframe ----
export function WidgetEmbedCard() {
  const [theme, setTheme] = useState('light');
  const [copiedA, setCopiedA] = useState(false);
  const [copiedB, setCopiedB] = useState(false);
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'https://apps.usatriathlon.org';
  // Option A — the GTM loader: ONE <script> tag in a Custom HTML tag; it injects the iframe + resizer for you.
  const gtmSnippet = '<script async src="' + origin + '/api/public-chatbot/widget.js" data-theme="' + theme + '"></' + 'script>';
  // Option B — a raw iframe + a tiny resizer that grows/shrinks it on open/close, if you can place HTML directly.
  const iframeSnippet = [
    '<iframe id="usat-bot" title="USA Triathlon assistant" src="' + origin + '/api/public-chatbot/widget?theme=' + theme + '"',
    '  style="position:fixed;right:12px;bottom:12px;width:84px;height:84px;border:0;z-index:2147483000;background:transparent;color-scheme:normal;transition:width .15s,height .15s"></iframe>',
    '<script>',
    '  window.addEventListener("message", function (e) {',
    '    if (!e.data || e.data.source !== "usat-chatbot") return;',
    '    var f = document.getElementById("usat-bot"); if (!f) return;',
    '    if (e.data.event === "chatbot_open")  { f.style.width = "min(396px,100vw)"; f.style.height = "min(600px,100vh)"; }',
    '    if (e.data.event === "chatbot_close") { f.style.width = "84px"; f.style.height = "84px"; }',
    '    // also chatbot_ask / chatbot_answer / chatbot_error — forward to GA4 if desired:',
    '    // window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: e.data.event });',
    '  });',
    '</' + 'script>',
  ].join('\n');
  const copy = (text, which) => {
    try {
      navigator.clipboard.writeText(text);
      const set = which === 'a' ? setCopiedA : setCopiedB;
      set(true); setTimeout(() => set(false), 1500);
    } catch (e) { /* ignore */ }
  };
  return (
    <Card title="Embed code" summary="GTM / iframe">
      <div className="cbx-row-between" style={{ marginBottom: 8 }}>
        <span className="cbx-dim">Theme</span>
        <select className="cbx-select" style={{ width: 'auto' }} value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
      <div className="cbx-dim"><b>Option A — GTM (recommended).</b> Paste into a GTM <i>Custom HTML</i> tag. It injects the widget for you — no iframe to hand-place.</div>
      <pre className="cbx-snippet">{gtmSnippet}</pre>
      <div className="cbx-row-end"><button className="cbx-btn sm" onClick={() => copy(gtmSnippet, 'a')}>{copiedA ? 'copied ✓' : 'copy GTM tag'}</button></div>
      <div className="cbx-dim" style={{ marginTop: 12 }}><b>Option B — raw iframe.</b> If you can place HTML on the page directly.</div>
      <pre className="cbx-snippet">{iframeSnippet}</pre>
      <div className="cbx-row-end"><button className="cbx-btn sm" onClick={() => copy(iframeSnippet, 'b')}>{copiedB ? 'copied ✓' : 'copy iframe'}</button></div>
      <div className="cbx-hint" style={{ marginTop: 10 }}>The server must allow the embedding site in <code>frame-ancestors</code> (env <code>CHATBOT_WIDGET_FRAME_ANCESTORS</code>) or the frame won’t load.</div>
    </Card>
  );
}

// ---- AI model selector — at the TOP of the panel, like the email queue (saves on change) ----
function ModelSelect() {
  const [models, setModels] = useState([]);
  const [sel, setSel] = useState('');   // "provider|model"
  useEffect(() => {
    api.settings().then((r) => {
      const ms = r.models || []; setModels(ms);
      const st = r.settings || {};
      const cur = st.model ? (st.provider + '|' + st.model) : (function () { const d = ms.find((m) => m.is_default) || ms[0]; return d ? (d.provider + '|' + d.model) : ''; })();
      setSel(cur);
    }).catch(() => {});
  }, []);
  const change = (v) => {
    setSel(v);
    const parts = v.split('|');
    api.saveSettings({ provider: parts[0], model: parts[1] }).catch(() => {});
    try { track('model_change', { panel: 'chatbot', view: 'model' }); } catch (e) { /* noop */ }
  };
  if (!models.length) return null;
  return (
    <div className="cbx-modelbar" title="AI model — used to answer. Same shared registry the email queue edits.">
      <select className="cbx-select" value={sel} onChange={(e) => change(e.target.value)}>
        {models.map((m) => <option key={m.provider + '|' + m.model} value={m.provider + '|' + m.model}>{(m.provider === 'anthropic' ? 'Claude' : 'ChatGPT') + ' · ' + (m.label || m.model)}</option>)}
      </select>
    </div>
  );
}

// ---- Grounding mode selector — STRICT (curated content only) vs BROAD (general knowledge allowed) ----
// Chatbot-only control (the email queue is always strict by design). Saves on change, like ModelSelect.
function GroundingSelect() {
  const [mode, setMode] = useState('');   // '' until loaded, then 'strict' | 'broad'
  useEffect(() => {
    api.settings().then((r) => { const st = r.settings || {}; setMode(st.grounding === 'broad' ? 'broad' : 'strict'); }).catch(() => setMode('strict'));
  }, []);
  const change = (v) => {
    setMode(v);
    api.saveSettings({ grounding: v }).catch(() => {});
    try { track('grounding_change', { panel: 'chatbot', view: 'grounding', mode: v }); } catch (e) { /* noop */ }
  };
  if (!mode) return null;
  const tip = mode === 'broad'
    ? 'Broad: uses curated knowledge first, but may fall back to general USA Triathlon knowledge. Never invents specific policy/prices/dates; still refuses off-topic.'
    : 'Strict: answers ONLY from curated knowledge + corrections. If it isn’t there, the bot says so and points to USA Triathlon.';
  return (
    <div className="cbx-modelbar" title={tip}>
      <span className="cbx-dim" style={{ marginRight: 6 }}>Grounding</span>
      <select className="cbx-select" value={mode} onChange={(e) => change(e.target.value)}>
        <option value="strict">Strict · curated content only</option>
        <option value="broad">Broad · allow general knowledge</option>
      </select>
    </div>
  );
}

// The right rail: the shared-brain cards, all scoped to the selected queue.
export default function ChatbotAiPanel({ queue, selectedId }) {
  return (
    <>
      <ModelSelect />
      <GroundingSelect />
      <AskCard queue={queue} selectedId={selectedId} />
      <CorrectionsCard queue={queue} />
      <ContextCard queue={queue} />
      <UrlContextCard queue={queue} />
      <RetrievePreviewCard queue={queue} />
      <ReferenceCard queue={queue} />
    </>
  );
}
