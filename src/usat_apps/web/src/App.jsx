import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import { trackPanelView } from './lib/track.js';
import { allPanels, canSee } from './nav.js';
import SideRail from './components/SideRail.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import UserMenu from './components/UserMenu.jsx';
import FooterClock from './components/FooterClock.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const location = useLocation();

  useEffect(() => {
    api.me().then((r) => setUser(r.status === 200 && r.body.ok ? r.body : null)).catch(() => setUser(null));
  }, []);

  useEffect(() => { if (user && user.ok) trackPanelView(location.pathname); }, [location.pathname, user]);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const guard = (panel, el) => (canSee(user, panel) ? el : <Navigate to="/" replace />);

  return (
    <div className="wrap">
      <header className="app-header">
        <div className="title-row">
          <span className="brandmark" aria-hidden="true">U</span>
          <h1>USAT Apps</h1>
          <span className="header-btns">
            <ThemeToggle />
            <UserMenu user={user} onLogout={async () => { await api.logout(); setUser(null); }} />
          </span>
        </div>
      </header>

      <div className="admin-shell">
        <SideRail user={user} />
        <main className="admin-main">
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Home user={user} />} />
              {allPanels().map((p) => (
                <Route key={p.path} path={p.path} element={guard(p.panel, <p.Component title={p.label} user={user} />)} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <FooterClock />
        </main>
      </div>
    </div>
  );
}
