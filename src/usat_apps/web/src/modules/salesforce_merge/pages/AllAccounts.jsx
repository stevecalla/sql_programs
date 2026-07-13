import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api } from '../lib/api.js';

const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const STATES = [['', 'all'], ['has', 'has'], ['none', "doesn't have"]];

const columns = [
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
  { key: 'created_date', label: 'Created', sort: true, filter: true, help: 'When the account was created in Salesforce.', render: (r) => r.created_date || '—' },
  { key: 'created_by_name', label: 'Created By', sort: true, filter: true, help: 'The user or integration that created the account.', render: (r) => r.created_by_name || '—' },
];

export default function AllAccounts() {
  const [params] = useSearchParams();
  const q0 = params.get('q') || '';   // pre-filled search when arriving from a name link
  const [mergeState, setMergeState] = useState('');     // '' all · 'has' · 'none'
  const [memberState, setMemberState] = useState('');
  const [facets, setFacets] = useState({});
  useEffect(() => { api.accountsFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p) =>
    api.accounts({ ...p, merge_id_state: mergeState, member_number_state: memberState }).then((r) => ({ rows: r.rows, total: r.total })),
  [mergeState, memberState]);

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
        deps={[mergeState, memberState]}
        pageSize={25}
        minWidth={1400}
        exportBase="/api/salesforce-merge/accounts/export"
        exportExtra={{ merge_id_state: mergeState, member_number_state: memberState }}
        toolbar={
          <>
            {seg('Merge ID', mergeState, setMergeState)}
            {seg('Member #', memberState, setMemberState)}
          </>
        }
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        Search matches the <strong>start</strong> of a name, ID, or member number (e.g. “smi” finds “Smith”) to keep lookups fast across ~700k accounts, and matches <strong>anywhere</strong> within email and match composition. Use the column filters for per-field search; “Match” is a dropdown.
      </p>
    </>
  );
}
