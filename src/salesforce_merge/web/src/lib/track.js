// Client-side usage analytics for the merge tool. Fire-and-forget POSTs to /api/event, which the
// server whitelists + stamps (actor from the session, env/is_test) before inserting. Mirrors the
// email-queue's metrics_client, adapted for a React SPA. Never throws; failures are swallowed.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

function uuid() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function visitorId() {
  try { let v = localStorage.getItem('merge_vid'); if (!v) { v = uuid(); localStorage.setItem('merge_vid', v); } return v; }
  catch (e) { return null; }
}
function isReturning() {
  try { const seen = localStorage.getItem('merge_seen'); localStorage.setItem('merge_seen', '1'); return seen ? 1 : 0; }
  catch (e) { return 0; }
}
// The metrics_test flag: on when the URL carries ?metrics_test=1 OR the admin "flag as test" toggle
// (persisted in localStorage) is on. This is the SINGLE thing that drives the is_test column.
export function metricsTestOn() {
  try {
    if (/(?:^|[?&])metrics_test=1(?:&|$)/.test(location.search)) return true;
    return localStorage.getItem('merge_metrics_test') === '1';
  } catch (e) { return false; }
}
// Turn the flag on/off: persist it AND reflect ?metrics_test=1 in the address bar so it's visible.
export function setMetricsTest(on) {
  try { if (on) localStorage.setItem('merge_metrics_test', '1'); else localStorage.removeItem('merge_metrics_test'); } catch (e) { /* ignore */ }
  try {
    const u = new URL(location.href);
    if (on) u.searchParams.set('metrics_test', '1'); else u.searchParams.delete('metrics_test');
    window.history.replaceState({}, '', u);
  } catch (e) { /* ignore */ }
}
function isMetricsTest() { return metricsTestOn() ? 1 : 0; }

const SESSION_ID = uuid();
const RETURNING = isReturning();

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
    // the metrics_test flag is the single driver of is_test; the server honors this param.
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

// Map a route path to its panel key (matches the server's ROUTE_PANEL / access model).
const PATH_PANEL = {
  '/': 'dashboard', '/duplicates': 'duplicates', '/merge-id': 'merge-id', '/accounts': 'accounts',
  '/get-duplicates': 'get-duplicates', '/select-merges': 'select-merges', '/merge-process': 'merge-process',
  '/restore': 'restore', '/tuning': 'tuning', '/metrics': 'metrics', '/admin': 'admin', '/reference': 'reference',
};
export function panelForPath(pathname) { return PATH_PANEL[pathname] || (pathname || '').replace(/^\//, '') || 'dashboard'; }

export function trackPanelView(pathname) { track('panel_view', { panel: panelForPath(pathname) }); }
export function trackFilter(panel, view, filter_name) { track('filter_run', { panel: panel, view: view, filter_name: filter_name }); }
export function trackSearch(panel, view) { track('search_run', { panel: panel, view: view, filter_name: 'search' }); }
export function trackExport(panel, view, export_format) { track('report_export', { panel: panel, view: view, export_format: export_format }); }
export function trackSession(event_name) { track(event_name, {}); }
