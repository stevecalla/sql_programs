import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Admin · Access — user management + panel access. Layout mirrors the email-queue admin Access pane
// (three "ad-card" sections: Users, general default, per user) for visual + behavioural parity:
//   • Users: .env recovery accounts (always valid, not removable) + stored scrypt-hashed users.
//   • Panel access — general default: which panels non-admins see by default (admins always see all).
//   • Panel access — per user: override the default for one user ("Use default" removes the override).

export default function Admin() {
  const [users, setUsers] = useState(null);
  const [panels, setPanels] = useState([]);          // catalog [{key,label,group}]
  const [access, setAccess] = useState({ default: [], users: {} });
  const [err, setErr] = useState('');

  // add-user form
  const [nu, setNu] = useState('');
  const [np, setNp] = useState('');
  const [nr, setNr] = useState('user');
  const [uMsg, setUMsg] = useState(null);

  // default-access editor
  const [defMode, setDefMode] = useState('some');    // 'all' | 'some'
  const [defSet, setDefSet] = useState({});          // { panelKey: true }
  const [defMsg, setDefMsg] = useState(null);

  // per-user editor
  const [selUser, setSelUser] = useState('');
  const [uMode, setUMode] = useState('default');     // 'default' | 'all' | 'some'
  const [uSet, setUSet] = useState({});
  const [accMsg, setAccMsg] = useState(null);

  const loadUsers = () => api.adminUsers().then((r) => setUsers(r.users || [])).catch((e) => setErr(e.message));
  const loadAccess = () => api.adminPanelAccess().then((r) => {
    setPanels(r.panels || []);
    const a = r.access || { default: [], users: {} };
    setAccess(a);
    const defAll = a.default === 'all';
    setDefMode(defAll ? 'all' : 'some');
    const ds = {}; if (!defAll) (a.default || []).forEach((k) => { ds[k] = true; }); setDefSet(ds);
  }).catch((e) => setErr(e.message));

  useEffect(() => { loadUsers(); loadAccess(); }, []);

  // when the selected user changes, hydrate the per-user editor from the current override
  useEffect(() => {
    const ov = access.users ? access.users[selUser] : undefined;
    setUMode(ov === undefined ? 'default' : (ov === 'all' ? 'all' : 'some'));
    const s = {}; if (Array.isArray(ov)) ov.forEach((k) => { s[k] = true; }); setUSet(s);
  }, [selUser, access]);

  const knownUsers = users ? users.map((u) => u.user) : [];

  const saveUser = async () => {
    const user = nu.trim();
    if (!user) { setUMsg({ text: 'username required', kind: 'err' }); return; }
    if (np.length < 4) { setUMsg({ text: 'password must be at least 4 characters', kind: 'err' }); return; }
    try {
      const r = await api.adminUserSave(user, np, nr);
      setUMsg({ text: 'Saved “' + r.user + '” (' + r.role + ').', kind: 'ok' });
      setNu(''); setNp('');
      loadUsers(); loadAccess();
    } catch (e) { setUMsg({ text: e.message, kind: 'err' }); }
  };
  const resetPw = (u) => { setNu(u); setNp(''); setUMsg({ text: 'Enter a new password for “' + u + '” and Add / update user.', kind: '' }); };
  const removeUser = async (u) => {
    if (!window.confirm('Remove user “' + u + '”?')) return;
    try { await api.adminUserRemove(u); loadUsers(); loadAccess(); }
    catch (e) { setUMsg({ text: e.message, kind: 'err' }); }
  };

  const saveDefault = async () => {
    setDefMsg({ text: 'Saving…', kind: '' });
    const payload = { default: defMode === 'all' ? 'all' : Object.keys(defSet).filter((k) => defSet[k]) };
    try { const r = await api.adminPanelAccessSave(payload); setAccess(r.access); setDefMsg({ text: 'Saved.', kind: 'ok' }); }
    catch (e) { setDefMsg({ text: e.message, kind: 'err' }); }
  };
  const saveUserAccess = async () => {
    if (!selUser) { setAccMsg({ text: 'pick a user', kind: 'err' }); return; }
    setAccMsg({ text: 'Saving…', kind: '' });
    const payload = uMode === 'default'
      ? { user: selUser, clear: true }
      : { user: selUser, panels: uMode === 'all' ? 'all' : Object.keys(uSet).filter((k) => uSet[k]) };
    try { const r = await api.adminPanelAccessSave(payload); setAccess(r.access); setAccMsg({ text: 'Saved.', kind: 'ok' }); }
    catch (e) { setAccMsg({ text: e.message, kind: 'err' }); }
  };

  const msg = (m) => (m && m.text ? <span className={'msg ' + (m.kind || '')}>{m.text}</span> : null);

  // qlist of panel checkboxes (mirrors the email-queue queue checkbox list)
  const qlist = (set, setSet) => (
    <div className="qlist">
      {panels.map((p) => (
        <label key={p.key}>
          <input type="checkbox" checked={!!set[p.key]} onChange={(e) => setSet({ ...set, [p.key]: e.target.checked })} />
          {p.label}{p.group ? <span className="mut" style={{ opacity: .6 }}>&nbsp;· {p.group}</span> : null}
        </label>
      ))}
    </div>
  );

  if (err) return (<div className="access-pane"><h2>Admin · Access</h2><p className="msg err">{err}</p></div>);

  return (
    <div className="access-pane">
      {/* USERS */}
      <div className="ad-card">
        <h2>Users</h2>
        <div className="mut">
          App logins. <code>.env</code> accounts (<code>MERGE_ADMIN_*</code>, <code>MERGE_TEST_*</code>) are
          always-valid recovery accounts and can’t be removed; add app-specific users below. Role <b>admin</b> can
          reach this Admin page and manage users.
        </div>
        <table className="acl-grid" style={{ marginTop: 10 }}>
          <thead><tr><th>User</th><th>Role</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {!users && <tr><td className="mut">Loading…</td></tr>}
            {users && users.map((u) => (
              <tr key={u.user}>
                <td>{u.user}</td>
                <td><span className={'pill ' + (u.role === 'admin' ? 'admin' : 'user')}>{u.role}</span></td>
                <td><span className={'pill ' + (u.source === 'env' ? 'env' : 'stored')}>{u.source}</span></td>
                <td>
                  {u.removable
                    ? (<><button className="btn ghost sm" onClick={() => resetPw(u.user)}>reset pw</button>{' '}
                       <button className="btn ghost sm" onClick={() => removeUser(u.user)}>remove</button></>)
                    : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="act-row" style={{ marginTop: 10 }}>
          <input type="text" placeholder="username" value={nu} onChange={(e) => setNu(e.target.value)} autoComplete="off" style={{ width: 160 }} />
          <input type="password" placeholder="password" value={np} onChange={(e) => setNp(e.target.value)} autoComplete="new-password" style={{ width: 160 }} />
          <select value={nr} onChange={(e) => setNr(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn primary" onClick={saveUser}>Add / update user</button>
          {msg(uMsg)}
        </div>
      </div>

      {/* PANEL ACCESS — GENERAL DEFAULT */}
      <div className="ad-card">
        <h2>Panel access — general default</h2>
        <div className="mut">Which panels non-admin users see by default. Admins always see every panel. (Out of the box: everything except Metrics.)</div>
        <div className="act-row" style={{ marginTop: 10 }}>
          <label><input type="radio" name="defmode" checked={defMode === 'all'} onChange={() => setDefMode('all')} /> All panels</label>
          <label><input type="radio" name="defmode" checked={defMode === 'some'} onChange={() => setDefMode('some')} /> Only selected</label>
        </div>
        {defMode === 'some' && qlist(defSet, setDefSet)}
        <button className="btn primary" onClick={saveDefault}>Save default</button>{msg(defMsg)}
      </div>

      {/* PANEL ACCESS — PER USER */}
      <div className="ad-card">
        <h2>Panel access — per user</h2>
        <div className="mut">Override the default for one user. “Use default” removes the override.</div>
        <div className="act-row" style={{ marginTop: 10 }}>
          <span className="mut">User:</span>
          <select value={selUser} onChange={(e) => setSelUser(e.target.value)}>
            <option value="">—</option>
            {knownUsers.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <label><input type="radio" name="usermode" checked={uMode === 'default'} onChange={() => setUMode('default')} /> Use default</label>
          <label><input type="radio" name="usermode" checked={uMode === 'all'} onChange={() => setUMode('all')} /> All panels</label>
          <label><input type="radio" name="usermode" checked={uMode === 'some'} onChange={() => setUMode('some')} /> Only selected</label>
        </div>
        {uMode === 'some' && qlist(uSet, setUSet)}
        <button className="btn primary" onClick={saveUserAccess} disabled={!selUser}>Save user</button>{msg(accMsg)}
        <div className="mut" style={{ marginTop: 12 }}>
          Note: the <b>Admin</b> page itself is governed by the <b>admin</b> role, not by panel access — a non-admin can
          never reach user management even if granted other panels.
        </div>
      </div>
    </div>
  );
}
