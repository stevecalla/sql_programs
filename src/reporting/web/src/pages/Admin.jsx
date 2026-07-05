import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Users + panel access, over the admin-gated /api/admin/* endpoints. Mirrors the merge Admin page's
// purpose (manage this app's logins); kept compact.
export default function Admin() {
  const [users, setUsers] = useState([]);
  const [access, setAccess] = useState(null);
  const [form, setForm] = useState({ user: '', pass: '', role: 'user' });
  const [msg, setMsg] = useState('');

  async function load() {
    const u = await api.adminUsers();
    if (u.status === 200) setUsers(u.body.users || []);
    const a = await api.adminPanelAccess();
    if (a.status === 200) setAccess(a.body);
  }
  useEffect(() => { load(); }, []);

  async function addUser(e) {
    e.preventDefault();
    const r = await api.adminAddUser(form.user.trim(), form.pass, form.role);
    setMsg(r.body.ok ? `Saved ${r.body.user}` : (r.body.error || 'error'));
    if (r.body.ok) { setForm({ user: '', pass: '', role: 'user' }); load(); }
  }
  async function removeUser(user) {
    const r = await api.adminRemoveUser(user);
    setMsg(r.body.ok ? `Removed ${user}` : (r.body.error || 'error'));
    load();
  }

  return (
    <div className="page">
      <h2>Users &amp; access</h2>

      <div className="card">
        <h3>Users</h3>
        <table className="grid">
          <thead><tr><th>User</th><th>Role</th><th>Source</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user + u.source}>
                <td>{u.user}</td><td>{u.role}</td><td className="muted">{u.source}</td>
                <td>{u.removable ? <button className="btn small danger" onClick={() => removeUser(u.user)}>Remove</button> : <span className="muted small">recovery</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Add / update a login</h3>
        <form className="rowform" onSubmit={addUser}>
          <input placeholder="username" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          <input placeholder="password" type="password" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="user">user</option><option value="admin">admin</option>
          </select>
          <button className="btn primary">Save</button>
          {msg ? <span className="muted small">{msg}</span> : null}
        </form>
      </div>

      {access ? (
        <div className="card">
          <h3>Panel access</h3>
          <p className="muted small">Default: <code>{JSON.stringify(access.access && access.access.default)}</code></p>
          <p className="muted small">Panels: {(access.panels || []).map((p) => p.key).join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}
