// Base path the app is served under ('' at root, '/merge' behind the usat-app proxy). Vite sets
// import.meta.env.BASE_URL from the build's `base` (e.g. `vite build --base=/merge/`), so all API
// calls and the export URL stay correct whether the app runs at root or under /merge.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

// When the metrics_test flag is on, attach metrics_test=1 to EVERY request so all activity (browser
// events + server-side action logs) is flagged is_test by the single parameter.
function withMetricsTest(path) {
  let on = false;
  try { on = /(?:^|[?&])metrics_test=1(?:&|$)/.test(location.search) || localStorage.getItem('usatapps_metrics_test') === '1'; } catch (e) { on = false; }
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
  // Session expired mid-use -> signal the platform shell to redirect to login (403 stays in-app).
  if (r.status === 401 && !/\/(login|me|logout)$/.test(path.split('?')[0])) {
    try { window.dispatchEvent(new CustomEvent('usatapps:unauthorized')); } catch (e) { /* non-browser */ }
  }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

export const api = {
  // returns the user object, or null when not signed in (401)
  me: async () => {
    const r = await fetch(BASE + '/api/salesforce-merge/me', { credentials: 'same-origin' });
    if (r.status === 401) return null;
    return r.json();
  },
  login: (username, password) =>
    req('/api/salesforce-merge/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/salesforce-merge/logout', { method: 'POST' }),
  dashboard: () => req('/api/salesforce-merge/dashboard'),
  dataset: () => req('/api/salesforce-merge/dataset'),
  runs: () => req('/api/salesforce-merge/runs'),
  tuning: () => req('/api/salesforce-merge/tuning'),
  status: () => req('/api/salesforce-merge/status'),
  duplicates: (p) => req('/api/salesforce-merge/duplicates' + qs(expand(p))),
  mergeId: (p) => req('/api/salesforce-merge/merge-id' + qs(expand(p))),
  mergeGroups: (p) => req('/api/salesforce-merge/merge-groups' + qs(expand(p))),
  accounts: (p, opts) => req('/api/salesforce-merge/accounts' + qs(expand(p)), opts),
  cluster: (key) => req('/api/salesforce-merge/cluster' + qs({ key })),
  clusterDetail: (key, source) => req('/api/salesforce-merge/cluster/detail' + qs({ key, source })),
  clusterPreview: (key, survivor, source) => req('/api/salesforce-merge/cluster/preview' + qs({ key, survivor, source })),
  clusterChildren: (key, source) => req('/api/salesforce-merge/cluster/children' + qs({ key, source })),
  duplicatesFacets: () => req('/api/salesforce-merge/duplicates/facets'),
  mergeIdFacets: () => req('/api/salesforce-merge/merge-id/facets'),
  accountsFacets: () => req('/api/salesforce-merge/accounts/facets'),
  mergeQueue: (status) => req('/api/salesforce-merge/merge-queue' + qs({ status })),
  mergeQueueAdd: (entry) => req('/api/salesforce-merge/merge-queue', { method: 'POST', body: JSON.stringify(entry) }),
  mergeQueueRemove: (id) => req('/api/salesforce-merge/merge-queue/' + encodeURIComponent(id), { method: 'DELETE' }),
  mergeQueueApprove: (ids) => req('/api/salesforce-merge/merge-queue/approve', { method: 'POST', body: JSON.stringify({ ids }) }),
  mergeQueueUnapprove: (ids) => req('/api/salesforce-merge/merge-queue/unapprove', { method: 'POST', body: JSON.stringify({ ids }) }),
  mergeStatus: () => req('/api/salesforce-merge/merge/status'),
  mergeProcess: (ids, opts = {}) => req('/api/salesforce-merge/merge/process', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  mergeHistory: () => req('/api/salesforce-merge/merge/history'),
  mergeHistoryQuery: (p) => req('/api/salesforce-merge/merge/history' + qs(p)),
  mergeJobHistory: (p) => req('/api/salesforce-merge/merge/job-history' + qs(p)),
  mergeWhoami: () => req('/api/salesforce-merge/merge/whoami'),
  mergeProgress: (kind, runId) => req('/api/salesforce-merge/merge/progress' + (runId ? ('?run_id=' + encodeURIComponent(runId)) : (kind ? ('?kind=' + encodeURIComponent(kind)) : ''))),
  mergeCancel: (kind = 'merge') => req('/api/salesforce-merge/merge/cancel', { method: 'POST', body: JSON.stringify({ kind }) }),
  mergeRestoreList: () => req('/api/salesforce-merge/merge/restore'),
  mergeRestoreDiff: (id) => req('/api/salesforce-merge/merge/restore/diff' + qs({ id })),
  mergeRestorePostDiff: (ids) => req('/api/salesforce-merge/merge/restore/post-diff', { method: 'POST', body: JSON.stringify({ ids }) }),
  mergeRestore: (ids, opts = {}) => req('/api/salesforce-merge/merge/restore', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  mergeRecreateList: () => req('/api/salesforce-merge/merge/recreate'),
  mergeRecreate: (ids, opts = {}) => req('/api/salesforce-merge/merge/recreate', { method: 'POST', body: JSON.stringify({ ids, ...opts }) }),
  recycleBin: () => req('/api/salesforce-merge/merge/recycle-bin'),
  stampFields: () => req('/api/salesforce-merge/merge/stamp-fields'),
  snapshotRows: () => req('/api/salesforce-merge/merge/snapshot'),
  workerHealth: () => req('/api/salesforce-merge/worker/health'),
  sfApiLimits: (env) => req('/api/salesforce-merge/sf-api/limits' + qs({ env })),
  sfApiUsage: (env, days) => req('/api/salesforce-merge/sf-api/usage' + qs({ env, days })),
  mergeQueueBulk: (payload) => req('/api/salesforce-merge/merge-queue/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  // Merge Ops panel (admin) — live settings + worker/queue snapshot.
  opsSettings: () => req('/api/salesforce-merge/ops/settings'),
  opsSettingsSave: (payload) => req('/api/salesforce-merge/ops/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  opsWorkers: () => req('/api/salesforce-merge/ops/workers'),
  opsPm2: () => req('/api/salesforce-merge/ops/pm2'),
  opsScale: (n) => req('/api/salesforce-merge/ops/scale', { method: 'POST', body: JSON.stringify({ n }) }),
  opsBatchStage: (o) => req('/api/salesforce-merge/ops/batch/stage', { method: 'POST', body: JSON.stringify(o || {}) }),
  opsBatchCount: (o) => req('/api/salesforce-merge/ops/batch/count', { method: 'POST', body: JSON.stringify(o || {}) }),
  opsBatchRestore: (ids, o = {}) => req('/api/salesforce-merge/ops/batch/restore', { method: 'POST', body: JSON.stringify({ ids, ...o }) }),
  opsLogs: (lines) => req('/api/salesforce-merge/ops/logs' + qs({ lines })),
  duplicatesFacets: () => req('/api/salesforce-merge/duplicates/facets'),
  mergeJobProgress: (jobId) => req('/api/salesforce-merge/merge/job/' + encodeURIComponent(jobId) + '/progress'),
  mergeJobCancel: (jobId) => req('/api/salesforce-merge/merge/job/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST' }),
  mergeJobResume: (jobId) => req('/api/salesforce-merge/merge/job/' + encodeURIComponent(jobId) + '/resume', { method: 'POST' }),
  mergeJobReport: (jobId, opts = {}) => req('/api/salesforce-merge/merge/job/' + encodeURIComponent(jobId) + '/report', { method: 'POST', body: JSON.stringify(opts) }),
  mergeRunReport: (runId, opts = {}) => req('/api/salesforce-merge/merge/run/' + encodeURIComponent(runId) + '/report', { method: 'POST', body: JSON.stringify(opts) }),
  refreshStart: (env, scope, job) => req('/api/salesforce-merge/refresh/start', { method: 'POST', body: JSON.stringify({ env, scope, job }) }),
  refreshStatus: () => req('/api/salesforce-merge/refresh/status'),
  refreshCancel: () => req('/api/salesforce-merge/refresh/cancel', { method: 'POST' }),
  // ---- Admin: user management + panel access (admin only) ----
  adminUsers: () => req('/api/salesforce-merge/admin/users'),
  adminUserSave: (user, pass, role) => req('/api/salesforce-merge/admin/users', { method: 'POST', body: JSON.stringify({ user, pass, role }) }),
  adminUserRemove: (user) => req('/api/salesforce-merge/admin/users/remove', { method: 'POST', body: JSON.stringify({ user }) }),
  adminPanelAccess: () => req('/api/salesforce-merge/admin/panel-access'),
  adminPanelAccessSave: (payload) => req('/api/salesforce-merge/admin/panel-access', { method: 'POST', body: JSON.stringify(payload) }),
  // ---- Metrics / usage analytics ----
  metricsReport: (days, includeTest) => req('/api/salesforce-merge/metrics-report' + qs({ days, test: includeTest ? 1 : undefined })),
  metricsPurgeTest: () => req('/api/salesforce-merge/metrics-purge-test', { method: 'POST' }),
  metricsAskModels: () => req('/api/salesforce-merge/metrics-ask-models'),
  metricsAsk: (payload) => req('/api/salesforce-merge/metrics-ask', { method: 'POST', body: JSON.stringify(payload) }),
  metricsAskCorrect: (payload) => req('/api/salesforce-merge/metrics-ask-correct', { method: 'POST', body: JSON.stringify(payload) }),
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
