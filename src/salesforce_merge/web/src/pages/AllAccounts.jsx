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
        exportBase="/api/accounts/export"
        exportExtra={{ merge_id_state: mergeState, member_number_state: memberState }}
        toolbar={
          <>
            {seg('Merge ID', mergeState, setMergeState)}
            {seg('Member #', memberState, setMemberState)}
          </>
        }
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        Search matches the <strong>start</strong> of a name, ID, or member number (e.g. “smi” finds “Smith”) — this keeps lookups fast across all ~700k accounts.
      </p>
    </>
  );
}
