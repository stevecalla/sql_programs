import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from './Modal.jsx';
import DataTable from './DataTable.jsx';
import { api } from '../lib/api.js';

const full_name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

// Columns for the popup's account table — reuses DataTable (client mode) so it gets copy buttons,
// sortable headers, search, and CSV/Excel export for free.
const memberColumns = [
  { key: 'account', label: 'Account', sort: true, copy: true, help: 'Salesforce account (person) record ID.' },
  { key: 'name', label: 'Name', sort: 'last_name', help: 'Account holder name (click to find in All accounts).', render: (r) => <Link className="statlink" to={`/accounts?q=${encodeURIComponent(full_name(r))}`}>{full_name(r) || '—'}</Link> },
  { key: 'gender', label: 'Gender', sort: true },
  { key: 'birthdate', label: 'Birthdate', sort: true },
  { key: 'zip5', label: 'ZIP5', sort: true },
  { key: 'member_number', label: 'Member #', sort: true },
  { key: 'merge_id', label: 'Merge ID', sort: true, copy: true, render: (r) => r.merge_id || '—' },
];

// Reusable "accounts in this group" popup. Pass a cluster key to open; null closes it.
// Used by both the Duplicates table (cluster cell) and the Merge-ID table (account cell).
export default function ClusterModal({ clusterKey, onClose }) {
  const [members, setMembers] = useState(null);   // null = loading, [] = none, [...] = accounts
  useEffect(() => {
    if (!clusterKey) return undefined;
    setMembers(null);
    let cancelled = false;
    api.cluster(clusterKey)
      .then((r) => { if (!cancelled) setMembers((r.data && r.data.accounts) || []); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [clusterKey]);

  if (!clusterKey) return null;
  return (
    <Modal title={`Accounts in this group (${clusterKey})`} onClose={onClose}>
      {members == null ? (
        <p className="muted">Loading…</p>
      ) : members.length === 0 ? (
        <p className="muted">No accounts found for this group.</p>
      ) : (
        <DataTable
          rows={members}
          columns={memberColumns}
          pageSize={100}
          searchCols="account, name, member number, merge ID"
          exportBase="/api/cluster/export"
          exportExtra={{ key: clusterKey }}
        />
      )}
    </Modal>
  );
}
