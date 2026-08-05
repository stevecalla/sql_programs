// Front-end API client for the chatbot operator surface. Same-origin cookies carry the platform session.
// Every read/write is keyed by ?queue so the left-rail queue picker drives the whole surface.
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
const P = '/api/chatbot';
function qs(o) { const p = Object.keys(o || {}).filter((k) => o[k] != null && o[k] !== '').map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); return p.length ? '?' + p.join('&') : ''; }
export const api = {
  queues: () => req(P + '/queues'),
  config: (queue) => req(P + '/config' + qs({ queue })),
  // context
  context: (queue) => req(P + '/context' + qs({ queue })),
  contextFile: (queue, scope, name) => req(P + '/context/file' + qs({ queue, scope, name })),
  contextRawUrl: (queue, name) => BASE + P + '/context/raw' + qs({ queue, name }),
  uploadContext: (payload) => req(P + '/context', { method: 'POST', body: JSON.stringify(payload) }),
  contextExclude: (key, excluded) => req(P + '/context-exclude', { method: 'POST', body: JSON.stringify({ key, excluded }) }),
  // URL context sources + chunks + retrieval preview
  contextUrls: (queue) => req(P + '/context-urls' + qs({ queue })),
  urlChunks: (queue, source_ref, scope) => req(P + '/context-url/chunks' + qs({ queue, source_ref, scope })),
  addUrl: (payload) => req(P + '/context-url', { method: 'POST', body: JSON.stringify(payload) }),
  refreshUrl: (payload) => req(P + '/context-url/refresh', { method: 'POST', body: JSON.stringify(payload) }),
  removeUrl: (payload) => req(P + '/context-url/remove', { method: 'POST', body: JSON.stringify(payload) }),
  chunkExclude: (id, excluded) => req(P + '/context-chunk-exclude', { method: 'POST', body: JSON.stringify({ id, excluded }) }),
  retrievePreview: (payload) => req(P + '/retrieve-preview', { method: 'POST', body: JSON.stringify(payload) }),
  allowlist: () => req(P + '/context-allowlist'),
  saveAllowlist: (allowlist) => req(P + '/context-allowlist', { method: 'POST', body: JSON.stringify({ allowlist }) }),
  // corrections
  corrections: (queue) => req(P + '/corrections' + qs({ queue })),
  addCorrection: (payload) => req(P + '/corrections', { method: 'POST', body: JSON.stringify(payload) }),
  // conversation threads
  conversations: (queue, opts) => req(P + '/conversations' + qs(Object.assign({ queue }, opts || {}))),
  conversation: (id) => req(P + '/conversation' + qs({ id })),
  // settings / models
  aiModels: () => req(P + '/ai/models'),
  settings: () => req(P + '/settings'),
  saveSettings: (payload) => req(P + '/settings', { method: 'POST', body: JSON.stringify(payload) }),
  // chat / test
  chat: (payload) => req(P + '/chat', { method: 'POST', body: JSON.stringify(payload) }),
  ask: (payload) => req(P + '/ask', { method: 'POST', body: JSON.stringify(payload) }),
};
