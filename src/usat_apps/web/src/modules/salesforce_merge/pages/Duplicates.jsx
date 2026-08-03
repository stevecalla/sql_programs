import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import DatasetStamp from '../components/DatasetStamp.jsx';
import ClusterModal from '../components/ClusterModal.jsx';
import { AccountsFunnel } from '../components/Funnels.jsx';
import { api } from '../lib/api.js';

const fmt_merge_ids = (s) => { const ids = String(s || '').split(';').map((x) => x.trim()).filter(Boolean); return ids.length ? ids.join(', ') : '—'; };
const STATES = [['', 'all'], ['has', 'has'], ['none', "doesn't have"]];

// Names_In_Group__c is a ';'-separated list. Render each name as a link into All accounts,
// pre-searched by that name, so a reviewer can jump to the account-level records.
const namesLinks = (names) => {
  const parts = String(names || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map((n, i) => (
    <span key={i}>
      {i > 0 ? '; ' : ''}
      <Link className="statlink" to={`/salesforce/merge/accounts?q=${encodeURIComponent(n)}`}>{n}</Link>
    </span>
  ));
};

export default function Duplicates() {
  // Seed the signal filter from ?f_signal=… (the Dashboard's "by signal" rows link here filtered).
  const initialColFilters = useMemo(() => {
    try { const s = new URLSearchParams(window.location.search).get('f_signal'); return s ? { signal: s } : {}; } catch (e) { return {}; }
  }, []);
  const [facets, setFacets] = useState({});
  const [mergeState, setMergeState] = useState('');     // '' all · 'has' · 'none' (any merge ID in cluster?)
  const [memberState, setMemberState] = useState('');   // '' all · 'has' · 'none' (any member # in cluster?)
  const [foundationState, setFoundationState] = useState(''); // '' all · 'has' · 'none' (any Foundation constituent?)
  const [portalState, setPortalState] = useState(''); // '' all · 'has' · 'none' (any Customer-Portal account?)
  const [openKey, setOpenKey] = useState(null);         // cluster key whose popup is open
  useEffect(() => { api.duplicatesFacets().then((r) => setFacets(r.facets || {})).catch(() => {}); }, []);
  const fetcher = useCallback((p) =>
    api.duplicates({ ...p, merge_id_state: mergeState, member_number_state: memberState, foundation_state: foundationState, portal_state: portalState }).then((r) => ({ rows: r.rows, total: r.total })),
  [mergeState, memberState, foundationState, portalState]);

  const columns = useMemo(() => [
    { key: 'names', label: 'Names', sort: true, filter: true, wrap: true, help: 'The names of every account in this cluster. Click a name to see its account-level records.', render: (r) => namesLinks(r.names) },
    { key: 'cluster', label: 'Cluster', sort: true, filter: true, wrap: true, help: 'A group of accounts believed to be the same person. Click to see each account.', render: (r) => (<button type="button" className="linkbtn" title="View the accounts in this group" onClick={() => setOpenKey(r.cluster)}>{r.cluster}</button>) },
    { key: 'size', label: 'Size', sort: true, filter: true, help: 'How many accounts are in this cluster (2 = a pair).' },
    { key: 'signal', label: 'Signal', sort: true, filter: true, help: 'Why they were grouped: exact match, fuzzy (similar) name, and/or nickname.' },
    { key: 'tier', label: 'Tier', sort: true, filter: true, help: 'Confidence level — how strongly the match indicates a true duplicate.' },
    { key: 'merge_ids', label: 'Merge IDs', sort: true, filter: true, wrap: true, copy: true, help: 'The Membership Platform merge IDs tagged on the accounts in this cluster (comma-separated), or — if none.', render: (r) => fmt_merge_ids(r.merge_ids) },
    { key: 'best', label: 'Best', sort: true, help: 'Best (highest) name-similarity score among the pairs in the cluster, 0–100.' },
    { key: 'portal', label: 'Portal', wrap: true, help: 'Does any account in the cluster have IsCustomerPortal set? Shows the count of portal accounts. Use the "Customer portal" filter above.', render: (r) => (String(r.portal) === '1' ? ('Yes' + (Number(r.portal_count) > 0 ? ' (' + r.portal_count + ')' : '')) : 'No') },
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
        initialColFilters={initialColFilters}
        deps={[mergeState, memberState, foundationState, portalState]}
        pageSize={25}
        searchCols="names, cluster, record IDs, size, tier"
        exportBase="/api/salesforce-merge/duplicates/export"
        exportExtra={{ merge_id_state: mergeState, member_number_state: memberState, foundation_state: foundationState, portal_state: portalState }}
        toolbar={
          <>
            {seg('Merge ID', mergeState, setMergeState)}
            {seg('Member #', memberState, setMemberState)}
            {seg('Foundation', foundationState, setFoundationState)}
            {seg('Customer portal', portalState, setPortalState)}
          </>
        }
      />
      <ClusterModal clusterKey={openKey} onClose={() => setOpenKey(null)} />
    </>
  );
}
