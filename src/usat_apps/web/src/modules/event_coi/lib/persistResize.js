// persistResize.js — remember the height a user drags a resizable element to, across page loads.
// Attach the returned ref callback to any element styled `resize: vertical`. On mount it restores the
// saved height; a ResizeObserver then writes the new height to localStorage whenever it changes. We only
// persist when the element carries an INLINE height — the CSS resize handle sets that on drag, while a
// window-resize of a vh-sized element does not — so we save the user's deliberate size, not incidental
// reflow. No-ops safely where localStorage or ResizeObserver is unavailable.
import { useCallback, useRef } from 'react';

const PREFIX = 'coi.size.';

export function usePersistentHeight(key) {
  const cleanupRef = useRef(null);
  return useCallback((el) => {
    // Tear down the observer from any previous element this ref was attached to.
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;

    // Restore the saved height (as an inline style, so the CSS min/max clamps still apply).
    try {
      const saved = window.localStorage.getItem(PREFIX + key);
      if (saved) el.style.height = saved;
    } catch (e) { /* localStorage blocked — skip restore */ }

    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const save = () => {
      const h = el.style.height;          // only a resize-drag (or our restore) sets this
      if (!h) return;                     // ignore incidental/content/window reflow
      try { window.localStorage.setItem(PREFIX + key, h); } catch (e) { /* ignore */ }
    };
    const obs = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(save);  // coalesce the burst of events during a drag
    });
    obs.observe(el);
    cleanupRef.current = () => { if (raf) cancelAnimationFrame(raf); obs.disconnect(); };
  }, [key]);
}
