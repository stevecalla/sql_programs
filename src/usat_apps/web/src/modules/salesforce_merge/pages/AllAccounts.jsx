import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import ClusterModal from '../components/ClusterModal.jsx';
import { api } from '../lib/api.js';

const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const STATES = [['', 'all'], ['has', 'has'], ['none', "doesn't have"]];

const BASE_COLUMNS = [
  { key: 'account', label: 'Account', sort: true, filter: true, copy: true, help: 'The Salesforce account (person) record ID.' },
  { key: 'name', label: 'Name', sort: 'last_name', filter: true, help: 'The account holder\'s name. Sorts by last name.', render: full_name },
  { key: 'gender', label: 'Gender', sort: true, filter: true, help: 'Gender identity — one of the three fields required for duplicate matching.' },
  { key: 'birthdate', label: 'Birthdate', sort: true, filter: true, help: 'Date of birth — required for duplicate matching.' },
  { key: 'zip5', label: 'ZIP5', sort: true, filter: true, help: 'First five digits of the ZIP — required for duplicate matching.' },
  { key: 'member_number', label: 'Member #', sort: true, filter: true, help: 'The membership number on the account, if any.' },
  { key: 'merge_id', label: 'Merge ID', sort: true, filter: true, copy: true, help: 'The Membership Platform merge ID, if one has been assigned.', render: (r) => r.merge_id || '—' },
  { key: 'match_composition', label: 'Match', sort: true, filter: true, help: 'How this account matched in the consolidated view (exact / fuzzy / nickname mix). Filter by value.', render: (r) => r.match_composition || '—' },
  { key: 'email', label: 'Email', sort: true, filter: true, copy: true, help: 'The account email (PersonEmail). Search matches anywhere in the address.', render: (r) => r.email || '—' },
  { key: 'foundation_constituent', label: 'Foundation', sort: true, filter: true, help: 'Whether the account is a Foundation constituent. Filter by value.', render: (r) => r.foundation_constituent || '—' },
  { key: 'first_name', label: 'First name', sort: true, filter: true, help: 'The account holder\'s first name. Search matches the start of the name.', render: (r) => r.first_name || '—' },
  { key: 'last_name', label: 'Last name', sort: true, filter: true, help: 'The account holder\'s last name. Search matches the start of the name.', render: (r) => r.last_name || '—' },
  { key: 'match_score', label: 'Match score', sort: true, filter: true, help: 'Best fuzzy name-match score (0–100) for this account\'s duplicate cluster; exact matches show 100. Blank if not in a cluster.', render: (r) => (r.match_score == null || r.match_score === '' ? '—' : r.match_score) },
  { key: 'created_date', label: 'Created', sort: true, filter: true, help: 'When the account was created in Salesforce.', render: (r) => r.created_date || '—' },
  { key: 'created_by_name', label: 'Created By', sort: true, filter: true, help: 'The user or integration that created the account.', render: (r) => r.created_by_name || '—' },
];

export default function AllAccounts() {
  const [params] = useSearchParams();
  const q0 = params.get('q') || '';   // pre-filled search when arriving from a name link
  const [mergeState, setMergeState] = useState('');     // '' all · 'has' · 'none'
  const [memberState, setMemberState] = useState('');
  const [clusterState, setClusterState] = useState('');   // '' all · 'has' (in a cluster) · 'none'
  const [openKey, setOpenKey] = useState(null);           // cluster key whose popup is open
  const [facets, setFacets] = useState({});
  useEffect(() => { api.accountsFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p, opts) =>
    api.accounts({ ...p, merge_id_state: mergeState, member_number_state: memberState, in_cluster_state: clusterState }, opts).then((r) => ({ rows: r.rows, total: r.total })),
  [mergeState, memberState, clusterState]);

  // Insert the clickable "Matches" column right after Match score; it opens the shared cluster popup.
  const columns = useMemo(() => {
    const matches = { key: 'cluster_size', label: 'Matches', sort: true, filter: true,
      help: 'How many accounts are in this account\'s duplicate cluster (including itself). Click to see who it matches. Filter by an exact cluster size (e.g. 3).',
      render: (r) => (r.cluster_size && Number(r.cluster_size) > 1 && r.cluster_key
        ? <button type="button" className="linkbtn" title="View the accounts this one matches" onClick={() => setOpenKey(r.cluster_key)}>{r.cluster_size} matches</button>
        : '—') };
    const out = [...BASE_COLUMNS];
    const i = out.findIndex((c) => c.key === 'zip5');
    out.splice(i >= 0 ? i + 1 : out.length, 0, matches);
    return out;
  }, []);

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
      <h2>All accounts</h2>
      <p className="muted small">Browse the snapshot — server-paged, read-only. Click a row's account to inspect later.</p>
      <DatasetStamp />
      <DataTable
        key={q0}
        initialQuery={q0}
        columns={columns}
        fetcher={fetcher}
        facets={facets}
        deps={[mergeState, memberState, clusterState]}
        pageSize={25}
        minWidth={1750}
        exportBase="/api/salesforce-merge/accounts/export"
        exportExtra={{ merge_id_state: mergeState, member_number_state: memberState, in_cluster_state: clusterState }}
        toolbar={
          <>
            {seg('Merge ID', mergeState, setMergeState)}
            {seg('Member #', memberState, setMemberState)}
            {seg('In a cluster', clusterState, setClusterState)}
          </>
        }
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        Global search matches the <strong>start</strong> of a first name, last name, ID, or member number (e.g. “smi” finds “Smith”) — indexed for fast lookups across ~700k accounts. For email, match composition, or match score, use the per-column filters (Match score is an exact number like 95; “Match” is a dropdown).
      </p>
      <ClusterModal clusterKey={openKey} onClose={() => setOpenKey(null)} />
    </>
  );
}
