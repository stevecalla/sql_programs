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
  const [statusEnabled, setStatusEnabled] = useState(false);
  const [statusReqs, setStatusReqs] = useState({});   // { <status>: [{ field, required }] } (working copy)
  const [statuses, setStatuses] = useState([]);
  const [caseFields, setCaseFields] = useState([]);
  const [addStatus, setAddStatus] = useState('');     // "add requirement" row: chosen status
  const [addField, setAddField] = useState('');       // chosen field
  const [addReq, setAddReq] = useState(true);         // required?
  const [msg, setMsg] = useState({});   // { landing, sfEnv, banner, sendToggle, queueFrom, statusToggle, statusReqs }

  const applyCfg = (c) => {
    setCfg(c);
    setLanding(c.admin_landing || '/metrics');
    setSfEnv(c.sf_env || 'prod');
    setBanner(c.show_test_banner !== false);
    setSendEnabled(c.send_enabled === true);
    setQueueFrom(c.send_queue_from && typeof c.send_queue_from === 'object' ? { ...c.send_queue_from } : {});
    setStatusEnabled(c.status_enabled === true);
    setStatusReqs(c.status_requirements && typeof c.status_requirements === 'object' ? JSON.parse(JSON.stringify(c.status_requirements)) : {});
  };
  const load = () => api.adminConfig().then(applyCfg).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.queues().then((r) => setQueues(r.queues || [])).catch(() => { /* optional */ });
    api.orgWideEmails().then((r) => setOwe(r.addresses || [])).catch(() => { /* optional */ });
    api.statuses().then((r) => setStatuses(r.statuses || [])).catch(() => { /* optional */ });
    api.caseFields().then((r) => setCaseFields(r.fields || [])).catch(() => { /* optional */ });
    /* eslint-disable-next-line */
  }, []);

  // Premap suggestion: if no status requirements are saved yet, pre-fill "Closed" → the Case field whose label
  // looks like a close reason (matched live from describe), so the admin can just Save. Runs once fields load.
  useEffect(() => {
    if (!cfg || !caseFields.length) return;
    if (cfg.status_requirements && Object.keys(cfg.status_requirements).length) return;   // respect saved config
    if (Object.keys(statusReqs).length) return;
    const f = caseFields.find((x) => /close\s*reason/i.test(x.label)) || caseFields.find((x) => x.name === 'Reason' || /case\s*reason/i.test(x.label));
    if (f && (statuses.indexOf('Closed') >= 0 || !statuses.length)) setStatusReqs({ Closed: [{ field: f.name, required: true }] });
    /* eslint-disable-next-line */
  }, [cfg, caseFields, statuses]);

  const fieldLabel = (name) => { const f = caseFields.find((x) => x.name === name); return f ? f.label + ' (' + name + ')' : name; };
  const addRequirement = () => {
    if (!addStatus || !addField) return;
    setStatusReqs((m) => {
      const rows = (m[addStatus] || []).filter((r) => r.field !== addField);
      return { ...m, [addStatus]: rows.concat([{ field: addField, required: !!addReq }]) };
    });
    setAddField('');
  };
  const removeRequirement = (status, field) => setStatusReqs((m) => {
    const rows = (m[status] || []).filter((r) => r.field !== field);
    const next = { ...m }; if (rows.length) next[status] = rows; else delete next[status]; return next;
  });

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
      key: 'statusmaster', title: 'Case status changes (master switch)', children: (
        <>
          <p className="muted small">The app-wide <b>on/off switch</b> for letting operators change a case’s <b>Status</b> in Salesforce from the app. When <b>off</b>, the status dropdown is read-only (operators can see the status but not change it) and the server refuses any write. Leave this <b>off</b> until the status flow is approved for production.</p>
          <label className="rowform" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={statusEnabled} onChange={(e) => setStatusEnabled(e.target.checked)} /> Allow operators to change case Status in Salesforce
          </label>
          <div className="small" style={{ marginTop: 4, color: statusEnabled ? '#16a34a' : '#d32f2f' }}>
            {statusEnabled ? '● Status changes are currently ENABLED.' : '● Status changes are currently OFF — read-only.'}
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => save('statusToggle', { status_enabled: statusEnabled }, (r) => 'Case status changes ' + (r.status_enabled ? 'ENABLED' : 'turned OFF') + '. Takes effect in open operator tabs on focus (and within ~45s otherwise) — no reload needed.')}>Save</button>
          </div>
          <Msg m={msg.statusToggle} />
        </>
      )
    },
    {
      key: 'statusreqs', title: 'Required fields on status change', children: (
        <>
          <p className="muted small">Some statuses need extra info before Salesforce will accept the change — e.g. <b>Closed</b> requires a <b>Case Close Reason</b>. Map those here: when an operator moves a case to that status, the app prompts for these fields and writes them with the status. The field list is read <b>live from Salesforce</b>, and Salesforce’s own validation rules remain the final backstop.</p>
          {Object.keys(statusReqs).length ? Object.keys(statusReqs).map((st) => (
            <div key={st} style={{ marginBottom: 8 }}>
              <div className="small"><b>{st}</b></div>
              {(statusReqs[st] || []).map((r) => (
                <div className="rowform" key={r.field} style={{ alignItems: 'center', marginTop: 4 }}>
                  <span className="muted small" style={{ minWidth: 220, display: 'inline-block' }}>{fieldLabel(r.field)}</span>
                  <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={!!r.required} onChange={(e) => setStatusReqs((m) => ({ ...m, [st]: m[st].map((x) => x.field === r.field ? { ...x, required: e.target.checked } : x) }))} /> required
                  </label>
                  <button className="btn" onClick={() => removeRequirement(st, r.field)}>Remove</button>
                </div>
              ))}
            </div>
          )) : <p className="muted small">No required fields configured yet.</p>}
          <div className="rowform" style={{ alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
            <label className="muted small">Add:</label>
            <select value={addStatus} onChange={(e) => setAddStatus(e.target.value)}>
              <option value="">status…</option>
              {(statuses.length ? statuses : ['Closed']).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select value={addField} onChange={(e) => setAddField(e.target.value)}>
              <option value="">field…</option>
              {caseFields.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
            </select>
            <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={addReq} onChange={(e) => setAddReq(e.target.checked)} /> required
            </label>
            <button className="btn" onClick={addRequirement} disabled={!addStatus || !addField}>Add</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => save('statusReqs', { status_requirements: statusReqs }, () => 'Saved required-field mapping.')}>Save mapping</button>
          </div>
          {!caseFields.length ? <p className="small" style={{ color: '#b45309' }}>Case fields haven’t loaded (Salesforce read may be unavailable) — the field dropdown will be empty until they do.</p> : null}
          <Msg m={msg.statusReqs} />
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
