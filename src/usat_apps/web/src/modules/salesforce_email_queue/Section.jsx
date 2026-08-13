import { useState, useEffect } from 'react';
import './sfeq.css';
import { api } from './lib/api.js';
import * as store from './lib/store.js';
import ResizeHandle from '../../lib/ResizeHandle.jsx';   // shared grabber (common with the chatbot)
import AiPanel from './components/AiPanel.jsx';
import { SfEnvBadge } from './EmailQueueRail.jsx';   // prod/sandbox indicator — shown on the case header line
import { Modal, RowsTable, fmtBytes, CopyButton } from './components/ui.jsx';
import { track, meta as trackMeta } from './lib/track.js';

// ---- helpers ----
const URL_RE = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
function extractLinks(text) { const m = String(text == null ? '' : text).match(URL_RE); return m ? m.map((u) => u.replace(/[.,;:)\]]+$/, '')) : []; }
function linkify(text, onLink) {
  const str = String(text == null ? '' : text); const re = new RegExp(URL_RE.source, 'gi'); const out = []; let last = 0, m, k = 0;
  while ((m = re.exec(str))) { const url = m[0].replace(/[.,;:)\]]+$/, ''); const end = m.index + url.length; if (m.index > last) out.push(str.slice(last, m.index)); out.push(<a key={k++} href="#" className="elink" onClick={(e) => { e.preventDefault(); onLink(url); }}>{url}</a>); last = end; re.lastIndex = end; }
  if (last < str.length) out.push(str.slice(last));
  return out;
}
// Does this HTML carry formatting worth showing (tables/images/lists/headings/several links/rich markup),
// or is it just a <p>/<br> wrapper around the same text? Drives the per-message default view.
function richHtml(html) {
  if (!html) return false;
  const h = String(html);
  if (/<(table|img|ul|ol|blockquote|h[1-6]|figure|hr)\b/i.test(h)) return true;
  if ((h.match(/<a\b/gi) || []).length >= 3) return true;
  if (/\bstyle\s*=\s*["'][^"']*(border|background|padding|width|font-|color)/i.test(h)) return true;
  if ((h.match(/<[a-z][a-z0-9]*\b/gi) || []).length >= 18) return true;
  return false;
}
// Smart default: rich HTML → show HTML; otherwise stripped text.
function smartMode(m) { return (m && m.html_body && richHtml(m.html_body)) ? 'html' : 'text'; }
function TriageBadge({ t }) {
  if (!t || !t.status) return null;
  const isLocal = t.ai === false;
  const src = isLocal ? 'Local rule (no AI)' : (t.ai === true ? ('AI' + (t.ai_model ? ' · ' + t.ai_model : '')) : '');
  const tip = (src ? src + ' — ' : '') + (t.reason || '');
  const label = (store.TRIAGE_LABEL[t.status] || t.status) + (isLocal ? ' *' : '');
  return <span className={'tstat ' + t.status} title={tip}>{label}</span>;
}

const isImg = (e) => /^(jpe?g|png|gif|webp|bmp|svg|heic|tiff?)$/i.test(String(e || ''));
const isTable = (e) => /^(csv|tsv|xlsx|xls)$/i.test(String(e || ''));
function Attachment({ a }) {
  const ext = String(a.file_extension || '').toLowerCase();
  const kind = isImg(ext) ? 'image' : (ext === 'pdf' ? 'pdf' : (isTable(ext) ? 'table' : 'text'));
  const label = (a.title || 'file') + (ext ? '.' + ext : '') + (a.content_size ? ' · ' + fmtBytes(a.content_size) : '');
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState(null);
  const [expanded, setExpanded] = useState(false);
  async function ensure() {
    if (node) return;
    if (kind === 'image') { setNode(<img className="eq-attimg" src={api.attachmentRawUrl(a.content_version_id, ext)} alt={a.title || 'image'} />); return; }
    if (kind === 'pdf') { setNode(<div className="dim">Loading PDF…</div>); try { const r = await fetch(api.attachmentRawUrl(a.content_version_id, 'pdf'), { credentials: 'same-origin' }); const ab = await r.arrayBuffer(); const url = URL.createObjectURL(new Blob([ab], { type: 'application/pdf' })); setNode(<iframe className="eq-attpdf" src={url} title={a.title || 'PDF'} />); } catch (e) { setNode(<div className="eq-err">Could not load PDF: {String((e && e.message) || e)}</div>); } return; }
    if (kind === 'table') { setNode(<div className="dim">Loading…</div>); try { const j = await api.attachmentTable(a.content_version_id, ext); setNode(j.rows && j.rows.length ? <RowsTable rows={j.rows} note={j.note} /> : <div className="dim">{j.note || '(no rows)'}</div>); } catch (e) { setNode(<div className="eq-err">Error: {e.message}</div>); } return; }
    setNode(<div className="dim">Extracting…</div>); try { const j = await api.attachmentText(a.content_version_id, ext, a.title || ''); setNode(<pre className="eq-attext">{(j.text || '(no extractable text)') + (j.note ? '\n\n[' + j.note + ']' : '')}</pre>); } catch (e) { setNode(<div className="eq-err">Error: {e.message}</div>); }
  }
  return (
    <div className="eq-matt">
      <div className="eq-inline">
        <span className="b b-att">{label}</span>
        <button className="eq-btn sm" onClick={async () => { if (!open) { await ensure(); track('attachment_viewed', { attachment_type: kind }); } setOpen((o) => !o); }}>{open ? 'hide ' + kind : 'view ' + kind}</button>
        <button className="eq-btn sm" onClick={async () => { await ensure(); setExpanded(true); }}>⤢ expand</button>
        <a className="eq-btn sm" href={api.attachmentRawUrl(a.content_version_id, ext)} target="_blank" rel="noopener" download={(a.title || 'file') + (ext ? '.' + ext : '')} title="Download this attachment">⬇ download</a>
      </div>
      {open ? <div className="eq-attpane">{node}</div> : null}
      {expanded ? <Modal title={label} onClose={() => setExpanded(false)}><div className="eq-attpane big">{node}</div></Modal> : null}
    </div>
  );
}

function MessageRow({ m, dedupe, mode, autoMode, collapsed }) {
  const role = m.incoming ? 'customer' : (m.automated ? 'auto' : 'agent');
  const roleLabel = role === 'customer' ? 'CUSTOMER' : (role === 'auto' ? 'AUTO-REPLY' : 'AGENT');
  const text = (dedupe ? (m.text_new || m.text_raw) : (m.text_raw || m.text_new)) || '(empty body)';
  const links = extractLinks(text);
  const canHtml = !!m.html_body;                 // only messages with an HTML body can offer the toggle
  const showHtml = mode === 'html' && canHtml;
  const overridden = store.getState().msgView[m.id] != null;   // did the operator pick this, vs. auto?
  return (
    <div className={'msg ' + role + (collapsed ? ' collapsed' : '')}>
      <div className="mhead" onClick={() => store.setCollapsed(m.id, !collapsed)}>
        <span className="eq-inline" style={{ flexWrap: 'wrap' }}>
          <span className={'who ' + role}>{roleLabel}{m.from_address ? '  ·  ' + m.from_address : ''}</span>
          {links.length ? <span className="b b-link" onClick={(e) => { e.stopPropagation(); store.openLink(links[0]); }}>🔗 {links.length}</span> : null}
        </span>
        <span className="eq-inline">
          {!collapsed && canHtml ? (
            <span className="eq-viewtoggle" onClick={(e) => e.stopPropagation()}
              title={overridden ? 'View overridden — double-click to return to auto' : 'Auto-picked · click to change this message'}
              onDoubleClick={() => store.setMsgView(m.id, null)}>
              <button className={mode === 'text' ? 'on' : ''} onClick={() => store.setMsgView(m.id, 'text')}>Text</button>
              <button className={mode === 'html' ? 'on' : ''} onClick={() => store.setMsgView(m.id, 'html')}>HTML</button>
              {!overridden ? <span className="eq-auto-tag" title={'Auto: ' + autoMode.toUpperCase()}>auto</span> : null}
            </span>
          ) : null}
          <span className="mdate">{m.message_date_mtn || ''}</span><span className={'eq-chev' + (collapsed ? '' : ' open')}>›</span>
        </span>
      </div>
      {collapsed ? <div className="mprev">{String(text).replace(/\s+/g, ' ').slice(0, 110)}</div> : (
        <div className="mbody">
          {showHtml
            ? <iframe className="mhtml" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" title="email HTML" srcDoc={'<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:10px;font:14px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">' + m.html_body + '</body></html>'} />
            : <p>{linkify(text, store.openLink)}</p>}
          {m.attachments && m.attachments.length ? <div className="matts"><div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>📎 {m.attachments.length} attachment{m.attachments.length > 1 ? 's' : ''} on this message:</div>{m.attachments.map((a, i) => <Attachment key={i} a={a} />)}</div> : null}
        </div>
      )}
    </div>
  );
}

function TriageControl({ s }) {
  const cs = s.sel; const t = s.triage[cs.case_id];
  if (t && t.status === 'pending') return <span className="dim">Triaging…</span>;
  if (t) return <span className="eq-inline"><TriageBadge t={t} /><button className="eq-btn sm" title="Re-run the AI status check" onClick={() => store.triageOne(cs)}>re-run</button></span>;
  return <button className="eq-btn sm" onClick={() => store.triageOne(cs)}>AI status</button>;
}

export default function Section() {
  const s = store.useEq();
  const sel = s.sel; const queueName = store.queueName();
  const [stMock, setStMock] = useState(false);

  useEffect(() => { setStMock(false); }, [sel && sel.case_id]);

  async function doStatusMock(v) { setStMock(true); try { await api.setStatus({ case_id: sel.case_id, case_number: sel.case_number, queue: queueName, queue_id: (store.queueObj() || {}).id || '', status: v, meta: trackMeta() }); } catch (e) { /* mocked */ } }

  const previewUrl = s.linkPreview ? (/^https?:\/\//i.test(s.linkPreview) ? s.linkPreview : 'https://' + s.linkPreview) : '';

  return (
    <div className="sfeq eq-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 6px ' + s.aiW + 'px' }}>
      <div className="eq-threadcol">
        {s.sfEnv === 'sandbox' ? <div className="eq-modebanner" title="Pointed at the Salesforce sandbox org">🧪 SANDBOX — practice data, not production</div> : null}
        {sel ? (
          <>
            <div className="eq-thead" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
              {/* Row 1 — case number + info + AI status + the prod/sandbox badge */}
              <div className="eq-inline" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {s.instanceUrl ? <a className="eq-caselink" href={s.instanceUrl + '/lightning/r/Case/' + sel.case_id + '/view'} target="_blank" rel="noopener">Case {sel.case_number || ''} ↗</a> : <b>Case {sel.case_number || ''}</b>}
                <span className="dim">· {s.thread.length} msg · newest first</span>
                <TriageControl s={s} />
                <SfEnvBadge env={s.sfEnv} />
              </div>
              {/* Row 2 — status */}
              <div className="eq-inline" style={{ gap: 8, alignItems: 'center' }}>
                <span className="dim" style={{ fontSize: 12 }}>Status:</span>
                <select className="eq-fld eq-statussel" value={sel.status || ''} onChange={(e) => doStatusMock(e.target.value)}>
                  {(s.statuses.length ? s.statuses : ['New', 'Working', 'Escalated', 'Closed']).map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                {stMock ? <span className="dim" style={{ fontSize: 11 }}>mock — not saved to SF</span> : null}
              </div>
              {/* Row 3 — view controls */}
              <div className="eq-inline" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span className="dim" style={{ fontSize: 11 }} title="Each message auto-picks HTML (if it has real formatting) or stripped text. Use the Text/HTML toggle in a message header to override it.">views auto-set per message</span>
                <label className="eq-check" title="For text-view messages: hide quoted history and repeated text"><input type="checkbox" checked={s.dedupe} onChange={(e) => store.set({ dedupe: e.target.checked })} /> Hide quoted/repeated</label>
                <button className="eq-btn sm" onClick={() => store.collapseAll(true)}>Collapse all</button>
                <button className="eq-btn sm" onClick={() => store.collapseAll(false)}>Expand all</button>
              </div>
            </div>
            <div className="eq-thread">
              {s.loadingThread ? <div className="dim">Loading thread…</div>
                : !s.thread.length ? <div className="dim">No email messages on this case.</div>
                : s.thread.slice().reverse().map((m) => { const auto = smartMode(m); const mode = s.msgView[m.id] || auto; return <MessageRow key={m.id} m={m} dedupe={s.dedupe} mode={mode} autoMode={auto} collapsed={!!s.collapsed[m.id]} />; })}
            </div>
          </>
        ) : <div className="eq-empty">Select a case to view the thread.</div>}
      </div>

      <ResizeHandle target="gridNext" dir={-1} min={store.AI_MIN} max={store.AI_MAX} def={store.AI_DEF}
        current={() => store.getState().aiW} onCommit={store.setAiW} title="Drag to resize the AI panel · double-click to reset" />

      <aside className="eq-ai">
        <AiPanel s={s} />
      </aside>

      {s.linkPreview ? (
        <Modal title="Link preview" onClose={() => store.closeLink()} actions={<span className="eq-inline"><CopyButton text={previewUrl} label="📋 Copy link" /><a className="eq-btn sm" href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a></span>}>
          <div className="note warn">This link came from an email — verify before trusting it: <b>{previewUrl}</b></div>
          <iframe className="eq-linkframe" sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" src={previewUrl} title="link preview" />
        </Modal>
      ) : null}
    </div>
  );
}
