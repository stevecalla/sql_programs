// Ops · Reference — static infrastructure docs, ported from the proxy console's Reference pane
// (System reference + System monitors). No endpoints.
const MONITORS = [
  ['top', 'built-in', 'Classic process monitor, always available'],
  ['htop', 'sudo apt install htop', 'Better interactive version of top (terminal only)'],
  ['btop', 'sudo apt install btop', 'Modern UI for CPU/RAM/disk/network (terminal only)'],
  ['atop', 'sudo apt install atop', 'Great for historical / per-process resource usage'],
  ['glances', 'sudo apt install glances', 'All-in-one system monitor'],
  ['nmon', 'sudo apt install nmon', 'CPU / memory / disk / network summaries (terminal only)'],
];

export default function OpsReference() {
  return (
    <div className="page">
      <h2>Reference</h2>

      <div className="card">
        <h3>System reference</h3>
        <ul className="ref-dl" style={{ lineHeight: 1.8 }}>
          <li><b>What this is:</b> a single reverse proxy on <code>:8000</code> fronting every <code>server_*.js</code> at <code>usat-api.kidderwise.org/&lt;prefix&gt;</code>. Backends keep their own ports; the proxy strips the prefix before forwarding.</li>
          <li><b>URL pattern:</b> <code>/&lt;prefix&gt;/&lt;path&gt;</code> → backend gets <code>/&lt;path&gt;</code>. e.g. <code>/events/scheduled-events</code> → 8005 <code>/scheduled-events</code>.</li>
          <li><b>Add / change a route:</b> edit <code>utilities/proxy/proxy_routes.js</code> → <code>npm run pm2_reload_proxy</code> → test the URL.</li>
          <li><b>Reload vs restart:</b> <code>pm2_reload_proxy</code> = zero-downtime; <code>restart_proxy</code> = hard, brief blip. Deploy a backend with <code>pm2 restart &lt;name&gt;</code> — the proxy is untouched.</li>
          <li><b>Health:</b> the <b>Backends</b> pane = all up when every route answers; a down backend usually means it isn't running (<code>ECONNREFUSED</code>).</li>
        </ul>
      </div>

      <div className="card">
        <h3>System monitors</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Used by the <b>System health → Live commands</b> panel. Text snapshots (<code>top -b</code>, <code>atop</code>, <code>glances</code> CSV) render here; the full-screen TUIs (<code>htop</code>, <code>btop</code>, <code>nmon</code>) can't render in a web panel — run those in a terminal/SSH session.
        </p>
        <table className="grid">
          <thead><tr><th>Command</th><th>Install</th><th>Notes</th></tr></thead>
          <tbody>
            {MONITORS.map((m) => (
              <tr key={m[0]}><td><code>{m[0]}</code></td><td><code>{m[1]}</code></td><td>{m[2]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
