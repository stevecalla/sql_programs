// Client-side usage analytics for the salesforce_email_queue module. Fire-and-forget POSTs to the
// module's own ingest (POST /api/salesforce-email-queue/event → salesforce_email_queue_events), which
// whitelists + stamps actor/is_test/env server-side. Rich queue/case/AI columns (vs the generic platform
// usat_apps_events). Reuses the platform visitor id so events correlate. Never throws.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const P = '/api/salesforce-email-queue';

function uuid() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
}
function visitorId() { try { let v = localStorage.getItem('usatapps_vid'); if (!v) { v = uuid(); localStorage.setItem('usatapps_vid', v); } return v; } catch (e) { return null; } }
function isReturning() { try { const s = localStorage.getItem('usatapps_seen'); localStorage.setItem('usatapps_seen', '1'); return s ? 1 : 0; } catch (e) { return 0; } }
function isMetricsTest() { try { if (/(?:^|[?&])metrics_test=1(?:&|$)/.test(location.search)) return 1; return localStorage.getItem('usatapps_metrics_test') === '1' ? 1 : 0; } catch (e) { return 0; } }

const SESSION_ID = uuid();
const RETURNING = isReturning();

export function meta() {
  const d = new Date();
  let vw = 'lg'; try { vw = window.innerWidth <= 640 ? 'sm' : window.innerWidth <= 1024 ? 'md' : 'lg'; } catch (e) { /* ignore */ }
  let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
  let theme = 'light'; try { theme = document.documentElement.getAttribute('data-theme') || 'light'; } catch (e) { /* ignore */ }
  return {
    session_id: SESSION_ID, visitor_id: visitorId(), is_returning: RETURNING,
    page_path: (typeof location !== 'undefined' ? location.pathname : null),
    client_tz: tz, local_hour: d.getHours(), local_dow: d.getDay(),
    viewport: vw, engine: 'react', theme: theme, source: 'web',
  };
}

export function track(event_name, fields) {
  try {
    const body = Object.assign({ event_name }, meta(), fields || {});
    if (isMetricsTest()) body.metrics_test = 1;
    fetch(BASE + P + '/event', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(function () { /* fire-and-forget */ });
  } catch (e) { /* never throws */ }
}

// App-error events (the report's `errors` diagnostics table groups by error_type). Bounded so a runaway
// error loop can't flood the events table. Attached once when the module loads.
let _errCount = 0;
function trackError(type) { try { if (_errCount >= 20) return; _errCount++; track('error', { error_type: String(type || 'error').slice(0, 40) }); } catch (e) { /* ignore */ } }
try {
  window.addEventListener('error', function (e) { trackError(e && e.error && e.error.name); });
  window.addEventListener('unhandledrejection', function () { trackError('unhandledrejection'); });
} catch (e) { /* non-browser */ }
