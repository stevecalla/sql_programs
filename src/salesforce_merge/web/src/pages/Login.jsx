import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.login(u, p);
      onLogin({ ok: true, user: r.user, role: r.role });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1>Account Merge Console</h1>
        <p className="muted">Sign in</p>
        {err && <p className="err">{err}</p>}
        <input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" />
        <input type="password" placeholder="Password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
