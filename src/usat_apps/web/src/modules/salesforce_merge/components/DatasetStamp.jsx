import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Data as of …" line — when/where/how big the current data set is (latest finder run).
export default function DatasetStamp() {
  const [d, setD] = useState(undefined);
  useEffect(() => { api.dataset().then((r) => setD(r.data)).catch(() => setD(null)); }, []);
  // While loading, reserve the row's space with skeleton pills so the page doesn't jump.
  if (d === undefined) return (
    <div className="dataset-stamp" aria-hidden="true">
      <span className="skel ds-badge" style={{ width: 92 }}>&nbsp;</span>
      <span className="skel ds-badge" style={{ width: 60 }}>&nbsp;</span>
      <span className="skel ds-badge" style={{ width: 110 }}>&nbsp;</span>
    </div>
  );
  if (!d) return <p className="muted small">Data set: no completed detection run found yet.</p>;
  const when = d.run_at ? new Date(d.run_at).toLocaleString() : '—';
  const isProd = d.environment === 'Production';
  return (
    <div className="dataset-stamp fade-in">
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
