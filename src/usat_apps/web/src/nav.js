import { lazy } from 'react';
import Metrics from './pages/Metrics.jsx';
import Admin from './pages/Admin.jsx';

// Platform navigation — the single source for the rail + the router. Groups are collapsible rail
// sections; solos are standalone links. Access is enforced per panel key (admins see everything).
// Panels without a live module yet point at ComingSoon until they're ported. Groups can hold panels
// from more than one module (e.g. Reporting = Participation maps + Event analysis).
const ParticipationMaps = lazy(() => import('./modules/reporting/Section.jsx'));
const ComingSoon = lazy(() => import('./pages/ComingSoon.jsx'));
const OpsOverview = lazy(() => import('./modules/ops/Overview.jsx'));
const OpsBackends = lazy(() => import('./modules/ops/Backends.jsx'));
const OpsServerCards = lazy(() => import('./modules/ops/ServerCards.jsx'));
const OpsReference = lazy(() => import('./modules/ops/Reference.jsx'));

export const NAV = [
  { type: 'group', label: 'Reporting', items: [
    { label: 'Participation maps', path: '/reporting/participation-maps', panel: 'participation-maps', icon: '🗺', Component: ParticipationMaps },
    { label: 'Event analysis',     path: '/reporting/event-analysis',     panel: 'event-analysis',     icon: '📈', Component: ComingSoon },
  ] },
  { type: 'group', label: 'Salesforce', items: [
    { label: 'Merge', path: '/salesforce/merge', panel: 'merge', icon: '⇄', Component: ComingSoon },
  ] },
  { type: 'solo', label: 'Metrics', path: '/metrics', panel: 'metrics', icon: '📊', Component: Metrics },
  { type: 'group', label: 'Admin', items: [
    { label: 'Users & access', path: '/admin/users', panel: 'admin', icon: '👤', Component: Admin },
  ] },
  { type: 'group', label: 'Ops', items: [
    { label: 'Overview',      path: '/ops/overview',     panel: 'ops', icon: '▦', Component: OpsOverview },
    { label: 'Backends',      path: '/ops/backends',     panel: 'ops', icon: '⚡', Component: OpsBackends },
    { label: 'Server cards',  path: '/ops/server-cards', panel: 'ops', icon: '◧', Component: OpsServerCards },
    { label: 'Operations',    path: '/ops/operations',   panel: 'ops', icon: '▸', Component: ComingSoon },
    { label: 'Logs',          path: '/ops/logs',         panel: 'ops', icon: '▤', Component: ComingSoon },
    { label: 'System health', path: '/ops/system',       panel: 'ops', icon: '📊', Component: ComingSoon },
    { label: 'Settings',      path: '/ops/settings',     panel: 'ops', icon: '⚙', Component: ComingSoon },
    { label: 'Reference',     path: '/ops/reference',    panel: 'ops', icon: '❏', Component: OpsReference },
  ] },
];

// Can this user reach a panel? Admins see all; 'admin' panel is admin-only; else needs the grant.
export function canSee(user, panel) {
  if (!panel) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (panel === 'admin') return false;
  return Array.isArray(user.panels) && user.panels.includes(panel);
}

// Every leaf panel flattened — used to build the routes.
export function allPanels() {
  const out = [];
  NAV.forEach(function (n) {
    if (n.type === 'group') n.items.forEach(function (it) { out.push(it); });
    else out.push(n);
  });
  return out;
}
