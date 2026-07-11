import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// "Last refresh" badge for the participation page — the data's source-table timestamp + a live/
// fixture dot. Ported from src/reporting HeaderRefresh: reads /api/participation-maps/dataset and
// re-reads when the map's Refresh button dispatches the 'reporting:refreshed' event.
export default function HeaderRefresh() {
  const [d, setD] = useState(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => api.dataset().then((r) => { if (alive) setD(r.status === 200 ? r.body : null); }).catch(() => { if (alive) setD(null); });
    load();
    const onRefreshed = () => load();
    window.addEventListener('reporting:refreshed', onRefreshed);
    return () => { alive = false; window.removeEventListener('reporting:refreshed', onRefreshed); };
  }, []);
  if (!d || !d.ok) return null;
  const when = d.last_updated || (d.generated_at ? new Date(d.generated_at).toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : null);
  const live = d.source === 'mysql';
  const tip = (live ? 'Live from local MySQL' : 'Seed fixture — MySQL not wired yet')
    + (d.last_updated_utc ? ' · source built ' + d.last_updated_utc + ' UTC' : '');
  return (
    <span className="refresh-badge" title={tip}>
      <span className={'dot ' + (live ? 'ok' : 'warn')} aria-hidden="true" />
      Last refresh: {when || '—'}{live ? '' : ' (fixture)'}
    </span>
  );
}
