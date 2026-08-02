import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import * as store from '../lib/store.js';
import { track, meta as trackMeta } from '../lib/track.js';
import { Modal, RowsTable, fmtBytes, copyText, CopyButton, downloadText } from './ui.jsx';

const ASK_PRESETS = [
  'Summarize the case',
  'What is the customer asking?',
  'What information is missing to answer?',
  'Is this within our scope or should it be escalated?',
  'Draft a brief, friendly holding reply',
  'What are the suggested next steps?',
];
const ACK_PROMPT = 'Write a brief, friendly acknowledgement / holding reply to the customer for this case: confirm we received their message and are looking into it, and that we will follow up. Do NOT promise or invent any specific timeframe, price, policy, email, phone, or other detail that is not in the context. End with the SAME closing sign-off and team signature (team name, phone number, etc.) used in the automated reply in this thread; copy it verbatim if present and do not invent contact details. If the thread has no such sign-off, close simply with "Best regards," and "USA Triathlon". 2-4 sentences plus the sign-off, ready to send.';

function recordsToRows(records) {
  if (!records || !records.length) return [];
  const cols = []; const seen = new Set();
  records.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!seen.has(k)) { seen.add(k); cols.push(k); } }));
  const cell = (v) => (v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
  return [cols].concat(records.map((r) => cols.map((c) => cell(r[c]))));
}
function rowsToCsv(rows) {
  return (rows || []).map((r) => (r || []).map((c) => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
}

function Card({ title, open, onToggle, summary, children }) {
  return (
    <div className="eq-card">
      <div className="eq-cardhead" onClick={onToggle}>
        <h3 className="eq-h" style={{ margin: 0 }}>{title}</h3>
        {summary ? <span className="eq-summary">{summary}</span> : null}
        <span className={'eq-chev' + (open ? ' open' : '')}>›</span>
      </div>
      {open ? <div className="eq-cardbody">{children}</div> : null}
    </div>
  );
}

export default function AiPanel({ s }) {
  const sel = s.sel; const model = s.model; const queueName = store.queueName();
  const cid = sel ? sel.case_id : '';

  const [open, setOpen] = useState({ resp: true, ask: false, corr: false, ctx: false, soql: false, ref: false });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // Card 1 — reply
  const [busy, setBusy] = useState('');
  const [verdict, setVerdict] = useState('');
  const [reply, setReply] = useState('');
  const [sendMsg, setSendMsg] = useState(null);   // { cls, text }
  const [err, setErr] = useState('');

  // Card 2 — ask
  const [question, setQuestion] = useState('');
  const [hist, setHist] = useState([]);           // { q, a, ts }
  const [askExpanded, setAskExpanded] = useState(false);

  // Card 3 — corrections
  const [corrNote, setCorrNote] = useState('');
  const [corrScope, setCorrScope] = useState('queue');
  const [corrMsg, setCorrMsg] = useState('');

  // Card 4 — context
  const [ctx, setCtx] = useState(null);           // { files, knowledge_chars }
  const [ctxBusy, setCtxBusy] = useState(false);
  const [ctxView, setCtxView] = useState(null);   // { name, node }
  const [upScope, setUpScope] = useState('queue');
  const [upMsg, setUpMsg] = useState('');
  const fileRef = useRef(null); const folderRef = useRef(null);

  // Card 5 — soql
  const [threadQ, setThreadQ] = useState('');
  const [caseQ, setCaseQ] = useState('');
  const [soql, setSoql] = useState({ which: '', busy: false, err: '', total: 0, rows: [] });
  const [soqlExpand, setSoqlExpand] = useState(false);

  // reset per case
  useEffect(() => {
    setBusy(''); setVerdict(''); setReply(''); setSendMsg(null); setErr('');
    setQuestion(''); setHist([]); setAskExpanded(false);
    setCorrNote(''); setCorrMsg('');
    setCtx(null); setCtxView(null); setUpMsg('');
    setSoql({ which: '', busy: false, err: '', total: 0, rows: [] });
    if (cid) {
      setThreadQ("SELECT Id, ParentId, Incoming, MessageDate, FromAddress, ToAddress, Subject, TextBody\nFROM EmailMessage\nWHERE ParentId = '" + cid + "'\nORDER BY MessageDate");
      setCaseQ("SELECT Id, CaseNumber, Subject, Status, Origin, CreatedDate, LastModifiedDate, SuppliedEmail\nFROM Case\nWHERE Id = '" + cid + "'");
    }
  }, [cid]);

  // Auto-draft when this case is already triaged answer_ready
  const triaged = sel ? s.triage[cid] : null;
  useEffect(() => {
    if (sel && triaged && triaged.status === 'answer_ready' && !reply && busy !== 'draft') { doDraft(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, triaged && triaged.status]);

  // AI payload base: model + queue/case ids + client meta (so server ai_call events carry visitor/session).
  const base = () => ({ case_id: cid, case_number: sel && sel.case_number, queue: queueName, queue_id: (store.queueObj() || {}).id || '', provider: model && model.provider, model: model && model.model, meta: trackMeta() });

  async function doDraft() {
    if (!sel) return; setBusy('draft'); setErr(''); setVerdict('');
    try { const r = await api.aiRespond(base()); setVerdict(r.verdict === 'need_info' ? 'NEED INFO' : 'DRAFT'); setReply(r.body || ''); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function doAck() {
    if (!sel) return; setBusy('ack'); setErr(''); setVerdict('');
    try { const r = await api.aiAsk(Object.assign(base(), { question: ACK_PROMPT, action: 'acknowledge' })); setVerdict('ACKNOWLEDGEMENT'); setReply(r.answer || ''); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function doSend() {
    if (!reply.trim()) { setSendMsg({ cls: '', text: 'Nothing to send yet — draft or write a reply first.' }); return; }
    setSendMsg(null);
    try { const r = await api.send(Object.assign(base(), { body: reply })); setSendMsg({ cls: 'ok', text: r.mocked ? 'Read-only build — not sent to Salesforce (mock OK).' : 'Sent.' }); }
    catch (e) { setSendMsg({ cls: 'warn', text: e.message }); }
  }

  async function ask(q) {
    const question0 = String(q == null ? question : q).trim(); if (!question0) return;
    setBusy('ask'); setErr(''); const ts = new Date().toLocaleTimeString();
    const turns = hist.slice(-6).map((h) => ({ q: h.q, a: h.a }));
    try { const r = await api.aiAsk(Object.assign(base(), { question: question0, history: turns })); setHist((h) => h.concat([{ q: question0, a: r.answer || '', ts }])); setQuestion(''); }
    catch (e) { setHist((h) => h.concat([{ q: question0, a: '(error) ' + e.message, ts }])); }
    finally { setBusy(''); }
  }

  async function addCorr() {
    if (!corrNote.trim()) return; setBusy('corr'); setCorrMsg('');
    try { await api.addCorrection({ note: corrNote.trim(), scope: corrScope, queue: queueName, case_id: cid }); setCorrNote(''); setCorrMsg('Saved — it will ground future drafts & answers.'); track('correction_added', { correction_scope: corrScope, queue: queueName }); await store.reloadCorrections(); }
    catch (e) { setCorrMsg(e.message); } finally { setBusy(''); }
  }

  async function loadCtx() {
    setCtxBusy(true);
    try { const r = await api.context(queueName); setCtx({ files: r.files || [], knowledge_chars: r.knowledge_chars || 0 }); }
    catch (e) { setCtx({ files: [], knowledge_chars: 0, err: e.message }); } finally { setCtxBusy(false); }
  }
  function onCtxOpen() { toggle('ctx'); if (!ctx) loadCtx(); }
  async function toggleExclude(f) {
    try { await api.contextExclude(f.key, !f.excluded); track('context_changed', { context_action: f.excluded ? 'include' : 'exclude', queue: queueName }); await loadCtx(); } catch (e) { setUpMsg(e.message); }
  }
  async function viewCtx(f) {
    setCtxView({ name: f.base || f.name, node: <div className="dim">Loading…</div> });
    try {
      const r = await api.contextFile(f.scope, queueName, f.name);
      track('context_viewed', { attachment_type: r.kind || '', queue: queueName });
      let node;
      if (r.kind === 'image') node = <img className="eq-attimg" src={'data:' + r.media_type + ';base64,' + r.data_base64} alt={r.name} />;
      else if (r.kind === 'pdf') node = <iframe className="eq-attpdf" src={api.contextRawUrl(f.scope, queueName, f.name)} title={r.name} />;
      else if (r.kind === 'table') node = <RowsTable rows={r.rows} note={r.note} />;
      else node = <pre className="eq-attext">{(r.text || '(no extractable text)') + (r.note ? '\n\n[' + r.note + ']' : '')}</pre>;
      setCtxView({ name: r.name || f.base, node, dl: api.contextRawUrl(f.scope, queueName, f.name) });
    } catch (e) { setCtxView({ name: f.base || f.name, node: <div className="eq-err">Error: {e.message}</div> }); }
  }
  function readAsB64(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '').split(',').pop()); fr.onerror = rej; fr.readAsDataURL(file); }); }
  async function uploadFiles(files, folder) {
    const arr = Array.from(files || []); if (!arr.length) return;
    let done = 0, skipped = 0;
    for (const f of arr) {
      setUpMsg('Uploading ' + (done + 1) + '/' + arr.length + '…');
      try { if (f.size > 25 * 1024 * 1024) { skipped++; continue; } const b64 = await readAsB64(f); await api.uploadContext({ scope: upScope, queue: queueName, name: f.name, content_base64: b64, folder: folder || '' }); done++; }
      catch (e) { skipped++; }
    }
    setUpMsg('Uploaded ' + done + ' file(s)' + (skipped ? ' · skipped ' + skipped : '') + (folder ? ' into folder "' + folder + '"' : '') + '.');
    if (done) track('context_changed', { context_action: 'upload', queue: queueName });
    await loadCtx();
  }

  async function runSoql(which, q) {
    setSoql({ which, busy: true, err: '', total: 0, rows: [] });
    track('soql_run', { soql_chars: (q || '').length, queue: queueName });
    try { const r = await api.soql(q); setSoql({ which, busy: false, err: '', total: r.total || 0, rows: recordsToRows(r.records) }); }
    catch (e) { setSoql({ which, busy: false, err: e.message, total: 0, rows: [] }); }
  }

  if (!sel) return <div className="dim" style={{ padding: 20 }}>Select a case, then draft a reply or ask a question.</div>;

  const corrCount = (s.corr || []).length;
  const groundLine = ctx ? ('AI is grounding on ' + (ctx.files || []).filter((f) => !f.excluded).length + ' context file(s) (' + (ctx.knowledge_chars || 0).toLocaleString() + ' chars) · ' + corrCount + ' correction(s).') : '';
  const shownHist = askExpanded ? hist.slice().reverse() : hist.slice(-2).reverse();

  return (
    <>
      {model ? (
        <select className="eq-fld" value={model.model} onChange={(e) => store.setModel(s.models.find((m) => m.model === e.target.value) || model)} title="AI model — used for triage, draft & ask.">
          {s.models.map((m) => <option key={m.model} value={m.model}>{(m.label || m.model) + ' · ' + m.model}</option>)}
        </select>
      ) : null}

      {/* Card 1 — AI suggested response */}
      <Card title="AI suggested response" open={open.resp} onToggle={() => toggle('resp')}>
        <div className="eq-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="eq-btn pri" onClick={doDraft} disabled={busy === 'draft'}>{busy === 'draft' ? 'Thinking…' : '✎ Draft reply'}</button>
          <button className="eq-btn" title="Generate a short, friendly acknowledgement (no specifics) you can send now" onClick={doAck} disabled={busy === 'ack'}>{busy === 'ack' ? 'Writing…' : 'Acknowledge receipt'}</button>
        </div>
        {verdict ? <div style={{ margin: '8px 0 0' }}><span className={'eq-verdict ' + (verdict === 'NEED INFO' ? 'need' : 'draft')}>{verdict}</span></div> : null}
        {err ? <div className="eq-err">{err}</div> : null}
        <h3 className="eq-h" style={{ marginTop: 10 }}>Reply (editable)</h3>
        <textarea className="eq-fld eq-grow" style={{ minHeight: 220 }} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="The AI draft appears here and is fully editable. You can also compose a reply yourself, even if the AI said it needs more info." />
        <div className="eq-inline" style={{ gap: 8 }}>
          <button className="eq-btn" onClick={doSend}>Send reply</button>
          <CopyButton text={() => reply} label="📋 Copy reply" onCopied={() => track('reply_copied', { ai_reply_chars: reply.length })} />
        </div>
        {sendMsg ? <div className={'note ' + (sendMsg.cls === 'ok' ? 'ok' : sendMsg.cls === 'warn' ? 'warn' : '')} style={{ marginTop: 8 }}>{sendMsg.text}</div> : null}
      </Card>

      {/* Card 2 — Ask */}
      <Card title="Ask a question" open={open.ask} onToggle={() => toggle('ask')}>
        <div className="eq-chips">
          {ASK_PRESETS.map((p) => <button key={p} className="qchip" onClick={() => ask(p)} disabled={busy === 'ask'}>{p}</button>)}
        </div>
        {hist.length ? (
          <div className="eq-askhist">
            {busy === 'ask' ? <div className="dim">Thinking ({model ? (model.provider === 'anthropic' ? 'Claude' : 'ChatGPT') : 'AI'})…</div> : null}
            {shownHist.map((h, i) => (
              <div className="eq-qa" key={i}>
                <div className="eq-q"><b>Q:</b> {h.q} <span className="sc">{h.ts}</span></div>
                <div className="eq-a">{h.a}</div>
                <CopyButton text={h.a} label="📋 Copy" />
              </div>
            ))}
            {hist.length > 2 ? <button className="eq-btn sm ghost" onClick={() => setAskExpanded((x) => !x)}>{askExpanded ? 'See less' : 'See ' + (hist.length - 2) + ' earlier'}</button> : null}
          </div>
        ) : null}
        <textarea className="eq-fld" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about this case…" />
        <button className="eq-btn" onClick={() => ask()} disabled={busy === 'ask' || !question.trim()}>{busy === 'ask' ? 'Asking…' : 'Ask'}</button>
      </Card>

      {/* Card 3 — Corrections */}
      <Card title="Corrections (teach the AI)" open={open.corr} onToggle={() => toggle('corr')} summary={corrCount ? corrCount + ' active' : ''}>
        <div className="dim" style={{ marginBottom: 8 }}>Corrections are injected into the AI grounding so future drafts and answers honor them.</div>
        {(s.corr || []).slice(0, 8).map((x) => <div className="eq-corr" key={x.id}><span>{x.note}</span><span className="sc">{x.scope}{x.queue ? ' · ' + x.queue : ''}</span></div>)}
        {!(s.corr || []).length ? <div className="dim">(no corrections yet)</div> : null}
        <textarea className="eq-fld" style={{ marginTop: 8 }} value={corrNote} onChange={(e) => setCorrNote(e.target.value)} placeholder="e.g. Coaching cert processing takes 2–3 weeks, not 4–6. Send renewals to memberservices@usatriathlon.org." />
        <div className="eq-inline" style={{ gap: 8 }}>
          <select className="eq-fld" style={{ margin: 0, width: 'auto' }} value={corrScope} onChange={(e) => setCorrScope(e.target.value)}>
            <option value="me">Just me (your drafts)</option>
            <option value="queue">This queue (all users)</option>
            <option value="global">All queues (all users)</option>
          </select>
          <button className="eq-btn sm" onClick={addCorr} disabled={busy === 'corr' || !corrNote.trim()}>Add correction</button>
        </div>
        {corrMsg ? <div className="note ok" style={{ marginTop: 8 }}>{corrMsg}</div> : null}
      </Card>

      {/* Card 4 — Context files */}
      <Card title="Context files (knowledge the AI reads)" open={open.ctx} onToggle={onCtxOpen}>
        <div className="eq-inline" style={{ justifyContent: 'space-between' }}>
          <span className="dim" style={{ fontSize: 11 }}>{ctxBusy ? 'Loading…' : groundLine}</span>
          <button className="eq-btn sm" onClick={loadCtx} title="Reload the context list">↻ Refresh</button>
        </div>
        <div className="eq-ctxlist">
          {ctx && ctx.files && ctx.files.length ? ctx.files.map((f) => (
            <div className={'eq-ctxrow' + (f.excluded ? ' ex' : '')} key={f.key}>
              <span className="eq-ctxname" title={f.name}>{f.folder ? '📁 ' + f.folder + '/' : ''}{f.base || f.name}</span>
              <span className="sc">{f.scope} · {fmtBytes(f.size)}{f.excluded ? ' · excluded' : ''}</span>
              <button className="eq-btn sm" onClick={() => viewCtx(f)}>view</button>
              <button className="eq-btn sm" onClick={() => toggleExclude(f)}>{f.excluded ? 'include' : 'exclude'}</button>
            </div>
          )) : (ctx ? <div className="dim">(no context files yet)</div> : null)}
        </div>
        <h3 className="eq-h" style={{ marginTop: 10 }}>Add files</h3>
        <div className="eq-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="eq-fld" style={{ margin: 0, width: 'auto' }} value={upScope} onChange={(e) => setUpScope(e.target.value)}>
            <option value="queue">This queue only</option>
            <option value="global">Global (all queues)</option>
          </select>
          <button className="eq-btn sm" onClick={() => fileRef.current && fileRef.current.click()}>Choose file(s)</button>
          <button className="eq-btn sm" onClick={() => folderRef.current && folderRef.current.click()} title="Reads every file in the folder">Choose folder</button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { uploadFiles(e.target.files, ''); e.target.value = ''; }} />
          <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => { const files = e.target.files; const folder = files && files[0] && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : ''; uploadFiles(files, folder); e.target.value = ''; }} />
        </div>
        {upMsg ? <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>{upMsg}</div> : null}
      </Card>

      {/* Card 5 — SOQL */}
      <Card title="SOQL (editable, runs read-only)" open={open.soql} onToggle={() => toggle('soql')}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>Case Id: {cid} · Case #{sel.case_number || ''} — edit, then Run (results below) or Copy for Workbench.</div>
        <div className="eq-lbl">Thread query (EmailMessage)</div>
        <textarea className="eq-fld eq-mono" value={threadQ} onChange={(e) => setThreadQ(e.target.value)} spellCheck={false} />
        <div className="eq-inline" style={{ gap: 8 }}>
          <button className="eq-btn sm" onClick={() => runSoql('thread', threadQ)} disabled={soql.busy}>Run query</button>
          <CopyButton text={() => threadQ} label="📋 Copy SOQL" />
        </div>
        <div className="eq-lbl" style={{ marginTop: 10 }}>Case query</div>
        <textarea className="eq-fld eq-mono" style={{ minHeight: 64 }} value={caseQ} onChange={(e) => setCaseQ(e.target.value)} spellCheck={false} />
        <div className="eq-inline" style={{ gap: 8 }}>
          <button className="eq-btn sm" onClick={() => runSoql('case', caseQ)} disabled={soql.busy}>Run case query</button>
          <CopyButton text={() => caseQ} label="📋 Copy case SOQL" />
          <a className="eq-btn sm" href="https://workbench.developerforce.com/query.php" target="_blank" rel="noopener" title="Workbench can't be pre-filled — copy the query, then paste it there">Open Workbench ↗</a>
        </div>
        <div className="eq-soqlres">
          {soql.busy ? <div className="dim">Running…</div>
            : soql.err ? <div className="eq-err">Error: {soql.err}</div>
            : soql.rows.length ? (
              <>
                <div className="eq-inline" style={{ justifyContent: 'space-between', margin: '8px 0 4px' }}>
                  <span className="dim" style={{ fontSize: 11 }}>{soql.total} record(s){soql.rows.length - 1 < soql.total ? ' — more not shown' : ''}</span>
                  <span className="eq-inline" style={{ gap: 6 }}>
                    <button className="eq-btn sm" onClick={() => downloadText('soql_' + (soql.which || 'results') + '.csv', rowsToCsv(soql.rows), 'text/csv')}>⬇ Download CSV</button>
                    <button className="eq-btn sm" onClick={() => setSoqlExpand(true)}>⤢ Expand</button>
                  </span>
                </div>
                <RowsTable rows={soql.rows} />
              </>
            ) : null}
        </div>
      </Card>

      {/* Card 6 — How this works (reference) */}
      <Card title="How this works (reference)" open={open.ref} onToggle={() => toggle('ref')}>
        <ol className="eq-ref">
          <li><b>Pick a queue & load cases.</b> Choose a Salesforce queue, status and date range in the left rail, then <i>View</i>. Cases are read live from Salesforce — <b>read-only</b>, nothing is written back.</li>
          <li><b>Open a case & read the thread.</b> The middle pane shows the full email thread (newest first). Each message auto-picks HTML or stripped text; attachments can be viewed inline.</li>
          <li><b>Let the AI triage & draft.</b> <i>AI status</i> classifies the case (answer-ready, needs info, spam…). <i>Draft reply</i> writes a full response; <i>Acknowledge receipt</i> writes a short holding reply. Answer-ready cases auto-draft.</li>
          <li><b>Refine, then use the reply.</b> Edit the draft, <i>Ask</i> follow-up questions, or add a <i>Correction</i> to teach the AI. <i>Send</i> is mocked in this build; <i>Copy</i> puts the reply on your clipboard to paste into Salesforce.</li>
          <li><b>Dig deeper if needed.</b> Add <i>Context files</i> the AI should read, or run read-only <i>SOQL</i> to inspect the raw records behind a case.</li>
        </ol>
        <h3 className="eq-h" style={{ marginTop: 4 }}>How the AI works & what it can see</h3>
        <p className="eq-refp">When you draft or ask, the server rebuilds the case context from Salesforce and sends the model: the <b>full email thread</b>, this sender's <b>prior case history</b>, extracted <b>attachment text</b>, the queue's <b>knowledge / context files</b>, and any <b>operator corrections</b> scoped to you / this queue / all queues. Triage sees the thread plus the queue knowledge.</p>
        <p className="eq-refp">The <b>model picker</b> at the top applies to triage, draft and ask alike — stronger models classify and write more reliably. A <b>local rule</b> (marked <b>*</b>) may decide obvious cases (e.g. spam) with no AI call. The AI is grounded on <b>curated knowledge and the case itself</b>; it never invents specifics that aren't in that context, and this build makes <b>no changes in Salesforce</b>.</p>
      </Card>

      {ctxView ? <Modal title={ctxView.name} onClose={() => setCtxView(null)} wide actions={ctxView.dl ? <a className="eq-btn sm" href={ctxView.dl} target="_blank" rel="noopener">⬇ Download</a> : null}><div className="eq-attpane big">{ctxView.node}</div></Modal> : null}
      {soqlExpand ? <Modal title="SOQL results" onClose={() => setSoqlExpand(false)} wide actions={<button className="eq-btn sm" onClick={() => downloadText('soql_' + (soql.which || 'results') + '.csv', rowsToCsv(soql.rows), 'text/csv')}>⬇ Download CSV</button>}><div className="eq-attpane big"><RowsTable rows={soql.rows} /></div></Modal> : null}
    </>
  );
}
