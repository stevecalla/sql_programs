import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// WorkerBanner — the web tier only ENQUEUES merges/restores/recreates; the isolated write worker (:8021)
// drains the queue AND owns the real execute gate. Two things can silently surprise you:
//   1. Worker DOWN — a job is accepted but sits 'queued' and never runs.
//   2. Worker UP but running in SIMULATE mode — MERGE_ENABLE_EXECUTION isn't set (or wasn't picked up) on
//      the WORKER process, so even though the web let you click Execute, the run is recorded as a simulation.
// This polls the worker-liveness endpoint (which proxies the worker's own /api/status, including its live
// execution_enabled flag) and shows a banner for down / simulate-only, and a slim confirmation when the
// worker is armed for real writes. Applies to merge, restore, AND recreate — all run in this worker.
//
// Fail-safe: starts 'unknown' (no flash), polls every 30s, and skips while the tab is hidden.
const POLL_MS = 30000;

export default function WorkerBanner() {
  const [health, setHealth] = useState(null); // null=unknown | { online, exec }

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // don't poll a backgrounded tab
      try {
        const r = await api.workerHealth();
        if (alive) setHealth({ online: !!(r && r.online), exec: !!(r && r.detail && r.detail.execution_enabled) });
      } catch (e) {
        if (alive) setHealth({ online: false, exec: false });
      }
    };
    check();
    const id = setInterval(check, POLL_MS);
    const onVisible = () => { if (!document.hidden) check(); }; // refresh right away on refocus
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!health) return null; // unknown — no flash on first load

  // 1. Worker down.
  if (!health.online) {
    return (
      <div className="sfmerge-worker-banner" role="alert">
        <span className="sfmerge-worker-banner__dot" aria-hidden="true" />
        <span className="sfmerge-worker-banner__text">
          <strong>No merge worker online.</strong> New merges/restores will be <em>queued</em> but won’t run
          until the worker (port 8021) is started — <code>npm run pm2_start_salesforce_merge_worker</code>.
        </span>
      </div>
    );
  }

  // 2. Worker up but writes disabled → everything simulates regardless of the Execute button.
  if (!health.exec) {
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', margin: '8px 0',
        border: '1px solid var(--amber, #b7791f)', background: 'var(--amber-bg, #fff7e6)', color: 'var(--amber, #8a5a00)', borderRadius: 8, fontSize: 13 }}>
        <span aria-hidden="true">▲</span>
        <span>
          <strong>Merge worker is online but in SIMULATE mode.</strong> Writes are disabled on the worker
          process (<code>MERGE_ENABLE_EXECUTION</code> not set on port 8021), so <em>Execute, Restore, and
          Recreate will record a simulation</em> even though the button is available. Set the flag in the
          worker’s <code>.env</code> and <strong>restart the worker</strong> to enable real writes.
        </span>
      </div>
    );
  }

  // 3. Worker up and armed for real writes — slim confirmation so the arming is observable.
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', margin: '8px 0',
      border: '1px solid var(--red, #c0392b)', background: 'var(--red-bg, #fdecea)', color: 'var(--red, #a02a1c)', borderRadius: 8, fontSize: 12.5 }}>
      <span aria-hidden="true">●</span>
      <span><strong>Merge worker armed for LIVE writes.</strong> Execute / Restore / Recreate will perform real Salesforce changes.</span>
    </div>
  );
}
