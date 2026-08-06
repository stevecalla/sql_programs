import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ReorderableCards } from '../../../lib/ReorderableList.jsx';   // shared collapsible + drag-reorder cards

// Email Queue admin → Settings. Cards (admin landing, Salesforce environment, banners) each POST their own
// key(s) to /admin/config. AI models & pricing moved to the shared Knowledge & AI admin (#3). Cards are
// collapsible + drag-reorderable via the shared component. Admin-only (route is require_admin server-side).

function Msg({ m }) {
  if (!m || !m.text) return null;
  return <div className="small" style={{ marginTop: 8, color: m.ok ? '#16a34a' : '#d32f2f' }}>{m.text}</div>;
}

export default function AdminSettings() {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [landing, setLanding] = useState('/metrics');
  const [sfEnv, setSfEnv] = useState('prod');
  const [banner, setBanner] = useState(true);
  const [msg, setMsg] = useState({});   // { landing, sfEnv, banner }

  const applyCfg = (c) => {
    setCfg(c);
    setLanding(c.admin_landing || '/metrics');
    setSfEnv(c.sf_env || 'prod');
    setBanner(c.show_test_banner !== false);
  };
  const load = () => api.adminConfig().then(applyCfg).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async (key, payload, ok) => {
    setMsg((s) => ({ ...s, [key]: null }));
    try { const r = await api.adminConfigSave(payload); applyCfg(r); setMsg((s) => ({ ...s, [key]: { ok: true, text: ok(r) } })); }
    catch (e) { setMsg((s) => ({ ...s, [key]: { ok: false, text: e.message } })); }
  };

  if (err) return (<div className="page"><h2>Email Queue · Settings</h2><p className="err">{err}</p></div>);
  if (!cfg) return (<div className="page"><h2>Email Queue · Settings</h2><p className="muted">Loading…</p></div>);

  const items = [
    {
      key: 'landing', title: 'Admin default landing page', children: (
        <>
          <p className="muted small">Where an <b>admin</b> account is sent by default right after signing in. Non-admins always go to the app. An explicit deep-link (e.g. opening <code>/metrics</code> directly) still wins.</p>
          <div className="rowform">
            <label className="muted small">Default:</label>
            <select value={landing} onChange={(e) => setLanding(e.target.value)}>
              <option value="/metrics">📊 Metrics dashboard</option>
              <option value="/admin">⚙ Admin hub</option>
              <option value="/">📧 App (queue)</option>
            </select>
            <button className="btn primary" onClick={() => save('landing', { admin_landing: landing }, (r) => 'Saved — admins will land on ' + r.admin_landing + '.')}>Save</button>
          </div>
          <Msg m={msg.landing} />
        </>
      )
    },
    {
      key: 'sfenv', title: 'Salesforce environment', children: (
        <>
          <p className="muted small">Which Salesforce org the app reads from. <b>Production</b> = live data (<code>SF_PROD_*</code>). <b>Sandbox</b> = practice org (<code>SF_DEV_*</code>, test.salesforce.com) — safe for testing. Switching reconnects; reload the app afterward. The app shows a 🧪 SANDBOX banner while in sandbox, and every analytics row is tagged with the environment.</p>
          <div className="rowform">
            <label className="muted small">Read from:</label>
            <select value={sfEnv} onChange={(e) => setSfEnv(e.target.value)}>
              <option value="prod">🟢 Production (live)</option>
              <option value="sandbox">🧪 Sandbox (dev)</option>
            </select>
            <button className="btn primary" onClick={() => save('sfEnv', { sf_env: sfEnv }, (r) => 'Now reading from ' + (r.sf_env === 'sandbox' ? 'SANDBOX (dev)' : 'PRODUCTION') + '. Reload the app to use it.')}>Save</button>
          </div>
          <Msg m={msg.sfEnv} />
        </>
      )
    },
    {
      key: 'banners', title: 'Banners', children: (
        <>
          <p className="muted small">The <b>🧪 SANDBOX</b> banner always shows while reading from the sandbox org (safety) and can't be turned off. The <b>TEST MODE</b> banner appears on pages opened with <code>?metrics_test=1</code> (the admin nav links) — turn it off here if it gets in the way.</p>
          <label className="rowform" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /> Show the TEST MODE banner
          </label>
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => save('banner', { show_test_banner: banner }, (r) => 'TEST banner ' + (r.show_test_banner !== false ? 'on' : 'off') + '. Reload pages to apply.')}>Save</button>
          </div>
          <Msg m={msg.banner} />
        </>
      )
    },
    {
      key: 'models', title: <>AI models &amp; pricing</>, children: (
        <p className="muted small">Moved to <a href="/admin/knowledge"><b>Admin → Knowledge &amp; AI</b></a>. The model list, prices, and default are now managed in the shared panel that <b>both</b> the chatbot and the email queue read — so there’s one place to edit them. API keys still live in the repo-root <code>.env</code>.</p>
      )
    },
  ];

  return (
    <div className="page">
      <h2>Email Queue · Settings</h2>
      <p className="muted small" style={{ marginTop: -4 }}>Drag the <b>⠿</b> handle to reorder; click a title to collapse.</p>
      <ReorderableCards storageKey="eq_admin_settings" items={items} />
    </div>
  );
}
