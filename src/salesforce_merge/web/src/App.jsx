import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import { trackPanelView, trackSession } from './lib/track.js';
import SideRail from './components/SideRail.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import UserMenu from './components/UserMenu.jsx';
import HeaderRefresh from './components/HeaderRefresh.jsx';
import FooterClock from './components/FooterClock.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Duplicates from './pages/Duplicates.jsx';
import MergeId from './pages/MergeId.jsx';
import AllAccounts from './pages/AllAccounts.jsx';
import Reference from './pages/Reference.jsx';
import GetDuplicates from './pages/GetDuplicates.jsx';
import Tuning from './pages/Tuning.jsx';
import SelectMerges from './pages/SelectMerges.jsx';
import MergeProcess from './pages/MergeProcess.jsx';
import Restore from './pages/Restore.jsx';
import Admin from './pages/Admin.jsx';
import Metrics from './pages/Metrics.jsx';
import Placeholder from './pages/Placeholder.jsx';

// Map each route path to the panel key the server gates it by, so the router can hide pages a user
// can't reach (the server still enforces this — the nav/route guard is the matching UX layer).
const ROUTE_PANEL = {
  '/': '', '/duplicates': 'duplicates', '/merge-id': 'merge-id', '/accounts': 'accounts',
  '/get-duplicates': 'get-duplicates', '/select-merges': 'select-merges', '/merge-process': 'merge-process',
  '/restore': 'restore', '/tuning': 'tuning', '/metrics': 'metrics', '/admin': 'admin', '/reference': 'reference',
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const location = useLocation();

  useEffect(() => {
    api.me().then((m) => setUser(m && m.ok ? m : null)).catch(() => setUser(null));
  }, []);

  // Usage analytics: emit a panel_view on every route change once signed in.
  useEffect(() => { if (user && user.ok) trackPanelView(location.pathname); }, [location.pathname, user]);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  // Panels this user may reach (admins get all incl. 'admin'). Used to hide nav + guard routes.
  const panels = Array.isArray(user.panels) ? user.panels : [];
  const canSee = (path) => {
    const key = ROUTE_PANEL[path];
    if (key === undefined) return true;
    if (key === 'admin') return user.role === 'admin';
    return user.role === 'admin' || panels.includes(key);
  };
  const guard = (path, el) => (canSee(path) ? el : <Navigate to="/" replace />);

  return (
    <div className="wrap">
      <header className="app-header">
        <div className="title-row">
          <span className="brandmark" aria-hidden="true">M</span>
          <h1>Account Merge Console</h1>
          <span className="header-btns">
            <HeaderRefresh />
            <ThemeToggle />
            <UserMenu user={user} onLogout={async () => { trackSession('logout'); await api.logout(); setUser(null); }} />
          </span>
        </div>
      </header>

      <div className="admin-shell">
        <SideRail user={user} />
        <main className="admin-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/duplicates" element={guard('/duplicates', <Duplicates />)} />
            <Route path="/merge-id" element={guard('/merge-id', <MergeId />)} />
            <Route path="/accounts" element={guard('/accounts', <AllAccounts />)} />
            <Route path="/get-duplicates" element={guard('/get-duplicates', <GetDuplicates />)} />
            <Route path="/select-merges" element={guard('/select-merges', <SelectMerges />)} />
            <Route path="/merge-process" element={guard('/merge-process', <MergeProcess />)} />
            <Route path="/restore" element={guard('/restore', <Restore />)} />
            <Route path="/tuning" element={guard('/tuning', <Tuning />)} />
            <Route path="/admin" element={guard('/admin', <Admin />)} />
            <Route path="/metrics" element={guard('/metrics', <Metrics user={user} />)} />
            <Route path="/reference" element={<Reference />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <FooterClock />
        </main>
      </div>
    </div>
  );
}
