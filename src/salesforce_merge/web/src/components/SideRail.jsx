import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';

// Left-rail navigation (mirrors the proxy admin rail): grouped links with an active state. Each
// item carries the panel key the server gates it by, so we can hide what a user can't reach.
const GROUPS = [
  { grp: 'Review', items: [
    { to: '/', label: 'Dashboard', panel: '' },
    { to: '/duplicates', label: 'Duplicates', panel: 'duplicates' },
    { to: '/merge-id', label: 'Merge-ID', panel: 'merge-id' },
    { to: '/accounts', label: 'All accounts', panel: 'accounts' },
  ] },
  { grp: 'Operate', items: [
    { to: '/get-duplicates', label: 'Get Duplicates', panel: 'get-duplicates' },
    { to: '/select-merges', label: 'Select Merges', panel: 'select-merges' },
    { to: '/merge-process', label: 'Process Merges', panel: 'merge-process' },
    { to: '/restore', label: 'Restore', panel: 'restore' },
  ] },
  { grp: 'Analyze', items: [
    { to: '/tuning', label: 'Tuning', panel: 'tuning' }
  ] },
  { grp: 'Admin', items: [
    { to: '/metrics', label: 'Metrics', panel: 'metrics' },
    { to: '/admin', label: 'Admin', panel: 'admin' },
  ] },
  { grp: 'Help', items: [
    { to: '/reference', label: 'Reference', panel: 'reference' }
  ] },
];

const cls = ({ isActive }) => (isActive ? 'on' : undefined);

export default function SideRail({ user }) {
  const role = user && user.role;
  const panels = (user && Array.isArray(user.panels)) ? user.panels : [];
  const canSee = (panel) => {
    if (panel === undefined || panel === null) return true;
    if (panel === 'admin') return role === 'admin';
    return role === 'admin' || panels.includes(panel);
  };
  // Filter items, then drop any group left with no visible items.
  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => canSee(it.panel)) }))
    .filter((g) => g.items.length);

  return (
    <nav className="admin-rail" aria-label="Sections">
      {groups.map((g, gi) => (
        <Fragment key={gi}>
          {g.grp && <div className="rail-grp">{g.grp}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={cls}>{it.label}</NavLink>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
