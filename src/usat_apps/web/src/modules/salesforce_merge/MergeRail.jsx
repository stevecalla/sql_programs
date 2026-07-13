import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';

// Merge's own rail (drill-in). App.jsx swaps the platform SideRail for this while under
// /salesforce/merge/*. Uses the PLATFORM rail classes (.siderail/.rail-section/.rail-link/.rail-label)
// so it matches the shell exactly; the back link returns to the platform.
const BASE = '/salesforce/merge';
const GROUPS = [
  { grp: 'Review', items: [
    { to: BASE, label: 'Dashboard', icon: '▤', end: true },
    { to: BASE + '/duplicates', label: 'Duplicates', icon: '◎' },
    { to: BASE + '/merge-id', label: 'Merge-ID', icon: '#' },
    { to: BASE + '/accounts', label: 'All accounts', icon: '☰' },
  ] },
  { grp: 'Operate', items: [
    { to: BASE + '/get-duplicates', label: 'Get Duplicates', icon: '⟳' },
    { to: BASE + '/select-merges', label: 'Select Merges', icon: '☑' },
    { to: BASE + '/merge-process', label: 'Process Merges', icon: '⚙' },
    { to: BASE + '/restore', label: 'Restore', icon: '↺' },
  ] },
  { grp: 'Analyze', items: [
    { to: BASE + '/tuning', label: 'Tuning', icon: '☷' },
  ] },
  { grp: 'Help', items: [
    { to: BASE + '/sf-api', label: 'SF API', icon: '📡' },
    { to: BASE + '/reference', label: 'Reference', icon: '❏' },
  ] },
];

const subClass = ({ isActive }) => 'rail-link rail-sub' + (isActive ? ' on' : '');

export default function MergeRail() {
  return (
    <nav className="siderail" aria-label="Merge sections">
      <div className="rail-section">
        <NavLink to="/" end className="rail-link"><span className="rail-ico" aria-hidden="true">‹</span>USAT Apps</NavLink>
      </div>
      {GROUPS.map((g) => (
        <div className="rail-section" key={g.grp}>
          <div className="rail-label">{g.grp}</div>
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={subClass}>
              <span className="rail-ico" aria-hidden="true">{it.icon}</span>{it.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
