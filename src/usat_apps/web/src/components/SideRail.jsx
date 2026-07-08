import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { NAV, canSee } from '../nav.js';

// Left rail: a fixed HOME link, then the NAV entries. Groups are collapsible (open/closed persisted in
// localStorage) and only show the panels the user can reach; a group with no reachable panels is
// hidden. Solos (e.g. Metrics) render as a single gated link.
const LSKEY = 'usatapps_rail_collapsed';
function loadCollapsed() { try { return JSON.parse(localStorage.getItem(LSKEY)) || {}; } catch (e) { return {}; } }

export default function SideRail({ user }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = (g) => setCollapsed((c) => {
    const n = Object.assign({}, c, { [g]: !c[g] });
    try { localStorage.setItem(LSKEY, JSON.stringify(n)); } catch (e) { /* ignore */ }
    return n;
  });
  const linkClass = ({ isActive }) => 'rail-link' + (isActive ? ' on' : '');

  return (
    <nav className="siderail" aria-label="Primary">
      <div className="rail-section">
        <NavLink to="/" end className={linkClass}>Home</NavLink>
      </div>

      {NAV.map(function (n) {
        if (n.type === 'solo') {
          if (!canSee(user, n.panel)) return null;
          return (
            <div className="rail-section" key={n.path}>
              <NavLink to={n.path} className={linkClass}>{n.label}</NavLink>
            </div>
          );
        }
        const items = n.items.filter(function (it) { return canSee(user, it.panel); });
        if (!items.length) return null;
        const isCollapsed = !!collapsed[n.label];
        return (
          <div className="rail-section" key={n.label}>
            <button type="button" className="rail-group" onClick={() => toggle(n.label)} aria-expanded={!isCollapsed}>
              <span className="rail-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>{n.label}
            </button>
            {!isCollapsed && items.map(function (it) {
              return <NavLink key={it.path} to={it.path} className={({ isActive }) => 'rail-link rail-sub' + (isActive ? ' on' : '')}>{it.label}</NavLink>;
            })}
          </div>
        );
      })}
    </nav>
  );
}
