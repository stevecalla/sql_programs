import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Modal, fmtBytes } from './ui.jsx';
import { track } from '../../../lib/track.js';
import { ContextAddFiles, AskPanel } from '../../../lib/ui.jsx';

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
        classes={{ chips: 'cbx-chips', chip: 'cbx-chip', hist: 'cbx-ask-hist', dim: 'cbx-dim', qa: 'cbx-qa', q: 'cbx-q', ts: 'cbx-ts', a: 'cbx-a', ta: 'cbx-input cbx-ask-ta', askBtn: 'cbx-btn primary sm', seeMore: 'cbx-btn xs' }}
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
      <div className="cbx-corr-list">
        {rows == null ? <div className="cbx-dim">Loading…</div> : null}
        {rows && rows.length === 0 ? <div className="cbx-dim">No corrections yet.</div> : null}
        {(rows || []).map((r) => (
          <div className="cbx-corr" key={r.id}>
            <div className="cbx-corr-note">{r.note}</div>
            {r.question ? <div className="cbx-dim">re: {r.question}</div> : null}
          </div>
        ))}
      </div>
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
        <li><b>Pick a queue.</b> The <b>{queue}</b> queue sets the bot’s context space — its knowledge and corrections. Switching queues switches the whole surface.</li>
        <li><b>Grounded, not guessing.</b> The bot answers only from the curated <i>Context files</i> + <i>Corrections</i> for this queue. If it isn’t there, it says so and points to USA Triathlon.</li>
        <li><b>No member PII.</b> It never reads live Salesforce cases or member emails — only curated knowledge. Conversations logged here are the bot’s own turns.</li>
        <li><b>Test the assistant.</b> Use the card above or the bottom-right bubble to try questions. These log as <i>test</i> conversations (shown in the left list).</li>
        <li><b>Teach it.</b> Add a <i>Correction</i> to fix or sharpen an answer — it also improves the email queue, since they share the same brain.</li>
        <li><b>Add knowledge.</b> Upload files in <i>Context files</i>, or exclude ones that shouldn’t ground answers.</li>
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

// ---- GTM / public widget (spec) — a place to start speccing the embeddable public bot ----
function GtmSpecCard({ queue }) {
  const [copied, setCopied] = useState(false);
  const snippet = [
    '<!-- USAT AI Chat Bot — public widget (SPEC, not live) -->',
    '<script>',
    '  (function () {',
    "    var s = document.createElement('script');",
    "    s.src = 'https://apps.usatriathlon.org/chatbot/widget.js';",
    "    s.async = true;",
    "    s.dataset.queue = '" + (queue || 'TeamUSA') + "';   // which bot / context space",
    "    s.dataset.channel = 'web-widget';",
    '    document.head.appendChild(s);',
    '  })();',
    '</script>',
  ].join('\n');
  const copy = () => { try { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* ignore */ } };
  return (
    <Card title="Public widget (GTM) — spec">
      <div className="cbx-hint">Planning surface for the embeddable public bot. Nothing here is live yet.</div>
      <ul className="cbx-ref">
        <li><b>Delivery.</b> A tiny <code>widget.js</code> loaded via a GTM Custom HTML tag, keyed to a queue + <code>channel=web-widget</code>.</li>
        <li><b>Separate server.</b> Public traffic hits a dedicated endpoint (not this session-authed one) — same shared brain, curated knowledge only.</li>
        <li><b>PII posture.</b> Public transcripts need scrubbing/consent before logging; <code>is_test=0</code>. Never reads member cases.</li>
        <li><b>Allowed origins.</b> CORS allow-list of USAT properties; rate-limited.</li>
      </ul>
      <div className="cbx-dim">Sample GTM Custom HTML tag:</div>
      <pre className="cbx-snippet">{snippet}</pre>
      <div className="cbx-row-end"><button className="cbx-btn sm" onClick={copy}>{copied ? 'copied ✓' : 'copy snippet'}</button></div>
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

// The right rail: the shared-brain cards, all scoped to the selected queue.
export default function ChatbotAiPanel({ queue, selectedId }) {
  return (
    <>
      <ModelSelect />
      <AskCard queue={queue} selectedId={selectedId} />
      <CorrectionsCard queue={queue} />
      <ContextCard queue={queue} />
      <ReferenceCard queue={queue} />
      <GtmSpecCard queue={queue} />
    </>
  );
}
