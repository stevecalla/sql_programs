// Tiny fetch wrapper for the JSON API. Same-origin cookies carry the session.
async function req(path, opts) {
  const r = await fetch(path, Object.assign({
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
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.status === 401) return null;
    return r.json();
  },
  login: (username, password) =>
    req('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/logout', { method: 'POST' }),
  dashboard: () => req('/api/dashboard'),
  status: () => req('/api/status'),
};
