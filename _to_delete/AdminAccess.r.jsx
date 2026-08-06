import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Access. The EQ-specific queue allow-list, ported 1:1 from the standalone /admin
// Access pane: a general default (which SF queues non-admins see) and per-user overrides. Platform user
// accounts + roles are managed in Users & Access (/admin/users); this page only governs queue visibility.
// Admin-only (routes are require_admin server-side).

function Msg({ m }) {
  if (!m || !m.text) return null;
  return <div className="small" style={{ marginTop: 8, color: m.ok ? '#16a34a' : '#d32f2f' }}>{m.text}</div>;
}

function QueueChecks({ queues, set, onToggle }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 14px', margin: '6px 0' }}>
      {queues.map((q) => (
        <label key={q.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={set.has(q.id)} onChange={() => onToggle(q.id)} /> {q.name}
        </label>
      ))}
    </div>
  );
}

export default function AdminAccess() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [defMode, setDefMode] = useState('all');
  const [defSet, setDefSet] = useState(new Set());
  const [selUser, setSelUser] = useState('');
  const [userMode, setUserMode] = useState('default');
  const [userSet, setUserSet] = useState(new Set());
  const [msg, setMsg] = useState({});

  const applyDefault = (access) => {
    if (access.default === 'all' || access.default == null) { setDefMode('all'); setDefSet(new Set()); }
    else { setDefMode('some'); setDefSet(new Set(access.default)); }
  };
  const load = () => api.adminQueueAccess().then((r) => {
    setData(r); applyDefault(r.access || { default: 'all', users: {} });
    const firstUser = (r.users || [])[0] || '';
    setSelUser(firstUser); applyUser(firstUser, r.access || {});
  }).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function applyUser(user, access) {
    const v = (access.users || {})[user];
    if (v === undefined) { setUserMode('default'); setUserSet(new Set()); }
    else if (v === 'all') { setUserMode('all'); setUserSet(new Set()); }
    else { setUserMode('some'); setUserSet(new Set(v)); }
  }
  const onUserChange = (u) => { setSelUser(u); applyUser(u, (data && data.access) || {}); setMsg((s) => ({ ...s, user: null })); };

  const toggle = (set, setSet) => (id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setSet(n); };

  const saveDefault = async () => {
    setMsg((s) => ({ ...s, def: null }));
    try { const r = await api.adminQueueAccessSave({ default: defMode === 'all' ? 'all' : Array.from(defSet) }); setData((d) => ({ ...d, access: r.access })); setMsg((s) => ({ ...s, def: { ok: true, text: 'Saved.' } })); }
    catch (e) { setMsg((s) => ({ ...s, def: { ok: false, text: e.message } })); }
  };
  const saveUser = async () => {
    if (!selUser) { setMsg((s) => ({ ...s, user: { ok: false, text: 'No named user (these come from .env / stored accounts).' } })); return; }
    setMsg((s) => ({ ...s, user: null }));
    const payload = userMode === 'default' ? { user: selUser, clear: true } : { user: selUser, queues: userMode === 'all' ? 'all' : Array.from(userSet) };
    try { const r = await api.adminQueueAccessSave(payload); setData((d) => ({ ...d, access: r.access })); setMsg((s) => ({ ...s, user: { ok: true, text: 'Saved.' } })); }
    catch (e) { setMsg((s) => ({ ...s, user: { ok: false, text: e.message } })); }
  };

  if (err) return (<div className="page"><h2>Email Queue · Access</h2><p className="err">{err}</p></div>);
  if (!data) return (<div className="page"><h2>Email Queue · Access</h2><p className="muted">Loading…</p></div>);
  const queues = data.queues || [];
  const users = data.users || [];

  return (
    <div className="page">
      <h2>Email Queue · Access</h2>
      <p className="muted small">App logins and roles are managed in <a href="/admin/users">Users &amp; access</a>. This page controls which Salesforce <b>queues</b> each non-admin sees. Admins always see every queue.</p>

      {/* Queue access — general default */}
      <div className="card">
        <h3>Queue access — general default</h3>
        <p className="muted small">Which queues non-admin users see by default. Admins always see every queue.</p>
        <label className="small" style={{ display: 'block', margin: '4px 0' }}><input type="radio" name="defmode" checked={defMode === 'all'} onChange={() => setDefMode('all')} /> All queues</label>
        <label className="small" style={{ display: 'block', margin: '4px 0' }}><input type="radio" name="defmode" checked={defMode === 'some'} onChange={() => setDefMode('some')} /> Only selected</label>
        {defMode === 'some' && <QueueChecks queues={queues} set={defSet} onToggle={toggle(defSet, setDefSet)} />}
        <div style={{ marginTop: 8 }}><button className="btn primary" onClick={saveDefault}>Save default</button></div>
        <Msg m={msg.def} />
      </div>

      {/* Queue access — per user */}
      <div className="card">
        <h3>Queue access — per user</h3>
        <p className="muted small">Override the default for one user. "Use default" removes the override.</p>
        <div className="rowform">
          <label className="muted small">User:</label>
          <select value={selUser} onChange={(e) => onUserChange(e.target.value)}>
            {users.length === 0 && <option value="">(no named users — using .env accounts)</option>}
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <label className="small" style={{ display: 'block', margin: '4px 0' }}><input type="radio" name="usermode" checked={userMode === 'default'} onChange={() => setUserMode('default')} /> Use default</label>
        <label className="small" style={{ display: 'block', margin: '4px 0' }}><input type="radio" name="usermode" checked={userMode === 'all'} onChange={() => setUserMode('all')} /> All queues</label>
        <label className="small" style={{ display: 'block', margin: '4px 0' }}><input type="radio" name="usermode" checked={userMode === 'some'} onChange={() => setUserMode('some')} /> Only selected</label>
        {userMode === 'some' && <QueueChecks queues={queues} set={userSet} onToggle={toggle(userSet, setUserSet)} />}
        <div style={{ marginTop: 8 }}><button className="btn primary" onClick={saveUser} disabled={!selUser}>Save user</button></div>
        <Msg m={msg.user} />
      </div>
    </div>
  );
}
