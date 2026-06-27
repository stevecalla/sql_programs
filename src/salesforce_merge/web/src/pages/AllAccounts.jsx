import { useCallback, useEffect, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api } from '../lib/api.js';

const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

const columns = [
  { key: 'account', label: 'Account', sort: true, filter: true, copy: true, help: 'The Salesforce account (person) record ID.' },
  { key: 'name', label: 'Name', sort: 'last_name', filter: true, help: 'The account holder\'s name. Sorts by last name.', render: full_name },
  { key: 'gender', label: 'Gender', sort: true, filter: true, help: 'Gender identity — one of the three fields required for duplicate matching.' },
  { key: 'birthdate', label: 'Birthdate', sort: true, filter: true, help: 'Date of birth — required for duplicate matching.' },
  { key: 'zip5', label: 'ZIP5', sort: true, filter: true, help: 'First five digits of the ZIP — required for duplicate matching.' },
  { key: 'member_number', label: 'Member #', sort: true, filter: true, help: 'The membership number on the account, if any.' },
  { key: 'merge_id', label: 'Merge ID', sort: true, filter: true, copy: true, help: 'The Salesforce merge ID, if one has been assigned.', render: (r) => r.merge_id || '—' },
];

export default function AllAccounts() {
  const [hasMerge, setHasMerge] = useState('');
  const [facets, setFacets] = useState({});
  useEffect(() => { api.accountsFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p) =>
    api.accounts({ ...p, has_merge_id: hasMerge }).then((r) => ({ rows: r.rows, total: r.total })),
  [hasMerge]);

  return (
    <>
      <h2>All accounts</h2>
      <p className="muted small">Browse the snapshot — server-paged, read-only. Click a row's account to inspect later.</p>
      <DatasetStamp />
      <DataTable
        columns={columns}
        fetcher={fetcher}
        facets={facets}
        deps={[hasMerge]}
        pageSize={25}
        exportBase="/api/accounts/export"
        exportExtra={{ has_merge_id: hasMerge }}
        toolbar={
          <span className="pills">
            <button className={'pill' + (hasMerge === '' ? ' active' : '')} onClick={() => setHasMerge('')}>all</button>
            <button className={'pill' + (hasMerge === '1' ? ' active' : '')} onClick={() => setHasMerge('1')}>has merge ID</button>
          </span>
        }
      />
    </>
  );
}
