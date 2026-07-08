import React, { useState } from 'react';
import { api } from '../lib/api.js';

// Local username/password login. Microsoft/Entra SSO is deferred — when added, a "Sign in with
// Microsoft" button goes here and resolves to the same user records by email (see README_USAT_APPS.md).
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { status, body } = await api.login(username, password);
    setBusy(false);
    if (status === 200 && body.ok) onLogin(body);
    else setErr(body.error || 'Sign in failed');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big"><span className="brand-mark" /> USAT Apps</div>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err ? <div className="err">{err}</div> : null}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>Microsoft sign-in coming soon.</p>
      </form>
    </div>
  );
}
