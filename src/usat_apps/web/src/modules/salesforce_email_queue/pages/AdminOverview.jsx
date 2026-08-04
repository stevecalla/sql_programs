import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Overview. Booleans-only configuration status, ported 1:1 from the standalone /admin
// Overview pane. Every tile is a plain yes/no derived from server state — no secrets or values are shown.
// Admin-only (the route is require_admin server-side).

const TILES = [
  ['Salesforce', 'salesforce_configured'],
  ['OpenAI key', 'openai_key'],
  ['Anthropic key', 'anthropic_key'],
  ['Analytics DB', 'analytics_db'],
  ['Admin login (.env)', 'admin_login_configured'],
  ['User login', 'user_login_configured'],
  ['ngrok', 'ngrok_enabled'],
];

function Pill({ on }) {
  return <span style={{ color: on ? '#16a34a' : '#d32f2f', fontWeight: 700 }}>{on ? 'yes' : 'no'}</span>;
}

export default function AdminOverview() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.adminStatus().then(setStatus).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="page">
      <h2>Email Queue · Overview</h2>

      <div className="card">
        <h3>Configuration status</h3>
        {err && <p className="err">{err}</p>}
        {!err && !status && <p className="muted">Loading…</p>}
        {!err && status && (
          <>
            <div className="mx-cards">
              {TILES.map(([label, key]) => (
                <div className="mx-card" key={key}>
                  <div className="k">{label}</div>
                  <div className="v"><Pill on={!!status[key]} /></div>
                  <div className="s">configured</div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Booleans only — no secrets or values are shown.</p>
          </>
        )}
      </div>
    </div>
  );
}
