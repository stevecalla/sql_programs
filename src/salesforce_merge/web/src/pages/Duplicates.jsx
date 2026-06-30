import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import ClusterModal from '../components/ClusterModal.jsx';
import { AccountsFunnel } from '../components/Funnels.jsx';
import { api } from '../lib/api.js';

const has_merge = (s) => (s && String(s).replace(/;/g, '').trim()) ? 'yes' : '—';
const STATES = [['', 'all'], ['has', 'has'], ['none', "doesn't have"]];

// Names_In_Group__c is a ';'-separated list. Render each name as a link into All accounts,
// pre-searched by that name, so a reviewer can jump to the account-level records.
const namesLinks = (names) => {
  const parts = String(names || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map((n, i) => (
    <span key={i}>
      {i > 0 ? '; ' : ''}
      <Link className="statlink" to={`/accounts?q=${encodeURIComponent(n)}`}>{n}</Link>
    </span>
  ));
};

export default function Duplicates() {
  const [facets, setFacets] = useState({});
  const [mergeState, setMergeState] = useState('');     // '' all · 'has' · 'none' (any merge ID in cluster?)
  const [memberState, setMemberState] = useState('');   // '' all · 'has' · 'none' (any member # in cluster?)
  const [foundationState, setFoundationState] = useState(''); // '' all · 'has' · 'none' (any Foundation constituent?)
  const [openKey, setOpenKey] = useState(null);         // cluster key whose popup is open
  useEffect(() => { api.duplicatesFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p) =>
    api.duplicates({ ...p, merge_id_state: mergeState, member_number_state: memberState, foundation_state: foundationState }).then((r) => ({ rows: r.rows, total: r.total })),
  [mergeState, memberState, foundationState]);

  const columns = useMemo(() => [
    { key: 'names', label: 'Names', sort: true, filter: true, wrap: true, help: 'The names of every account in this cluster. Click a name to see its account-level records.', render: (r) => namesLinks(r.names) },
    { key: 'cluster', label: 'Cluster', sort: true, filter: true, wrap: true, help: 'A group of accounts believed to be the same person. Click to see each account.', render: (r) => (<button type="button" className="linkbtn" title="View the accounts in this group" onClick={() => setOpenKey(r.cluster)}>{r.cluster}</button>) },
    { key: 'size', label: 'Size', sort: true, filter: true, help: 'How many accounts are in this cluster (2 = a pair).' },
    { key: 'signal', label: 'Signal', sort: true, filter: true, help: 'Why they were grouped: exact match, fuzzy (similar) name, and/or nickname.' },
    { key: 'tier', label: 'Tier', sort: true, filter: true, help: 'Confidence level — how strongly the match indicates a true duplicate.' },
    { key: 'merge_ids', label: 'Merge ID?', sort: true, filter: true, wrap: true, help: 'Whether the Membership Platform has tagged these accounts with a merge ID. Hover a cell for the IDs.', render: (r) => has_merge(r.merge_ids) },
    { key: 'best', label: 'Best', sort: true, help: 'Best (highest) name-similarity score among the pairs in the cluster, 0–100.' },
  ], []);

  const seg = (label, state, set) => (
    <label className="tb-select">
      {label}
      <select value={state} onChange={(e) => set(e.target.value)}>
        {STATES.map(([v, t]) => (<option key={v || 'all'} value={v}>{t}</option>))}
      </select>
    </label>
  );

  return (
    <>
      <h2>Duplicates</h2>
      <p className="muted small">Consolidated clusters detected — read-only. Click a header to sort.</p>
      <DatasetStamp />
      <AccountsFunnel />
      <DataTable
        columns={columns}
        fetcher={fetcher}
        facets={facets}
        deps={[mergeState, memberState, foundationState]}
        pageSize={25}
        searchCols="names, cluster, record IDs, size, tier"
        exportBase="/api/duplicates/export"
        exportExtra={{ merge_id_state: mergeState, member_number_state: memberState, foundation_state: foundationState }}
        toolbar={
          <>
            {seg('Merge ID', mergeState, setMergeState)}
            {seg('Member #', memberState, setMemberState)}
            {seg('Foundation', foundationState, setFoundationState)}
          </>
        }
      />
      <ClusterModal clusterKey={openKey} onClose={() => setOpenKey(null)} />
    </>
  );
}
