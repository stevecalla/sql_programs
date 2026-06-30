import { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import ClusterModal from '../components/ClusterModal.jsx';
import { MergeIdFunnel } from '../components/Funnels.jsx';
import { api } from '../lib/api.js';

const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString());

// Chips mirror the funnel: all, in both, only a merge ID, only in duplicates.
const PILLS = [
  { value: '', label: 'all' },
  { value: 'in_both', label: 'in both' },
  { value: 'sf_only', label: 'id only' },
  { value: 'only_dupes', label: 'dup only' },
];

export default function MergeId() {
  const [bucket, setBucket] = useState('');
  const [facets, setFacets] = useState({});
  const [openKey, setOpenKey] = useState(null);   // cluster key whose popup is open
  useEffect(() => { api.mergeIdFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);

  const fetcher = useCallback((p) =>
    api.mergeId({ ...p, bucket }).then((r) => ({ rows: r.rows, total: r.total })),
  [bucket]);

  const columns = useMemo(() => [
    { key: 'name', label: 'Name', sort: 'last_name', filter: true, help: 'The account holder\'s name. Sorts by last name.', render: full_name },
    { key: 'account', label: 'Account', sort: true, filter: true, copy: true, help: 'The Salesforce account (person) record ID. Click to see the other accounts in its duplicate group (when it is in one).', render: (r) => (r.cluster ? <button type="button" className="linkbtn" title="View the accounts in this group" onClick={() => setOpenKey(r.cluster)}>{r.account}</button> : r.account) },
    { key: 'merge_id', label: 'Merge ID', sort: true, filter: true, wrap: true, copy: true, help: 'The Membership Platform merge ID — accounts sharing one are meant to be merged together.' },
    { key: 'in_dupes', label: 'In duplicates?', sort: 'cluster', filter: true, wrap: true, help: 'Whether the tool also flagged this account as a duplicate — shows the group it is in, or "not found" when it has a merge ID but it was not flagged (only a merge ID).', render: (r) => (r.bucket === 'sf_only' ? 'not found' : (r.cluster || 'yes')) },
    { key: 'size', label: 'Size', filter: true, help: 'How many accounts are in this account\'s duplicate group. Filter by a cluster size (blank = not in a group).', render: (r) => fmt(r.size) },
    { key: 'which_list', label: 'Which list', sort: true, filter: true, help: 'Which detection signal flagged it: exact, fuzzy, nickname, or multiple.' },
    { key: 'bucket', label: 'Bucket', sort: true, filter: true, help: 'Where the account falls when comparing Membership Platform merge IDs to the duplicates detected in Salesforce: in_both = has a merge ID & it was flagged; sf_only = has a merge ID, it was not flagged (only a merge ID); the *_only buckets = flagged with no merge ID (only in duplicates).' },
    { key: 'foundation', label: 'Foundation', sort: true, filter: true, help: 'Whether the account is a Foundation constituent.', render: (r) => r.foundation || '—' },
  ], []);

  return (
    <>
      <h2>Merge-ID review</h2>
      <p className="muted small">Reconcile Membership Platform merge IDs against the duplicates detected in Salesforce — read-only.</p>
      <DatasetStamp />

      <MergeIdFunnel />

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
            {PILLS.map((p) => (
              <button key={p.value || 'all'} className={'pill' + (bucket === p.value ? ' active' : '')} onClick={() => setBucket(p.value)}>
                {p.label}
              </button>
            ))}
          </span>
        }
      />
      <ClusterModal clusterKey={openKey} onClose={() => setOpenKey(null)} />
    </>
  );
}
