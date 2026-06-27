import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api.js';
import TopNav from './components/TopNav.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Duplicates from './pages/Duplicates.jsx';
import MergeId from './pages/MergeId.jsx';
import AllAccounts from './pages/AllAccounts.jsx';
import Reference from './pages/Reference.jsx';
import Placeholder from './pages/Placeholder.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [env, setEnv] = useState('sandbox');    // Phase 0: cosmetic; wired to backend in a later phase

  useEffect(() => {
    api.me().then((m) => setUser(m && m.ok ? m : null)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <TopNav
        user={user}
        env={env}
        setEnv={setEnv}
        onLogout={async () => { await api.logout(); setUser(null); }}
      />
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/duplicates" element={<Duplicates />} />
          <Route path="/merge-id" element={<MergeId />} />
          <Route path="/accounts" element={<AllAccounts />} />
          <Route path="/reference" element={<Reference />} />
          <Route path="/admin" element={<Placeholder title="Admin" note="Phase 1b" />} />
          <Route path="/metrics" element={<Placeholder title="Metrics" note="Phase 1" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
