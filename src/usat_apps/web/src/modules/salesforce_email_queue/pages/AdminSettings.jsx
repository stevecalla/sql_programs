import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import * as store from '../lib/store.js';
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
  const [sendEnabled, setSendEnabled] = useState(false);
  const [queueFrom, setQueueFrom] = useState({});   // { <queue_id>: '<address>' } (working copy, edited before Save)
  const [queues, setQueues] = useState([]);
  const [owe, setOwe] = useState([]);
  const [msg, setMsg] = useState({});   // { landing, sfEnv, banner, sendToggle, queueFrom }

  const applyCfg = (c) => {
    setCfg(c);
    setLanding(c.admin_landing || '/metrics');
    setSfEnv(c.sf_env || 'prod');
    setBanner(c.show_test_banner !== false);
    setSendEnabled(c.send_enabled === true);
    setQueueFrom(c.send_queue_from && typeof c.send_queue_from === 'object' ? { ...c.send_queue_from } : {});
  };
  const load = () => api.adminConfig().then(applyCfg).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.queues().then((r) => setQueues(r.queues || [])).catch(() => { /* optional */ });
    api.orgWideEmails().then((r) => setOwe(r.addresses || [])).catch(() => { /* optional */ });
    /* eslint-disable-next-line */
  }, []);

  const save = async (key, payload, ok) => {
    setMsg((s) => ({ ...s, [key]: null }));
    try { const r = await api.adminConfigSave(payload); applyCfg(r); setMsg((s) => ({ ...s, [key]: { ok: true, text: ok(r) } })); try { await store.refreshConfig(); } catch (e) { /* ignore */ } }
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
      key: 'sendmaster', title: 'Email sending (master switch)', children: (
        <>
          <p className="muted small">The app-wide <b>on/off switch</b> for sending replies out through Salesforce. When <b>off</b>, operators can still draft, ask, and copy replies, but the <b>Send</b> button is disabled everywhere and the server refuses any send — nothing reaches a member. Leave this <b>off</b> until sending is production-ready; flip it on when you want operators to be able to send.</p>
          <label className="rowform" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={sendEnabled} onChange={(e) => setSendEnabled(e.target.checked)} /> Allow operators to send email through Salesforce
          </label>
          <div className="small" style={{ marginTop: 4, color: sendEnabled ? '#16a34a' : '#d32f2f' }}>
            {sendEnabled ? '● Sending is currently ENABLED — operators can send.' : '● Sending is currently OFF — no email can be sent.'}
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => save('sendToggle', { send_enabled: sendEnabled }, (r) => 'Email sending ' + (r.send_enabled ? 'ENABLED' : 'turned OFF') + '. Takes effect in open operator tabs on focus (and within ~45s otherwise) — no reload needed.')}>Save</button>
          </div>
          <Msg m={msg.sendToggle} />
        </>
      )
    },
    {
      key: 'queuefrom', title: 'Per-queue “From” address', children: (
        <>
          <p className="muted small">The default <b>From</b> address a reply is sent as, per queue. Choose a Salesforce <b>verified Org-Wide Email Address</b> (loaded live below) for each queue — e.g. the coaching queue sends as the coaching inbox. When an operator sends with <b>From → “Queue default”</b>, the reply uses the address you map here. Queues left as <i>(SF user)</i> send from the operator’s connected Salesforce user. Only addresses Salesforce has verified appear in the dropdowns.</p>
          {owe.length
            ? <p className="muted small">Verified org-wide addresses available: {owe.map((a) => a.address).join(', ')}.</p>
            : <p className="small" style={{ color: '#b45309' }}>No verified Org-Wide Email Addresses found in this org yet. Verify one in Salesforce (Setup → Org-Wide Addresses) — e.g. <code>teamusa@usatriathlon.org</code> — and it’ll show up here.</p>}
          <div style={{ marginTop: 8 }}>
            {(queues || []).length ? (queues || []).map((q) => (
              <div className="rowform" key={q.id} style={{ alignItems: 'center', marginBottom: 6 }}>
                <label className="muted small" style={{ minWidth: 160, display: 'inline-block' }}>{q.name}</label>
                <select value={queueFrom[q.id] || ''} onChange={(e) => setQueueFrom((m) => ({ ...m, [q.id]: e.target.value }))}>
                  <option value="">(SF user — no default)</option>
                  {owe.map((a) => <option key={a.id} value={a.address}>{(a.display_name ? a.display_name + ' — ' : '') + a.address}</option>)}
                </select>
              </div>
            )) : <p className="muted small">No queues loaded (they load from Salesforce).</p>}
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => save('queueFrom', { send_queue_from: queueFrom }, (r) => { const n = Object.keys(r.send_queue_from || {}).length; return 'Saved — ' + n + ' queue' + (n === 1 ? '' : 's') + ' mapped to a From address.'; })}>Save mapping</button>
          </div>
          <Msg m={msg.queueFrom} />
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
