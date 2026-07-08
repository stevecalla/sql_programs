import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Settings — read-only Configuration panel (mirrors the proxy console's Settings): process +
// runtime config tiles, plus a note about where routes and refresh intervals live.
export default function OpsSettings() {
  const [s, setS] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.opsStatus().then((r) => { if (r.status === 200 && r.body.ok) setS(r.body); else setErr(r.body.error || ('HTTP ' + r.status)); }).catch((e) => setErr(String(e)));
    api.opsRoutes().then((r) => { if (r.status === 200 && r.body.ok) setRoutes(r.body.routes || []); }).catch(() => {});
  }, []);

  const tiles = s ? [
    ['pm2 name', s.pm2_name], ['node', s.node], ['pid', s.pid],
    ['rate limit', s.rate_limit ? 'on' : 'off'], ['enabled routes', routes ? routes.length : '—'],
    ['pm2 log dir', s.pm2_log_dir], ['uptime (s)', s.uptime_seconds],
  ] : [];

  return (
    <div className="page">
      <h2>Settings</h2>
      {err ? <p className="err">{err}</p> : null}
      <div className="card">
        <h3>Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {tiles.length ? tiles.map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="muted small">{k}</div>
              <div style={{ fontWeight: 700, fontSize: 15, wordBreak: 'break-word' }}>{v == null ? '—' : String(v)}</div>
            </div>
          )) : <div className="muted">Loading…</div>}
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Routes are edited in <code>utilities/proxy/proxy_routes.js</code> (reload the proxy to apply). Per-pane
          refresh intervals are saved in your browser. Panel access is managed under <b>Admin → Users &amp; access</b>.
        </p>
      </div>
    </div>
  );
}
