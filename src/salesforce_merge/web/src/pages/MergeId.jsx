import { useCallback, useEffect, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import StatCard from '../components/StatCard.jsx';
import { api } from '../lib/api.js';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

const columns = [
  { key: 'account', label: 'Account', sort: true, filter: true, copy: true, help: 'The Salesforce account (person) record ID.' },
  { key: 'name', label: 'Name', sort: 'last_name', filter: true, help: 'The account holder\'s name. Sorts by last name.', render: full_name },
  { key: 'merge_id', label: 'Merge ID', sort: true, filter: true, wrap: true, copy: true, help: 'The merge ID Salesforce assigned — accounts sharing one are meant to merge together.' },
  { key: 'in_dupes', label: 'In our duplicates?', sort: 'cluster', filter: true, wrap: true, help: 'Whether our tool also found this account as a duplicate (shows its cluster), or not (sf_only).', render: (r) => (r.bucket === 'sf_only' ? '✗ not found' : `✓ ${r.cluster || ''}`) },
  { key: 'which_list', label: 'Which list', sort: true, filter: true, help: 'Which detection list flagged it: exact, fuzzy, nickname, or multiple.' },
  { key: 'bucket', label: 'Bucket', sort: true, filter: true, help: 'Reconciliation result: in_both (SF + us), sf_only (SF only), or named by signal.' },
];

const PILLS = ['', 'in_both', 'sf_only', 'multi_signal'];

export default function MergeId() {
  const [summary, setSummary] = useState(null);
  const [bucket, setBucket] = useState('');
  const [facets, setFacets] = useState({});
  useEffect(() => { api.mergeIdFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);

  const fetcher = useCallback((p) =>
    api.mergeId({ ...p, bucket }).then((r) => { if (r.summary) setSummary(r.summary); return { rows: r.rows, total: r.total }; }),
  [bucket]);

  return (
    <>
      <h2>Merge-ID review</h2>
      <p className="muted small">Reconcile Salesforce merge IDs against the duplicates we found — read-only.</p>
      <DatasetStamp />

      {summary && (
        <>
          <div className="grid">
            {summary.buckets.map((b) => (<StatCard key={b.bucket} label={b.bucket} value={fmt(b.count)} />))}
          </div>
          <p className="muted small">
            Duplicate pairs — exact {fmt(summary.pairs.exact)} · fuzzy {fmt(summary.pairs.fuzzy)} ·
            nickname {fmt(summary.pairs.nickname)} · total {fmt(summary.pairs.total)} ({fmt(summary.pairs.clusters)} clusters)
          </p>
        </>
      )}

      <DataTable
        columns={columns}
        fetcher={fetcher}
        facets={facets}
        deps={[bucket]}
        pageSize={25}
        searchCols="account, name, merge ID, list"
        exportBase="/api/merge-id/export"
        exportExtra={{ bucket }}
        toolbar={
          <span className="pills">
            {PILLS.map((b) => (
              <button key={b || 'all'} className={'pill' + (bucket === b ? ' active' : '')} onClick={() => setBucket(b)}>
                {b || 'all'}
              </button>
            ))}
          </span>
        }
      />
    </>
  );
}
