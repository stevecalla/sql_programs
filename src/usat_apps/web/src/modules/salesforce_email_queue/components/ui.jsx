import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PortalModal } from '../../../lib/ui.jsx';   // shared modal/collapsible logic (D: dedup)

export function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return n + ' b'; if (n < 1048576) return (n / 1024).toFixed(1) + ' kb'; return (n / 1048576).toFixed(1) + ' mb'; }

// Clipboard with a legacy fallback for non-secure contexts.
export async function copyText(t) {
  const s = String(t == null ? '' : t);
  try { await navigator.clipboard.writeText(s); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); return true; }
    catch (e2) { return false; }
  }
}
export function downloadText(name, text, mime) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = name || 'download.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { /* ignore */ }
}

// A copy button that flashes "✓ Copied!" for 1.5s. `text` may be a string or a getter function.
export function CopyButton({ text, label, className, title, onCopied }) {
  const [done, setDone] = useState(false);
  return (
    <button className={className || 'eq-btn sm'} title={title || 'Copy'}
      onClick={async (e) => { e.stopPropagation(); const ok = await copyText(typeof text === 'function' ? text() : text); if (ok) { setDone(true); setTimeout(() => setDone(false), 1500); try { if (onCopied) onCopied(); } catch (er) { /* ignore */ } } }}>
      {done ? '✓ Copied!' : (label || '📋 Copy')}
    </button>
  );
}

// Portal modal (now backed by the shared PortalModal — SAME markup/classes as before).
export function Modal({ title, onClose, actions, children, wide }) {
  return (
    <PortalModal title={title} onClose={onClose} actions={actions} wide={wide} closeLabel="✕ Close"
      classes={{ bg: 'eq-modalbg', modal: 'eq-modal', head: 'eq-modalh', actions: 'eq-inline', closeBtn: 'eq-btn sm', body: 'eq-modalb' }}>
      {children}
    </PortalModal>
  );
}

export function RowsTable({ rows, note }) {
  const head = (rows && rows[0]) || [];
  return (
    <div className="eq-tablewrap">
      <table className="eq-atable">
        <thead><tr>{head.map((h, i) => <th key={i}>{String(h == null ? '' : h)}</th>)}</tr></thead>
        <tbody>{(rows || []).slice(1).map((r, ri) => <tr key={ri}>{(r || []).map((c, ci) => <td key={ci}>{String(c == null ? '' : c)}</td>)}</tr>)}</tbody>
      </table>
      {note ? <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}
