import { NavLink } from 'react-router-dom';

// Left rail for the Email Queue admin area — swapped in by App.jsx on /admin/email-queue*. Mirrors
// MergeRail: platform .siderail/.rail-* classes, a back-link to home, then the admin sections.
const BASE = '/admin/email-queue';
const GROUPS = [
  { grp: 'Email Queue admin', items: [
    { to: BASE, label: 'Overview', icon: '▦', end: true },
    { to: BASE + '/maintenance', label: 'Maintenance', icon: '⚒' },
    { to: BASE + '/operations', label: 'Operations', icon: '▸' },
    { to: BASE + '/logs', label: 'Logs', icon: '▤' },
    { to: BASE + '/settings', label: 'Settings', icon: '⚙' },
    { to: BASE + '/access', label: 'Access', icon: '◍' },
    { to: BASE + '/reference', label: 'Reference', icon: '❏' },
  ] },
];
const subClass = ({ isActive }) => 'rail-link rail-sub' + (isActive ? ' on' : '');

export default function EmailQueueAdminRail() {
  return (
    <nav className="siderail" aria-label="Email Queue admin sections">
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
