import { useRef, useState } from 'react';
import { Collapsible } from './ui.jsx';
import './collapse.css';

// Shared drag-to-reorder wrapper (extracted from the Knowledge & AI admin). Renders `items`
// ([{ key, node }]) each with a ⠿ drag handle; drag to reorder; the order persists per browser under
// `storageKey` (omit for in-memory only). Pairs with the shared Collapsible so any stack of collapsible
// cards becomes movable with one wrapper — the same UX across admin panels. Style-agnostic (inline styles
// + theme vars); the handle sits in a small left gutter so it never overlaps a card's own header.
function computeOrder(saved, keys) {
  if (Array.isArray(saved)) {
    const valid = saved.filter(function (k) { return keys.indexOf(k) >= 0; });
    keys.forEach(function (k) { if (valid.indexOf(k) < 0) valid.push(k); });   // append new keys, drop removed
    return valid;
  }
  return keys.slice();
}

export function ReorderableList({ items, storageKey }) {
  const list = items || [];
  const keys = list.map(function (it) { return it.key; });
  const [order, setOrder] = useState(function () {
    if (!storageKey) return keys.slice();
    try { return computeOrder(JSON.parse(window.localStorage.getItem(storageKey) || 'null'), keys); } catch (e) { return keys.slice(); }
  });
  const [overKey, setOverKey] = useState(null);
  const dragKey = useRef(null);

  const byKey = {}; list.forEach(function (it) { byKey[it.key] = it; });
  const finalOrder = order.filter(function (k) { return byKey[k]; });
  keys.forEach(function (k) { if (finalOrder.indexOf(k) < 0) finalOrder.push(k); });

  const move = function (target) {
    const from = dragKey.current; dragKey.current = null; setOverKey(null);
    if (!from || from === target) return;
    const next = finalOrder.filter(function (k) { return k !== from; });
    const i = next.indexOf(target); next.splice(i < 0 ? next.length : i, 0, from);
    setOrder(next);
    if (storageKey) { try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch (e) { /* ignore */ } }
  };

  return (
    <>
      {finalOrder.map(function (k) {
        if (!byKey[k]) return null;
        return (
          <div key={k} style={{ position: 'relative', paddingLeft: 22 }}
            onDragOver={function (e) { e.preventDefault(); if (overKey !== k) setOverKey(k); }}
            onDragLeave={function () { if (overKey === k) setOverKey(null); }}
            onDrop={function () { move(k); }}>
            <span draggable
              onDragStart={function () { dragKey.current = k; }}
              onDragEnd={function () { dragKey.current = null; }}
              onClick={function (e) { e.stopPropagation(); }}
              title="Drag to reorder"
              style={{ position: 'absolute', left: 0, top: 16, cursor: 'grab', color: 'var(--dim,#6b7280)', fontSize: 15, padding: '2px 4px', userSelect: 'none' }}>⠿</span>
            <div style={{ outline: overKey === k ? '2px dashed #3b82f6' : 'none', outlineOffset: 2, borderRadius: 12 }}>{byKey[k].node}</div>
          </div>
        );
      })}
    </>
  );
}

// Clear a saved order (for a "reset order" control). Remount the ReorderableList (e.g. via a changing key)
// after calling this so it re-reads the now-default order.
export function resetOrder(storageKey) { try { window.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ } }

// Combined COLLAPSIBLE + REORDERABLE cards — the one-liner for admin panels. Each item
// ({ key, title, summary?, children, defaultOpen? }) becomes a collapsible card (via the shared Collapsible)
// that's also drag-reorderable. Cards are collapsed by default unless `defaultOpen` (per item) or the
// component-level `defaultOpen` is set. `cardClasses` overrides the default .card/.rc-* styling.
const DEFAULT_CARD_CLASSES = { card: 'card rc-card', head: 'rc-head', h: 'rc-h', summary: 'rc-summary', chev: 'rc-chev', body: 'rc-body' };
function CollapsibleCard({ title, summary, classes, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible title={title} summary={summary} open={open} onToggle={function () { setOpen(function (o) { return !o; }); }} classes={classes || DEFAULT_CARD_CLASSES}>
      {children}
    </Collapsible>
  );
}
export function ReorderableCards({ items, storageKey, cardClasses, defaultOpen }) {
  const nodeItems = (items || []).map(function (it) {
    const open = it.defaultOpen != null ? it.defaultOpen : !!defaultOpen;
    return { key: it.key, node: <CollapsibleCard title={it.title} summary={it.summary} classes={cardClasses} defaultOpen={open}>{it.children}</CollapsibleCard> };
  });
  return <ReorderableList items={nodeItems} storageKey={storageKey} />;
}
