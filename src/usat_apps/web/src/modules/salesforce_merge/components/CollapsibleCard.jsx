import { useEffect, useState } from 'react';

// A .card whose body collapses/expands when the header is clicked. `title` and optional `actions`
// (e.g. export links) render in the header row; `actions` clicks don't toggle the card.
export default function CollapsibleCard({ title, actions, defaultOpen = true, forceOpen, forceKey, children, style }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (typeof forceOpen === 'boolean') setOpen(forceOpen); }, [forceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card" style={{ marginTop: 12, ...(style || {}) }}>
      <p style={{ margin: open ? '0 0 8px' : 0, fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          title={open ? 'Collapse' : 'Expand'}
          style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', font: 'inherit', padding: 0, width: 14 }}>
          {open ? '▾' : '▸'}
        </button>
        <span>{title}</span>
        {actions ? <span style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>{actions}</span> : null}
      </p>
      {open ? children : null}
    </div>
  );
}
