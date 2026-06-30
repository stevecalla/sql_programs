import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api.js';
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
import Placeholder from './pages/Placeholder.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    api.me().then((m) => setUser(m && m.ok ? m : null)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="wrap">
      <header className="app-header">
        <div className="title-row">
          <span className="brandmark" aria-hidden="true">M</span>
          <h1>Account Merge Console</h1>
          <span className="header-btns">
            <HeaderRefresh />
            <ThemeToggle />
            <UserMenu user={user} onLogout={async () => { await api.logout(); setUser(null); }} />
          </span>
        </div>
      </header>

      <div className="admin-shell">
        <SideRail />
        <main className="admin-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/duplicates" element={<Duplicates />} />
            <Route path="/merge-id" element={<MergeId />} />
            <Route path="/accounts" element={<AllAccounts />} />
            <Route path="/get-duplicates" element={<GetDuplicates />} />
            <Route path="/select-merges" element={<SelectMerges />} />
            <Route path="/merge-process" element={<MergeProcess />} />
            <Route path="/restore" element={<Restore />} />
            <Route path="/tuning" element={<Tuning />} />
            <Route path="/admin" element={<Placeholder title="Admin" note="Phase 1b" />} />
            <Route path="/metrics" element={<Placeholder title="Metrics" note="Phase 1" />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <FooterClock />
        </main>
      </div>
    </div>
  );
}
