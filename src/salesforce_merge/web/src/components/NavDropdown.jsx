import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

// A nav group: a button that opens a small menu of NavLinks. Shows "active" when the current
// route is one of its children. Closes on outside click, Escape, or after a child is chosen.
export default function NavDropdown({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  const active = items.some((it) => it.to === loc.pathname);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <span className="navdd" ref={ref}>
      <button type="button" className={'link navdd-btn' + (active ? ' active' : '')}
        aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} <span className="navdd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="navdd-menu" role="menu">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} role="menuitem" onClick={() => setOpen(false)}
              className={({ isActive }) => 'navdd-item' + (isActive ? ' active' : '')}>
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </span>
  );
}
