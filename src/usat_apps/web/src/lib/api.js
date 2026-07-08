// Tiny fetch helper for the usat_apps platform API. All calls are same-origin (the Express server
// serves this SPA and the /api/* routes), so cookies ride along. Base-aware: at root the base is '/',
// behind the proxy it's '/apps/', so '/api/x' becomes '/apps/api/x' when deployed under the proxy.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const url = (p) => BASE + p;

async function jget(path) {
  const r = await fetch(url(path), { credentials: 'same-origin' });
  const body = await r.json().catch(() => ({}));
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
  return { status: r.status, body };
}

export const api = {
  status: () => jget('/api/status'),
  me: () => jget('/api/me'),
  login: (username, password) => jpost('/api/login', { username, password }),
  logout: () => jpost('/api/logout', {}),
  modules: () => jget('/api/modules'),
  event: (evt) => jpost('/api/event', evt),
  metricsReport: (days) => jget('/api/metrics-report?days=' + (days || 7)),
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
};
