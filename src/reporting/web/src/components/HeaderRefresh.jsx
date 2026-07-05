import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Last refresh" badge in the header — the participation data's source-table timestamp, plus whether
// it's coming from live MySQL or the seed fixture. Mirrors the merge app's HeaderRefresh.
export default function HeaderRefresh() {
  const [d, setD] = useState(undefined);
  useEffect(() => { api.dataset().then((r) => setD(r.status === 200 ? r.body : null)).catch(() => setD(null)); }, []);
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
