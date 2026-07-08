import { useEffect, useState } from 'react';

// Reporting module — front-end section (PROOF-OF-CONTRACT stub). Calls the module's own panel-gated
// API (/api/reporting/ping) to prove the end-to-end wiring: nav -> route -> module component ->
// module-owned, access-controlled endpoint.
//
// NEXT STEP (needs your MySQL to test): replace this stub with the ported participation-maps pages
// from src/reporting/web/src/pages (ParticipationMap, ParticipationTabs, Reference, …) and point them
// at /api/reporting/bootstrap + /api/reporting/unique once those handlers are ported into the module.
export default function ReportingSection() {
  const [ping, setPing] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    fetch(base + '/api/reporting/ping', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => (j && j.ok ? setPing(j) : setErr(j.error || 'request failed')))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="page">
      <h2>Reporting</h2>
      <p className="muted">Participation maps &amp; reports — this module is wired into the platform. The full maps UI is the next port (it needs the live MySQL data pipe).</p>

      <div className="card" style={{ maxWidth: 560 }}>
        <h3>Module status</h3>
        {ping ? (
          <ul className="ref-dl">
            <li><b>Module:</b> {ping.module}</li>
            <li><b>Signed-in as:</b> {ping.user}</li>
            <li><b>Panel-gated API:</b> reachable ✓</li>
            <li className="muted">{ping.msg}</li>
          </ul>
        ) : err ? (
          <p className="err">Module API error: {err}</p>
        ) : (
          <p className="muted">Checking module API…</p>
        )}
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h3>What ports next</h3>
        <ul className="ref-dl">
          <li>Server: <code>participation_read.js</code> + <code>/api/reporting/bootstrap</code> &amp; <code>/api/reporting/unique</code></li>
          <li>Client: <code>ParticipationMap</code>, <code>ParticipationTabs</code>, <code>Reference</code> pages (Plotly + deck.gl)</li>
          <li>Data: the same <code>usat_sales_db</code> summary/flows/events tables (read-only)</li>
        </ul>
      </div>
    </div>
  );
}
