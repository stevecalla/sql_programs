// Tiny fetch helper for the usat_apps platform API. All calls are same-origin (the Express server
// serves this SPA and the /api/* routes), so cookies ride along. Base-aware via import.meta.env.BASE_URL,
// so it works at '/' (current) or any sub-path if the app is ever built with a different --base.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const url = (p) => BASE + p;

// Central auth-expiry signal: when any DATA call returns 401 (session expired / missing), tell the
// app to redirect to the login screen. 403 (panel access denied) is intentionally NOT handled here —
// those stay in-app and render the access-denied view. login/me/logout are exempt so a signed-out
// user landing on the app doesn't loop.
const AUTH_PATHS = ['/api/login', '/api/me', '/api/logout'];
function noteStatus(path, status) {
  if (status === 401 && !AUTH_PATHS.some((a) => String(path).indexOf(a) === 0)) {
    try { window.dispatchEvent(new CustomEvent('usatapps:unauthorized')); } catch (e) { /* non-browser */ }
  }
}

async function jget(path) {
  const r = await fetch(url(path), { credentials: 'same-origin' });
  const body = await r.json().catch(() => ({}));
  noteStatus(path, r.status);
  return { status: r.status, body };
}
async function jpost(path, data) {
  const r = await fetch(url(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  const body = await r.json().catch(() => ({}));
  noteStatus(path, r.status);
  return { status: r.status, body };
}

export const api = {
  status: () => jget('/api/status'),
  me: () => jget('/api/me'),
  login: (username, password) => jpost('/api/login', { username, password }),
  logout: () => jpost('/api/logout', {}),
  modules: () => jget('/api/modules'),
  // participation_maps module (report data): /api/participation-maps/*
  bootstrap: (force) => jget('/api/participation-maps/bootstrap' + (force ? '?force=1' : '')),
  uniqueFor: (sel) => jget('/api/participation-maps/unique?' + new URLSearchParams(Object.assign(
    { years: (sel.years || []).join(','), months: (sel.months && sel.months.length ? sel.months.join(',') : 'all') },
    sel.region ? { region: sel.region } : {},
    sel.state ? { state: sel.state } : {},
    sel.ironman ? { ironman: sel.ironman } : {})).toString()),
  homeFor: (sel) => jget('/api/participation-maps/home?' + new URLSearchParams(Object.assign(
    { years: (sel.years || []).join(','), months: (sel.months && sel.months.length ? sel.months.join(',') : 'all') },
    sel.ironman ? { ironman: sel.ironman } : {})).toString()),
  reachFor: (sel) => jget('/api/participation-maps/reach?' + new URLSearchParams(Object.assign(
    { years: (sel.years || []).join(','), months: (sel.months && sel.months.length ? sel.months.join(',') : 'all'),
      ageGroup: sel.ageGroup === 'youth' ? 'youth' : 'adult' },
    sel.ironman ? { ironman: sel.ironman } : {})).toString()),
  dataset: () => jget('/api/participation-maps/dataset'),
  event: (evt) => jpost('/api/event', evt),
  metricsReport: (days, panel, includeTest) => jget('/api/metrics-report?days=' + (days || 7) + (panel ? '&panel=' + encodeURIComponent(panel) : '') + (includeTest ? '&test=1' : '')),
  metricsPurgeTest: () => jpost('/api/metrics-purge-test', {}),
  metricsAskModels: () => jget('/api/metrics-ask-models'),
  metricsAsk: (payload) => jpost('/api/metrics-ask', payload),
  metricsAskCorrect: (payload) => jpost('/api/metrics-ask-correct', payload),
  adminUsers: () => jget('/api/admin/users'),
  adminAddUser: (user, pass, role) => jpost('/api/admin/users', { user, pass, role }),
  adminRemoveUser: (user) => jpost('/api/admin/users/remove', { user }),
  adminPanelAccess: () => jget('/api/admin/panel-access'),
  adminSetPanelAccess: (body) => jpost('/api/admin/panel-access', body),
  // Ops (infrastructure console) — read-only for now.
  opsHealth: () => jget('/api/ops/health'),
  opsRoutes: () => jget('/api/ops/routes'),
  opsStatus: () => jget('/api/ops/status'),
  opsPm2: () => jget('/api/ops/pm2'),
  opsSystem: () => jget('/api/ops/system'),
  opsSystemCmds: () => jget('/api/ops/system/cmds'),
  opsSystemCmd: (name) => jget('/api/ops/system/cmd?name=' + encodeURIComponent(name)),
  opsSystemDuPaths: () => jget('/api/ops/system/du-paths'),
  opsSystemDu: (p) => jget('/api/ops/system/du?path=' + encodeURIComponent(p)),
  opsCron: () => jget('/api/ops/system/cron'),
  opsCronSave: (crontab) => jpost('/api/ops/system/cron', { crontab }),
  opsConsole: () => jget('/api/ops/console'),
  opsConsoleRun: (payload) => jpost('/api/ops/console/run', payload),
  opsConsoleUsat: () => jget('/api/ops/console-usat'),
  opsConsoleUsatRun: (payload) => jpost('/api/ops/console-usat/run', payload),
  // event_coi (Event / Race Certificate Request): /api/event-coi/*
  coiPing: () => jget('/api/event-coi/ping'),
  coiParse: (filename, dataB64) => jpost('/api/event-coi/parse', { filename, dataB64 }),
  coiRunStart: (body) => jpost('/api/event-coi/run/start', body),
  coiRunApprove: (runId) => jpost('/api/event-coi/run/approve', { runId }),
  coiRunApproveAll: (runId) => jpost('/api/event-coi/run/approve-all', { runId }),
  coiRunSkip: (runId) => jpost('/api/event-coi/run/skip', { runId }),
  coiRunStop: (runId) => jpost('/api/event-coi/run/stop', { runId }),
  coiRunReset: (runId) => jpost('/api/event-coi/run/reset', runId ? { runId } : {}),
  coiRunActive: () => jget('/api/event-coi/run/active'),
  coiRunResults: (runId) => jget('/api/event-coi/run/results?runId=' + encodeURIComponent(runId)),
  // SSE stream URL (open with EventSource; cookies ride along same-origin).
  coiRunStreamUrl: (runId) => ((import.meta.env.BASE_URL || '/').replace(/\/+$/, '')) + '/api/event-coi/run/stream?runId=' + encodeURIComponent(runId),
};
