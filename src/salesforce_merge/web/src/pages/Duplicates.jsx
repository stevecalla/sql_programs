import { useCallback, useEffect, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api } from '../lib/api.js';

const has_merge = (s) => (s && String(s).replace(/;/g, '').trim()) ? 'yes' : '—';

const columns = [
  { key: 'cluster', label: 'Cluster', sort: true, filter: true, wrap: true, copy: true, help: 'A group of accounts our tool believes are the same person. The key identifies the group.' },
  { key: 'names', label: 'Names', sort: true, filter: true, wrap: true, help: 'The names of every account in this cluster.' },
  { key: 'size', label: 'Size', sort: true, filter: true, help: 'How many accounts are in this cluster (2 = a pair).' },
  { key: 'signal', label: 'Signal', sort: true, filter: true, help: 'Why they were grouped: exact match, fuzzy (similar) name, and/or nickname.' },
  { key: 'tier', label: 'Tier', sort: true, filter: true, help: 'Confidence level — how sure we are this is a real duplicate.' },
  { key: 'merge_ids', label: 'Merge ID?', sort: true, filter: true, wrap: true, help: 'Whether Salesforce has already tagged these accounts with a merge ID. Hover a cell for the IDs.', render: (r) => has_merge(r.merge_ids) },
  { key: 'best', label: 'Best', sort: true, help: 'Best (highest) name-similarity score among the pairs in the cluster, 0–100.' },
];

export default function Duplicates() {
  const [facets, setFacets] = useState({});
  useEffect(() => { api.duplicatesFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p) => api.duplicates(p).then((r) => ({ rows: r.rows, total: r.total })), []);
  return (
    <>
      <h2>Duplicates</h2>
      <p className="muted small">Consolidated clusters our tool found — read-only. Click a header to sort.</p>
      <DatasetStamp />
      <DataTable columns={columns} fetcher={fetcher} facets={facets} pageSize={25}
        searchCols="names, cluster, record IDs, size, tier" exportBase="/api/duplicates/export" />
    </>
  );
}
