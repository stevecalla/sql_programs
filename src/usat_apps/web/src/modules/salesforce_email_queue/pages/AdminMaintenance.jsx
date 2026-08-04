import { useState } from 'react';
import { api } from '../lib/api.js';

// Email Queue admin → Maintenance. Ported 1:1 from the standalone /admin Maintenance pane: a single
// destructive-ish action that purges deliberate $0 test rows while keeping any cost-bearing test run so
// spend/bill reconciliation survives. Admin-only (the route is require_admin server-side).

export default function AdminMaintenance() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const purge = async () => {
    if (!window.confirm('Delete $0 test rows (is_test=1)? Cost-bearing test runs are KEPT; real data is untouched.')) return;
    setBusy(true);
    setMsg({ ok: true, text: 'Purging…' });
    try {
      const r = await api.metricsPurgeTest();
      setMsg({ ok: true, text: `Deleted ${r.deleted} $0 test row(s); kept ${r.kept_cost_rows} cost-bearing ($${Number(r.kept_cost_usd || 0).toFixed(4)}).` });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>Email Queue · Maintenance</h2>

      <div className="card">
        <h3>Data maintenance</h3>
        <p className="muted small">Deletes deliberate test rows (sessions opened with <code>?metrics_test=1</code>) that cost $0. Keeps any test AI call that actually spent money, so your spend record / bill reconciliation survives. Real data is untouched.</p>
        <div style={{ marginTop: 8 }}>
          <button className="btn warn" onClick={purge} disabled={busy}>🗑 Purge $0 test rows (is_test=1)</button>
        </div>
        {msg && msg.text && (
          <span id="maintMsg" className="small" style={{ display: 'block', marginTop: 8, color: msg.ok ? '#16a34a' : '#d32f2f' }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
