import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Last refresh" badge in the header — the latest detection run, with the weekday spelled out.
export default function HeaderRefresh() {
  const [d, setD] = useState(undefined);
  useEffect(() => { api.dataset().then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  if (!d || !d.run_at) return null;
  const when = new Date(d.run_at).toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return <span className="refresh-badge" title="Most recent detection run">Last refresh: {when}</span>;
}
