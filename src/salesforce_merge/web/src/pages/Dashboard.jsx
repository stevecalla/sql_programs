import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatCard from '../components/StatCard.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then((r) => setD(r.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="err">{err}</p>;
  if (!d) return <p className="muted">Loading…</p>;

  return (
    <>
      <h2>Overview</h2>
      <DatasetStamp />
      <div className="grid">
        <StatCard label="Total accounts" value={fmt(d.total_accounts)} />
        <StatCard label="Accounts with merge IDs" value={fmt(d.merge_id_accounts)} />
        <StatCard label="Duplicate clusters" value={fmt(d.clusters)} />
        <StatCard label="Duplicate pairs" value={fmt(d.duplicate_pairs)} />
      </div>

      <h3>Merge-ID buckets</h3>
      {d.buckets.length === 0 ? (
        <p className="muted">No merge-ID review yet — run the duplicates finder first.</p>
      ) : (
        <div className="grid">
          {d.buckets.map((b) => (<StatCard key={b.bucket} label={b.bucket} value={fmt(b.count)} />))}
        </div>
      )}

      <p className="muted small">Read-only · source: salesforce_duplicate_* tables · no Salesforce writes in Phase 0.</p>
    </>
  );
}
