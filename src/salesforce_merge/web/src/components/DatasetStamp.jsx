import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Data as of …" line — when/where/how big the current data set is (latest finder run).
export default function DatasetStamp() {
  const [d, setD] = useState(undefined);
  useEffect(() => { api.dataset().then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  if (d === undefined) return null;
  if (!d) return <p className="muted small">Data set: no completed detection run found yet.</p>;
  const when = d.run_at ? new Date(d.run_at).toLocaleString() : '—';
  const recs = d.total_records != null ? ` · ${Number(d.total_records).toLocaleString()} records` : '';
  return (
    <p className="muted small">
      Data as of {when}{d.environment ? ` · ${d.environment}` : ''}{d.scope ? ` · ${d.scope}` : ''}{recs}
    </p>
  );
}
