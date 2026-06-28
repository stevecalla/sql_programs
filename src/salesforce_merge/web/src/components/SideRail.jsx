import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';

// Left-rail navigation (mirrors the proxy admin rail): grouped links with an active state.
const GROUPS = [
  { items: [{ to: '/', label: 'Dashboard', end: true }] },
  { grp: 'Review', items: [
    { to: '/duplicates', label: 'Duplicates' },
    { to: '/merge-id', label: 'Merge-ID' },
    { to: '/accounts', label: 'All accounts' },
  ] },
  { grp: 'Operate', items: [{ to: '/process', label: 'Get Duplicates' }, { to: '/merge-admin', label: 'Merge Admin' }] },
  { grp: 'Analyze', items: [{ to: '/tuning', label: 'Tuning' }] },
  { grp: 'Admin', items: [
    { to: '/metrics', label: 'Metrics' },
    { to: '/admin', label: 'Admin' },
  ] },
  { grp: 'Help', items: [{ to: '/reference', label: 'Reference' }] },
];

const cls = ({ isActive }) => (isActive ? 'on' : undefined);

export default function SideRail() {
  return (
    <nav className="admin-rail" aria-label="Sections">
      {GROUPS.map((g, gi) => (
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
