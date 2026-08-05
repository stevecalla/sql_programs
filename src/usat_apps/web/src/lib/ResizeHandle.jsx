import { useRef } from 'react';
import './ui.css';   // shared grabber styling — identical UX in every module

// Shared vertical drag handle (extracted from the email queue). Style-agnostic: pass `className` for the
// handle. target='prev' resizes the previous flex sibling (a left siderail); target='gridNext' rewrites the
// parent grid's columns so the column AFTER the handle (the AI panel) takes the new width. Writes styles to
// the DOM live during drag (no re-render), commits to the store on release. Keyboard + double-click to reset.
export default function ResizeHandle({ target, dir = 1, min = 200, max = 720, def, current, onCommit, title, className, busyClass = 'ui-resizing' }) {
  const ref = useRef(null);
  const clamp = (w) => Math.max(min, Math.min(max, Math.round(w)));
  function live(w) {
    const h = ref.current; if (!h) return;
    if (target === 'prev') { const el = h.previousElementSibling; if (el) el.style.width = w + 'px'; }
    else { const g = h.parentElement; if (g) g.style.gridTemplateColumns = 'minmax(0,1fr) 6px ' + w + 'px'; }
  }
  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = current();
    document.body.classList.add(busyClass);
    let last = startW;
    const move = (ev) => { last = clamp(startW + (ev.clientX - startX) * dir); live(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove(busyClass);
      onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function onKey(e) {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === 'ArrowRight') { onCommit(clamp(current() + step * dir)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { onCommit(clamp(current() - step * dir)); e.preventDefault(); }
    else if (e.key === 'Home') { onCommit(min); e.preventDefault(); }
    else if (e.key === 'End') { onCommit(max); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && def != null) { onCommit(def); e.preventDefault(); }
  }
  return (
    <div ref={ref} className={className || 'ui-resizer'} onPointerDown={onDown} onKeyDown={onKey}
      onDoubleClick={() => { if (def != null) onCommit(def); }}
      role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
      title={title || 'Drag to resize · double-click to reset'} />
  );
}
