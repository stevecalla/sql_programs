import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Data as of …" line — when/where/how big the current data set is (latest finder run).
export default function DatasetStamp() {
  const [d, setD] = useState(undefined);
  useEffect(() => { api.dataset().then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  if (d === undefined) return null;
  if (!d) return <p className="muted small">Data set: no completed detection run found yet.</p>;
  const when = d.run_at ? new Date(d.run_at).toLocaleString() : '—';
  const isProd = d.environment === 'Production';
  return (
    <div className="dataset-stamp">
      {d.environment && (
        <span className={'ds-badge ' + (isProd ? 'ds-prod' : 'ds-sandbox')} title="Which Salesforce environment this data came from">
          {isProd ? '● ' : '○ '}{d.environment}
        </span>
      )}
      {d.scope && <span className="ds-badge ds-scope" title="Full = all records · Sample = capped subset">{d.scope}</span>}
      {d.total_records != null && (
        <span className="ds-badge ds-size" title="Number of accounts in the current data set">
          {Number(d.total_records).toLocaleString()} records
        </span>
      )}
      <span className="muted small">as of {when}</span>
    </div>
  );
}
