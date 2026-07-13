import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// WorkerBanner — the web tier only ENQUEUES merges; the isolated write worker (:8021) drains the queue.
// If the worker is down, a merge is accepted but sits 'queued' and never runs — a silent hang. This polls
// the worker-liveness endpoint and shows a persistent banner while it's offline. Fail-safe: it starts in
// 'unknown' and only renders once a check definitively returns offline, so there's no flash on first load.
//
// Polling is deliberately light: every 30s, and it SKIPS the request while the tab is hidden (backgrounded)
// — then re-checks immediately when the tab is refocused, so the banner is fresh the moment you return.
const POLL_MS = 30000;

export default function WorkerBanner() {
  const [state, setState] = useState('unknown'); // 'unknown' | 'online' | 'offline'

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // don't poll a backgrounded tab
      try {
        const r = await api.workerHealth();
        if (alive) setState(r && r.online ? 'online' : 'offline');
      } catch (e) {
        if (alive) setState('offline');
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

  if (state !== 'offline') return null;

  return (
    <div className="sfmerge-worker-banner" role="alert">
      <span className="sfmerge-worker-banner__dot" aria-hidden="true" />
      <span className="sfmerge-worker-banner__text">
        <strong>No merge worker online.</strong> New merges will be <em>queued</em> but won’t run until the
        worker (port 8021) is started — start it with <code>npm run pm2_start_salesforce_merge_worker</code>.
      </span>
    </div>
  );
}
