import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ReorderableCards } from '../../../lib/ReorderableList.jsx';   // shared collapsible + drag-reorder cards

// Email Queue admin → Overview. Booleans-only configuration status. Card is collapsible + drag-reorderable
// via the shared component. Admin-only (route is require_admin server-side).

const TILES = [
  ['Salesforce', 'salesforce_configured'],
  ['OpenAI key', 'openai_key'],
  ['Anthropic key', 'anthropic_key'],
  ['Analytics DB', 'analytics_db'],
  ['Admin login (.env)', 'admin_login_configured'],
  ['User login', 'user_login_configured'],
  ['ngrok', 'ngrok_enabled'],
];
function Pill({ on }) { return <span style={{ color: on ? '#16a34a' : '#d32f2f', fontWeight: 700 }}>{on ? 'yes' : 'no'}</span>; }

export default function AdminOverview() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.adminStatus().then(setStatus).catch((e) => setErr(e.message)); }, []);
  const items = [{
    key: 'status', title: 'Configuration status', defaultOpen: true, children: (
      <>
        {err && <p className="err">{err}</p>}
        {!err && !status && <p className="muted">Loading…</p>}
        {!err && status && (
          <>
            <div className="mx-cards">
              {TILES.map(([label, key]) => (
                <div className="mx-card" key={key}><div className="k">{label}</div><div className="v"><Pill on={!!status[key]} /></div><div className="s">configured</div></div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Booleans only — no secrets or values are shown.</p>
          </>
        )}
      </>
    )
  }];
  return (
    <div className="page">
      <h2>Email Queue · Overview</h2>
      <ReorderableCards storageKey="eq_admin_overview" items={items} />
    </div>
  );
}
