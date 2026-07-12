// Client-side usage analytics for the usat_apps platform. Fire-and-forget POSTs to /api/event, which
// the server whitelists + stamps (actor from the session, is_test from ?metrics_test=1) before
// inserting. Ported from reporting's track.js, renamed to usatapps_* identifiers. Never throws.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

function uuid() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function visitorId() {
  try { let v = localStorage.getItem('usatapps_vid'); if (!v) { v = uuid(); localStorage.setItem('usatapps_vid', v); } return v; }
  catch (e) { return null; }
}
function isReturning() {
  try { const seen = localStorage.getItem('usatapps_seen'); localStorage.setItem('usatapps_seen', '1'); return seen ? 1 : 0; }
  catch (e) { return 0; }
}
export function metricsTestOn() {
  try {
    if (/(?:^|[?&])metrics_test=1(?:&|$)/.test(location.search)) return true;
    return localStorage.getItem('usatapps_metrics_test') === '1';
  } catch (e) { return false; }
}
export function setMetricsTest(on) {
  try { if (on) localStorage.setItem('usatapps_metrics_test', '1'); else localStorage.removeItem('usatapps_metrics_test'); } catch (e) { /* ignore */ }
  try {
    const u = new URL(location.href);
    if (on) u.searchParams.set('metrics_test', '1'); else u.searchParams.delete('metrics_test');
    window.history.replaceState({}, '', u);
  } catch (e) { /* ignore */ }
}
function isMetricsTest() { return metricsTestOn() ? 1 : 0; }
export function withMetricsTest(body) {
  const b = Object.assign({}, body || {});
  if (isMetricsTest()) b.metrics_test = 1;
  return b;
}

const SESSION_ID = uuid();
const RETURNING = isReturning();
const APP_VERSION = '1.0.0';
function fmtLocal(d) { const p = (x) => (x < 10 ? '0' : '') + x; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

function meta() {
  const d = new Date();
  let vw = 'lg';
  try { vw = window.innerWidth <= 640 ? 'sm' : window.innerWidth <= 1024 ? 'md' : 'lg'; } catch (e) { /* ignore */ }
  let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
  let theme = ''; try { theme = document.documentElement.getAttribute('data-theme') || 'light'; } catch (e) { /* ignore */ }
  return {
    session_id: SESSION_ID, visitor_id: visitorId(), is_returning: RETURNING,
    page_path: (typeof location !== 'undefined' ? location.pathname : null),
    client_tz: tz, local_hour: d.getHours(), local_dow: d.getDay(),
    viewport: vw, engine: 'react', theme: theme, source: 'web',
    event_at_local: fmtLocal(d), app_version: APP_VERSION,
    metrics_test: isMetricsTest() || undefined,
  };
}

export function track(event_name, fields) {
  try {
    fetch(BASE + '/api/event', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ event_name }, meta(), fields || {})),
      keepalive: true,
    }).catch(function () { /* fire-and-forget */ });
  } catch (e) { /* never throws */ }
}

// Map a route path to its panel key. The platform routes are /<moduleId> plus /metrics and /admin.
export function panelForPath(pathname) {
  const seg = (pathname || '').replace(/^\//, '').split('/')[0];
  return seg || 'home';
}
export function trackPanelView(pathname, panel) { track('panel_view', { panel: panel || panelForPath(pathname), view: pathname }); }
export function trackFilter(panel, view, filter_name) { track('filter_run', { panel: panel, view: view, filter_name: filter_name }); }
export function trackSearch(panel, view) { track('search_run', { panel: panel, view: view, filter_name: 'search' }); }
export function trackExport(panel, view, export_format) { track('report_export', { panel: panel, view: view, export_format: export_format }); }
export function trackSession(event_name) { track(event_name, {}); }
export function trackNotFound(pathname) { track('not_found', { panel: panelForPath(pathname), view: pathname }); }
export function trackNotAuthorized(panel, pathname) { track('not_authorized', { panel: panel || panelForPath(pathname), view: pathname }); }
