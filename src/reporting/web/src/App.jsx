import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import SideRail from './components/SideRail.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import UserMenu from './components/UserMenu.jsx';
import HeaderRefresh from './components/HeaderRefresh.jsx';
import FooterClock from './components/FooterClock.jsx';
import Login from './pages/Login.jsx';
import ParticipationMap from './pages/ParticipationMap.jsx';
import Reference from './pages/Reference.jsx';
import Admin from './pages/Admin.jsx';
import Metrics from './pages/Metrics.jsx';

// Map each route to the panel key the server gates it by, so the router hides pages a user can't
// reach (the server still enforces this — this is the matching UX layer). Mirrors merge's App.
const ROUTE_PANEL = {
  '/': 'participation-maps', '/reference': '', '/metrics': 'metrics', '/admin': 'admin',
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const location = useLocation();

  useEffect(() => {
    api.me().then((r) => setUser(r.status === 200 && r.body.ok ? r.body : null)).catch(() => setUser(null));
  }, []);

  useEffect(() => { if (user && user.ok) api.event({ event_name: 'page_view', view: location.pathname }); }, [location.pathname, user]);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const panels = Array.isArray(user.panels) ? user.panels : [];
  const canSee = (path) => {
    const key = ROUTE_PANEL[path];
    if (key === undefined || key === '') return true;
    if (key === 'admin') return user.role === 'admin';
    return user.role === 'admin' || panels.includes(key);
  };
  const guard = (path, el) => (canSee(path) ? el : <Navigate to="/" replace />);

  return (
    <div className="wrap">
      <header className="app-header">
        <div className="title-row">
          <span className="brandmark" aria-hidden="true">R</span>
          <h1>USAT Reporting</h1>
          <span className="header-btns">
            <HeaderRefresh />
            <ThemeToggle />
            <UserMenu user={user} onLogout={async () => { await api.logout(); setUser(null); }} />
          </span>
        </div>
      </header>

      <div className="admin-shell">
        <SideRail user={user} />
        <main className="admin-main">
          <Routes>
            <Route path="/" element={guard('/', <ParticipationMap />)} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/metrics" element={guard('/metrics', <Metrics />)} />
            <Route path="/admin" element={guard('/admin', <Admin />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <FooterClock />
        </main>
      </div>
    </div>
  );
}
