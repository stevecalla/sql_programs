// Base path the app is served under ('' at root, '/merge' behind the usat-app proxy). Vite sets
// import.meta.env.BASE_URL from the build's `base` (e.g. `vite build --base=/merge/`), so all API
// calls and the export URL stay correct whether the app runs at root or under /merge.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

// When the metrics_test flag is on, attach metrics_test=1 to EVERY request so all activity (browser
// events + server-side action logs) is flagged is_test by the single parameter.
function withMetricsTest(path) {
  let on = false;
  try { on = /(?:^|[?&])metrics_test=1(?:&|$)/.test(location.search) || localStorage.getItem('merge_metrics_test') === '1'; } catch (e) { on = false; }
  if (!on) return path;
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'metrics_test=1';
}

// Tiny fetch wrapper for the JSON API. Same-origin cookies carry the session.
async function req(path, opts) {
  const r = await fetch(BASE + withMetricsTest(path), Object.assign({
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }, opts));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

export const api = {
  // returns the user object, or null when not signed in (401)
  me: async () => {
    const r = await fetch(BASE + '/api/me', { credentials: 'same-origin' });
    if (r.status === 401) return null;
    return r.json();
  },
  login: (username, password) =>
    req('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/logout', { method: 'POST' }),
  dashboard: () => req('/api/dashboard'),
  dataset: () => req('/api/dataset'),
  runs: () => req('/api/runs'),
  tuning: () => req('/api/tuning'),
  status: () => req('/api/status'),
  duplicates: (p) => req('/api/duplicates' + qs(expand(p))),
  mergeId: (p) => req('/api/merge-id' + qs(expand(p))),
  mergeGroups: (p) => req('/api/merge-groups' + qs(expand(p))),
  accounts: (p) => req('/api/accounts' + qs(expand(p))),
  cluster: (key) => req('/api/cluster' + qs({ key })),
  clusterDetail: (key, source) => req('/api/cluster/detail' + qs({ key, source })),
  clusterPreview: (key, survivor, source) => req('/api/cluster/preview' + qs({ key, survivor, source })),
  clusterChildren: (key, source) => req('/api/cluster/children' + qs({ key, source })),
  duplicatesFacets: () => req('/api/duplicates/facets'),
  mergeIdFacets: () => req('/api/merge-id/facets'),
  accountsFacets: () => req('/api/accounts/facets'),
  mergeQueue: (status) => req('/api/merge-queue' + qs({ status })),
  mergeQueueAdd: (entry) => req('/api/merge-queue', { method: 'POST', body: JSON.stringify(entry) }),
  mergeQueueRemove: (id) => req('/api/merge-queue/' + encodeURIComponent(id), { method: 'DELETE' }),
  mergeQueueApprove: (ids) => req('/api/merge-queue/approve', { method: 'POST', body: JSON.stringify({ ids }) }),
  mergeStatus: () => req('/api/merge/status'),
  mergeProcess: (ids, opts = {}) => req('/api/merge/process', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  mergeHistory: () => req('/api/merge/history'),
  mergeWhoami: () => req('/api/merge/whoami'),
  mergeProgress: (kind) => req('/api/merge/progress' + (kind ? ('?kind=' + encodeURIComponent(kind)) : '')),
  mergeCancel: (kind = 'merge') => req('/api/merge/cancel', { method: 'POST', body: JSON.stringify({ kind }) }),
  mergeRestoreList: () => req('/api/merge/restore'),
  mergeRestore: (ids, opts = {}) => req('/api/merge/restore', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  mergeRecreateList: () => req('/api/merge/recreate'),
  mergeRecreate: (ids, opts = {}) => req('/api/merge/recreate', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  recycleBin: () => req('/api/merge/recycle-bin'),
  stampFields: () => req('/api/merge/stamp-fields'),
  snapshotRows: () => req('/api/merge/snapshot'),
  mergeQueueBulk: (payload) => req('/api/merge-queue/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  refreshStart: (env, scope, job) => req('/api/refresh/start', { method: 'POST', body: JSON.stringify({ env, scope, job }) }),
  refreshStatus: () => req('/api/refresh/status'),
  refreshCancel: () => req('/api/refresh/cancel', { method: 'POST' }),
  // ---- Admin: user management + panel access (admin only) ----
  adminUsers: () => req('/api/admin/users'),
  adminUserSave: (user, pass, role) => req('/api/admin/users', { method: 'POST', body: JSON.stringify({ user, pass, role }) }),
  adminUserRemove: (user) => req('/api/admin/users/remove', { method: 'POST', body: JSON.stringify({ user }) }),
  adminPanelAccess: () => req('/api/admin/panel-access'),
  adminPanelAccessSave: (payload) => req('/api/admin/panel-access', { method: 'POST', body: JSON.stringify(payload) }),
  // ---- Metrics / usage analytics ----
  metricsReport: (days) => req('/api/metrics-report' + qs({ days })),
  metricsPurgeTest: () => req('/api/metrics-purge-test', { method: 'POST' }),
  metricsAskModels: () => req('/api/metrics-ask-models'),
  metricsAsk: (payload) => req('/api/metrics-ask', { method: 'POST', body: JSON.stringify(payload) }),
  metricsAskCorrect: (payload) => req('/api/metrics-ask-correct', { method: 'POST', body: JSON.stringify(payload) }),
};

// Flatten a { colFilters: { signal: 'exact' } } map into f_signal=exact params.
function expand(p) {
  const { colFilters, ...rest } = p || {};
  const out = { ...rest };
  for (const [k, v] of Object.entries(colFilters || {})) if (v != null && v !== '') out['f_' + k] = v;
  return out;
}

function qs(o) {
  const e = Object.entries(o || {}).filter(([, v]) => v != null && v !== '');
  return e.length ? '?' + e.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
}

// Build a download URL (CSV/Excel export) with the same params the table is showing.
export function exportUrl(base, params) {
  return BASE + base + qs(expand(params));
}
