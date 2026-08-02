import { useRef } from 'react';

// Thin vertical drag handle for resizing a neighbouring rail/panel.
//  target='prev'     → sets the width of handle.previousElementSibling (used for the left rail,
//                      which sits as a flex sibling before this handle in .admin-shell).
//  target='gridNext' → rewrites the parent grid's columns so the column AFTER this handle
//                      (the AI panel) takes the new width (used inside .eq-main2).
// dir is the sign applied to rightward pointer motion: +1 widens (left rail), -1 widens (AI panel,
// whose handle sits on its left edge). During the drag we write styles straight to the DOM so the
// subscribed React components don't re-render on every pointermove; we commit to the store on release.
export default function ResizeHandle({ target, dir = 1, min = 200, max = 720, def, current, onCommit, title }) {
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
    document.body.classList.add('eq-resizing');
    let last = startW;
    const move = (ev) => { last = clamp(startW + (ev.clientX - startX) * dir); live(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('eq-resizing');
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
    <div ref={ref} className="eq-resizer" onPointerDown={onDown} onKeyDown={onKey}
      onDoubleClick={() => { if (def != null) onCommit(def); }}
      role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
      title={title || 'Drag to resize · double-click to reset'} />
  );
}
