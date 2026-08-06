import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Shared, STYLE-AGNOSTIC UI primitives. The behavior (collapsible toggle, portal, Esc/backdrop close) lives
// here ONCE; each caller passes its own class names via `classes` so a module keeps its exact look
// (email queue: eq-*, chatbot: cbx-*). This lets both modules share the logic without changing any styling.

// Collapsible card: header (title + optional summary + chevron) that toggles a body. Controlled via
// open/onToggle. Markup mirrors the email-queue + chatbot cards exactly when given their class maps.
export function Collapsible({ title, open, onToggle, summary, children, classes }) {
  const c = classes || {};
  return (
    <div className={c.card}>
      <div className={c.head} onClick={onToggle}>
        <h3 className={c.h} style={{ margin: 0 }}>{title}</h3>
        {summary ? <span className={c.summary}>{summary}</span> : null}
        <span className={(c.chev || '') + (open ? ' open' : '')}>›</span>
      </div>
      {open ? <div className={c.body}>{children}</div> : null}
    </div>
  );
}

// Portal modal: closes on backdrop click and Escape. `classes` maps each slot; `titleClass` optional (email
// queue renders a bare <h3>, chatbot styles it). `closeLabel` lets each keep its own button text.
export function PortalModal({ title, onClose, actions, children, wide, classes, titleClass, closeLabel }) {
  const c = classes || {};
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className={c.bg} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={(c.modal || '') + (wide ? ' wide' : '')}>
        <div className={c.head}>
          <h3 className={titleClass}>{title}</h3>
          <span className={c.actions}>{actions}<button className={c.closeBtn} title="Close (Esc)" onClick={onClose}>{closeLabel || '✕ Close'}</button></span>
        </div>
        <div className={c.body}>{children}</div>
      </div>
    </div>, document.body);
}

// Shared "Add files" control (scope select + Choose file(s) + Choose folder) — the same feature the email
// queue uses, style-agnostic via `classes`/`styles` so each module keeps its look. `onUpload(fileList, folder)`
// is module-specific (each posts to its own API). Folder upload uses webkitdirectory and passes the top folder.
export function ContextAddFiles({ scope, onScope, onUpload, busyMsg, heading, classes, styles }) {
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const c = classes || {};
  const st = styles || {};
  return (
    <>
      <h3 className={c.h} style={st.h}>{heading || 'Add files'}</h3>
      <div className={c.row} style={st.row}>
        <select className={c.select} style={st.select} value={scope} onChange={(e) => onScope(e.target.value)}>
          <option value="queue">This queue only</option>
          <option value="global">Global (all queues)</option>
        </select>
        <button className={c.btn} onClick={() => fileRef.current && fileRef.current.click()}>Choose file(s)</button>
        <button className={c.btn} onClick={() => folderRef.current && folderRef.current.click()} title="Reads every file in the folder">Choose folder</button>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { onUpload(e.target.files, ''); e.target.value = ''; }} />
        <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => { const files = e.target.files; const folder = files && files[0] && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : ''; onUpload(files, folder); e.target.value = ''; }} />
      </div>
      {busyMsg ? <div className={c.msg} style={st.msg}>{busyMsg}</div> : null}
    </>
  );
}

// Shared "Ask a question" panel (extracted from the email queue): preset chips + Q/A history (newest first,
// with See-more) + textarea + Ask button. Style-agnostic via `classes`; each caller wires its own async
// `onAsk(q)` (q omitted → use the current textarea value) and its own copy renderer. Keeps the email queue
// and the chatbot in sync — one layout, two backends.
export function AskPanel({ question, onQuestion, onAsk, hist, busy, busyLabel, placeholder, presets, expanded, onToggleExpanded, renderCopy, onReset, classes }) {
  const c = classes || {};
  const rows = hist || [];
  const shown = expanded ? rows.slice().reverse() : rows.slice(-2).reverse();
  const canReset = !!onReset && (rows.length > 0 || (question && question.trim()));
  return (
    <>
      {onReset ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button className={c.resetBtn || c.seeMore} onClick={() => onReset()} disabled={busy || !canReset} title="Clear the question box and this Q&A history">Reset</button>
        </div>
      ) : null}
      {presets && presets.length ? (
        <div className={c.chips}>
          {presets.map((p) => <button key={p} className={c.chip} onClick={() => onAsk(p)} disabled={busy}>{p}</button>)}
        </div>
      ) : null}
      {rows.length ? (
        <div className={c.hist}>
          {busy ? <div className={c.dim}>{busyLabel || 'Thinking…'}</div> : null}
          {shown.map((h, i) => (
            <div className={c.qa} key={i}>
              <div className={c.q}><b>Q:</b> {h.q} {h.ts ? <span className={c.ts}>{h.ts}</span> : null}</div>
              <div className={c.a}>{h.a}</div>
              {renderCopy ? renderCopy(h.a) : null}
            </div>
          ))}
          {rows.length > 2 ? <button className={c.seeMore} onClick={onToggleExpanded}>{expanded ? 'See less' : 'See ' + (rows.length - 2) + ' earlier'}</button> : null}
        </div>
      ) : null}
      <textarea className={c.ta} value={question} onChange={(e) => onQuestion(e.target.value)} placeholder={placeholder} />
      <button className={c.askBtn} onClick={() => onAsk()} disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
    </>
  );
}

// Shared corrections LIST — one layout for the chatbot and the email queue (scrollable list of bordered
// note cards, each with an optional "re: <question>" line). Style-agnostic via `classes`: pass the same
// class map on both surfaces for identical look. `rows` is null while loading, [] when empty.
export function CorrectionsList({ rows, classes }) {
  const c = classes || {};
  return (
    <div className={c.list}>
      {rows == null ? <div className={c.dim}>Loading…</div> : null}
      {rows && rows.length === 0 ? <div className={c.dim}>No corrections yet.</div> : null}
      {(rows || []).map((r) => (
        <div className={c.item} key={r.id}>
          <div className={c.note}>{r.note}</div>
          {r.question ? <div className={c.dim}>re: {r.question}</div> : null}
        </div>
      ))}
    </div>
  );
}
