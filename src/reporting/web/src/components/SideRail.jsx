import { NavLink } from 'react-router-dom';

// Left navigation rail, mirroring the merge app's SideRail. Items are grouped into sections and
// gated by the same panel keys the server enforces (admins see everything). As more reports arrive
// they become entries under REPORTS.
const SECTIONS = [
  { label: 'REPORTS', items: [
    { to: '/', label: 'Participation maps', panel: 'participation-maps', end: true },
  ]},
  { label: 'INFO', items: [
    { to: '/reference', label: 'Reference', panel: null },
  ]},
  { label: 'ADMIN', items: [
    { to: '/metrics', label: 'Usage metrics', panel: 'metrics' },
    { to: '/admin', label: 'Users & access', panel: 'admin' },
  ]},
];

export default function SideRail({ user }) {
  const panels = Array.isArray(user.panels) ? user.panels : [];
  const canSee = (panel) => {
    if (!panel) return true;
    if (panel === 'admin') return user.role === 'admin';
    return user.role === 'admin' || panels.includes(panel);
  };
  return (
    <nav className="siderail" aria-label="Primary">
      {SECTIONS.map((s) => {
        const items = s.items.filter((it) => canSee(it.panel));
        if (!items.length) return null;
        return (
          <div className="rail-section" key={s.label}>
            <div className="rail-label">{s.label}</div>
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end}
                className={({ isActive }) => 'rail-link' + (isActive ? ' on' : '')}>
                {it.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
