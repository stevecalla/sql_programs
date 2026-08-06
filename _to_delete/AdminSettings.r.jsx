import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Settings. Ported 1:1 from the standalone app's /admin Settings pane: four cards
// (admin landing, Salesforce environment, banners, AI models & pricing), each POSTing its own key(s) to
// /admin/config. Admin-only (the route is require_admin server-side).

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
  const [models, setModels] = useState([]);
  const [msg, setMsg] = useState({});   // { landing, sfEnv, banner, models }

  const applyCfg = (c) => {
    setCfg(c);
    setLanding(c.admin_landing || '/metrics');
    setSfEnv(c.sf_env || 'prod');
    setBanner(c.show_test_banner !== false);
    setModels((c.ai_models || []).map((m) => ({ ...m })));
  };
  const load = () => api.adminConfig().then(applyCfg).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async (key, payload, ok) => {
    setMsg((s) => ({ ...s, [key]: null }));
    try { const r = await api.adminConfigSave(payload); applyCfg(r); setMsg((s) => ({ ...s, [key]: { ok: true, text: ok(r) } })); }
    catch (e) { setMsg((s) => ({ ...s, [key]: { ok: false, text: e.message } })); }
  };

  const setModel = (i, patch) => setModels((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const setDefault = (i) => setModels((ms) => ms.map((m, j) => ({ ...m, is_default: j === i })));
  const addModel = () => setModels((ms) => ms.concat([{ provider: 'openai', model: '', label: '', is_default: ms.length === 0, price_in: 0, price_out: 0 }]));
  const delModel = (i) => setModels((ms) => ms.filter((_, j) => j !== i));
  const saveModels = () => {
    const rows = models.filter((m) => String(m.model || '').trim());
    if (!rows.length) { setMsg((s) => ({ ...s, models: { ok: false, text: 'Add at least one model.' } })); return; }
    save('models', { ai_models: rows.map((m) => ({ provider: m.provider, model: String(m.model).trim(), label: m.label || m.model, is_default: !!m.is_default, price_in: parseFloat(m.price_in) || 0, price_out: parseFloat(m.price_out) || 0 })) }, (r) => 'Saved ' + (r.ai_models || []).length + ' model(s).');
  };

  if (err) return (<div className="page"><h2>Email Queue · Settings</h2><p className="err">{err}</p></div>);
  if (!cfg) return (<div className="page"><h2>Email Queue · Settings</h2><p className="muted">Loading…</p></div>);

  return (
    <div className="page">
      <h2>Email Queue · Settings</h2>

      {/* Admin default landing page */}
      <div className="card">
        <h3>Admin default landing page</h3>
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
      </div>

      {/* Salesforce environment */}
      <div className="card">
        <h3>Salesforce environment</h3>
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
      </div>

      {/* Banners */}
      <div className="card">
        <h3>Banners</h3>
        <p className="muted small">The <b>🧪 SANDBOX</b> banner always shows while reading from the sandbox org (safety) and can't be turned off. The <b>TEST MODE</b> banner appears on pages opened with <code>?metrics_test=1</code> (the admin nav links) — turn it off here if it gets in the way.</p>
        <label className="rowform" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /> Show the TEST MODE banner
        </label>
        <div style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => save('banner', { show_test_banner: banner }, (r) => 'TEST banner ' + (r.show_test_banner !== false ? 'on' : 'off') + '. Reload pages to apply.')}>Save</button>
        </div>
        <Msg m={msg.banner} />
      </div>

      {/* AI models & pricing */}
      <div className="card">
        <h3>AI models &amp; pricing</h3>
        <p className="muted small">The models offered in the app's picker <i>and</i> the metrics Ask box (one shared list). Prices are <b>USD per 1M tokens</b> and drive cost tracking. Seeded from the vendor pricing pages — edit when prices change. Pick one <b>Default</b>. Vendor pricing: <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener">OpenAI</a> · <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener">Anthropic</a>.</p>
        <div className="mx-tablewrap">
          <table className="grid">
            <thead><tr><th>Default</th><th>Provider</th><th>Model</th><th>Label</th><th>Input $/1M</th><th>Output $/1M</th><th></th></tr></thead>
            <tbody>
              {models.length === 0 && <tr><td className="muted" colSpan={7}>No models — add one below.</td></tr>}
              {models.map((m, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center' }}><input type="radio" name="modelDefault" checked={!!m.is_default} onChange={() => setDefault(i)} /></td>
                  <td><select value={m.provider} onChange={(e) => setModel(i, { provider: e.target.value })}><option value="openai">openai</option><option value="anthropic">anthropic</option></select></td>
                  <td><input style={{ minWidth: 190 }} value={m.model} onChange={(e) => setModel(i, { model: e.target.value })} placeholder="gpt-4o-mini" /></td>
                  <td><input value={m.label} onChange={(e) => setModel(i, { label: e.target.value })} placeholder="ChatGPT (OpenAI)" /></td>
                  <td><input type="number" step="0.01" min="0" style={{ width: 90 }} value={m.price_in} onChange={(e) => setModel(i, { price_in: e.target.value })} /></td>
                  <td><input type="number" step="0.01" min="0" style={{ width: 90 }} value={m.price_out} onChange={(e) => setModel(i, { price_out: e.target.value })} /></td>
                  <td><button className="btn" onClick={() => delModel(i)}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rowform" style={{ marginTop: 8 }}>
          <button className="btn" onClick={addModel}>+ Add model</button>
          <button className="btn primary" onClick={saveModels}>Save models</button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>API keys (<code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>) and the <code>OPENAI_MODEL</code>/<code>ANTHROPIC_MODEL</code> defaults live in the repo-root <code>.env</code> (see Reference).</p>
        <Msg m={msg.models} />
      </div>
    </div>
  );
}
