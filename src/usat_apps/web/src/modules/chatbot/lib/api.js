// Front-end API client for the chatbot POC. Same-origin cookies carry the platform session.
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
export const api = {
  config: () => req(P + '/config'),
  chat: (payload) => req(P + '/chat', { method: 'POST', body: JSON.stringify(payload) }),
};
