import { Link } from 'react-router-dom';
import { NAV, canSee } from '../nav.js';

// Platform landing — a card per panel the signed-in user can reach, grouped like the rail. The "single
// app" front door.
export default function Home({ user }) {
  const cards = [];
  NAV.forEach((n) => {
    if (n.type === 'solo') { if (canSee(user, n.panel)) cards.push({ label: n.label, path: n.path, group: null }); }
    else n.items.forEach((it) => { if (canSee(user, it.panel)) cards.push({ label: it.label, path: it.path, group: n.label }); });
  });

  return (
    <div className="page">
      <h2>USAT Apps</h2>
      <p className="muted">One place for USAT's internal tools. Pick a panel to get started{user && user.role === 'admin' ? ' — or manage users and access under Admin.' : '.'}</p>

      <div className="ref-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginTop: 12 }}>
        {cards.length === 0 ? (
          <div className="card"><h3>No panels yet</h3><p className="muted">You don't have access to any panels. Ask an admin to grant access.</p></div>
        ) : cards.map((m) => (
          <Link key={m.path} to={m.path} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            {m.group ? <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{m.group}</div> : null}
            <h3 style={{ marginBottom: 4 }}>{m.label}</h3>
            <p className="muted">Open →</p>
          </Link>
        ))}
      </div>

      <p className="muted small" style={{ marginTop: 24 }}>
        Signed in as <b>{user.user}</b>{user.role === 'admin' ? ' (admin)' : ''}. Sign-in is local for now; Microsoft SSO is planned.
      </p>
    </div>
  );
}
