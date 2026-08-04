// Front-end API client for the salesforce_email_queue module. Same-origin cookies carry the platform
// session; a 401 tells the shell to redirect to login (mirrors web/src/modules/salesforce_merge/lib/api.js).
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

async function req(path, opts) {
  const r = await fetch(BASE + path, Object.assign({
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }, opts));
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { try { window.dispatchEvent(new CustomEvent('usatapps:unauthorized')); } catch (e) { /* non-browser */ } }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function qs(o) {
  const e = Object.entries(o || {}).filter(([, v]) => v != null && v !== '');
  return e.length ? '?' + e.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
}
const P = '/api/salesforce-email-queue';

export const api = {
  config: () => req(P + '/config'),
  queues: () => req(P + '/queues'),
  statuses: () => req(P + '/statuses'),
  cases: (p) => req(P + '/cases' + qs(p)),
  statusCounts: (queue) => req(P + '/status-counts' + qs({ queue })),
  thread: (case_id) => req(P + '/thread' + qs({ case_id })),
  attachmentText: (cvid, ext, title) => req(P + '/attachment/' + encodeURIComponent(cvid) + '/text' + qs({ ext, title })),
  attachmentTable: (cvid, ext) => req(P + '/attachment/' + encodeURIComponent(cvid) + '/table' + qs({ ext })),
  attachmentRawUrl: (cvid, ext) => BASE + P + '/attachment/' + encodeURIComponent(cvid) + '/raw' + qs({ ext }),
  soql: (q) => req(P + '/soql', { method: 'POST', body: JSON.stringify({ q }) }),
  aiModels: () => req(P + '/ai/models'),
  aiRespond: (payload) => req(P + '/ai/respond', { method: 'POST', body: JSON.stringify(payload) }),
  aiAsk: (payload) => req(P + '/ai/ask', { method: 'POST', body: JSON.stringify(payload) }),
  aiTriage: (payload) => req(P + '/ai/triage', { method: 'POST', body: JSON.stringify(payload) }),
  corrections: () => req(P + '/corrections'),
  addCorrection: (payload) => req(P + '/corrections', { method: 'POST', body: JSON.stringify(payload) }),
  context: (queue) => req(P + '/context' + qs({ queue })),
  uploadContext: (payload) => req(P + '/context', { method: 'POST', body: JSON.stringify(payload) }),
  contextExclude: (key, excluded) => req(P + '/context-exclude', { method: 'POST', body: JSON.stringify({ key, excluded }) }),
  contextFile: (scope, queue, name) => req(P + '/context/file' + qs({ scope, queue, name })),
  contextRawUrl: (scope, queue, name) => BASE + P + '/context/raw' + qs({ scope, queue, name }),
  send: (payload) => req(P + '/send', { method: 'POST', body: JSON.stringify(payload) }),
  setStatus: (payload) => req(P + '/status', { method: 'POST', body: JSON.stringify(payload) }),
  // metrics dashboard (/metrics/sf-email-queue)
  metricsReport: (days, includeTest) => req(P + '/metrics-report' + qs({ days, test: includeTest ? 1 : undefined })),
  metricsPurgeTest: () => req(P + '/metrics-purge-test', { method: 'POST' }),
  metricsAskModels: () => req(P + '/metrics-ask-models'),
  metricsAsk: (payload) => req(P + '/metrics-ask', { method: 'POST', body: JSON.stringify(payload) }),
  metricsAskCorrect: (payload) => req(P + '/metrics-ask-correct', { method: 'POST', body: JSON.stringify(payload) }),
  // admin (Settings / Access) — admin-only
  adminConfig: () => req(P + '/admin/config'),
  adminConfigSave: (payload) => req(P + '/admin/config', { method: 'POST', body: JSON.stringify(payload) }),
  adminQueueAccess: () => req(P + '/admin/queue-access'),
  adminQueueAccessSave: (payload) => req(P + '/admin/queue-access', { method: 'POST', body: JSON.stringify(payload) }),
  // admin Overview / Operations (console, SSE) / Logs
  adminStatus: () => req(P + '/admin/status'),
  adminConsoleCommands: () => req(P + '/admin-console/commands'),
  adminConsoleRun: (payload) => req(P + '/admin-console/run', { method: 'POST', body: JSON.stringify(payload) }),
  adminConsoleKill: (runId) => req(P + '/admin-console/kill/' + encodeURIComponent(runId), { method: 'POST' }),
  adminConsoleStreamUrl: (runId) => BASE + P + '/admin-console/stream/' + encodeURIComponent(runId),
  adminLogs: (n) => req(P + '/admin-logs' + qs({ n })),
  adminLogsStreamUrl: () => BASE + P + '/admin-logs/stream',
  adminPm2: () => req(P + '/admin-pm2'),
};
