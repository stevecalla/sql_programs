import React, { useState } from 'react';
import { api } from '../lib/api.js';

// Local username/password login. Layout/style mirrors the /merge (salesforce_merge) console:
// a centered card on a branded navy backdrop. Microsoft/Entra SSO is deferred — the "coming soon"
// note holds its place; when added, a "Sign in with Microsoft" button goes here and resolves to the
// same user records by email (see README_USAT_APPS.md).
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
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
        <div className="pw-field">
          <input
            type={showPw ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="pw-toggle"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            title={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted login-note">Microsoft sign-in coming soon.</p>
      </form>
    </div>
  );
}
