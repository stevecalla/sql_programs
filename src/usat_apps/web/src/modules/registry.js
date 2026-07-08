import { lazy } from 'react';

// Front-end module registry — the client mirror of src/usat_apps/modules/registry.js. Each entry is a
// feature module: { id, label, path, panel, Component (lazy-loaded section) }. The shell builds its nav
// and routes from this list, so adding a module = add one entry here + one server manifest. Lazy import
// keeps each module's code in its own bundle chunk (the front-end scalability lever).
const ReportingSection = lazy(() => import('./reporting/Section.jsx'));

export const MODULES = [
  {
    id: 'reporting',
    label: 'Reporting',
    path: '/reporting',
    panel: 'participation-maps',   // the panel key that gates this module (matches the server manifest)
    Component: ReportingSection,
  },
  // { id: 'merge', label: 'Merge', path: '/merge', panel: 'merge', Component: lazy(() => import('./merge/Section.jsx')) },
];

// Which modules a user can see, given their panels (admins see all). Used by the nav + landing page.
export function visibleModules(user) {
  const panels = (user && Array.isArray(user.panels)) ? user.panels : [];
  const isAdmin = user && user.role === 'admin';
  return MODULES.filter((m) => isAdmin || !m.panel || panels.includes(m.panel));
}
