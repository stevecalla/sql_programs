import React, { useState } from 'react';
import { api } from '../lib/api.js';

// Local username/password login. Layout/style mirrors the /merge (salesforce_merge) console:
// a centered card on a branded navy backdrop. Microsoft/Entra SSO is deferred — the "coming soon"
// note holds its place; when added, a "Sign in with Microsoft" button goes here and resolves to the
// same user records by email (see README_USAT_APPS.md).
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
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>USAT Apps</h1>
        <p className="muted">Sign in</p>
        {err ? <p className="err">{err}</p> : null}
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted login-note">Microsoft sign-in coming soon.</p>
      </form>
    </div>
  );
}
