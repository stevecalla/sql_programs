import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared funnels used by the Dashboard AND linked at the top of the Duplicates / Merge-ID pages,
// so all three render the exact same thing from one source. Pass `d` (dashboard data) to reuse a
// fetch the parent already did; omit it and the funnel fetches /api/salesforce-merge/dashboard itself.

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

// One funnel step. `tone` tints the card (accent / green / amber); `to` makes the label a link.
export function Step({ k, v, sub, sep = '→', tone, to }) {
  const label = to ? <Link className="statlink" to={to}>{k}</Link> : k;
  return (
    <>
      {sep ? <span className="funnel-arrow">{sep}</span> : null}
      <div className={'funnel-card' + (tone ? ' ' + tone : '')}>
        <div className="funnel-k">{label}</div>
        <div className="funnel-v">{v}</div>
        {sub ? <div className="funnel-sub">{sub}</div> : null}
      </div>
    </>
  );
}

// Placeholder funnel (reserves space + shimmer) shown while the dashboard data loads — including a
// line for the reconciliation note below the cards, so that text doesn't pop in either.
export function FunnelSkeleton() {
  return (
    <>
      <div className="funnel" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="funnel-card">
            <span className="skel" style={{ display: 'block', height: 11, width: '60%' }} />
            <span className="skel" style={{ display: 'block', height: 20, width: '45%', marginTop: 6 }} />
            <span className="skel" style={{ display: 'block', height: 10, width: '75%', marginTop: 6 }} />
          </div>
        ))}
      </div>
      <p className="funnel-note" aria-hidden="true"><span className="skel" style={{ height: 10, width: '80%' }} /></p>
    </>
  );
}

// Use the passed dashboard data, else fetch it once.
function useDashboard(passed) {
  const [d, setD] = useState(passed || null);
  useEffect(() => {
    if (passed) { setD(passed); return; }
    api.dashboard().then((r) => setD(r.data)).catch(() => {});
  }, [passed]);
  return d;
}

// All accounts -> duplicate accounts -> pairs -> clusters.
export function AccountsFunnel({ d: passed }) {
  const d = useDashboard(passed);
  if (!d) return <FunnelSkeleton />;
  const avg = (d.accounts_in_clusters && d.clusters) ? (d.accounts_in_clusters / d.clusters).toFixed(1) : null;
  return (
    <>
      <div className="funnel fade-in">
        <Step k="All accounts" v={fmt(d.total_accounts)} sub="every person record" sep="" to="/salesforce/merge/accounts" />
        <Step k="Duplicate accounts" v={fmt(d.accounts_in_clusters)} sub="records in a cluster" tone="accent" to="/salesforce/merge/duplicates" />
        <Step k="Duplicate pairs" v={fmt(d.duplicate_pairs)} sub="matches between two" to="/salesforce/merge/duplicates" />
        <Step k="Duplicate clusters" v={fmt(d.clusters)} sub="one unique duplicate" to="/salesforce/merge/duplicates" />
      </div>
      <p className="funnel-note">
        {fmt(d.accounts_in_clusters)} duplicate records collapse into {fmt(d.clusters)} unique duplicates
        {avg ? ` — about ${avg} records each.` : '.'}
      </p>
    </>
  );
}

// Accounts that carry a Membership Platform merge ID, compared against the duplicates detected in
// Salesforce data: in both / only a merge ID / detected with no merge ID.
export function MergeIdFunnel({ d: passed }) {
  const d = useDashboard(passed);
  if (!d) return <FunnelSkeleton />;
  const reviewed = (d.buckets || []).reduce((s, b) => s + b.count, 0);
  if (!reviewed) return <p className="muted">No merge-ID review yet — run the duplicates finder first.</p>;
  const bucketCount = (name) => (d.buckets.find((b) => b.bucket === name)?.count || 0);
  const inBoth = bucketCount('in_both');
  const sfOnly = bucketCount('sf_only');
  const onlyOurs = reviewed - inBoth - sfOnly;
  return (
    <>
      <div className="funnel fade-in">
        <Step k="Accounts compared" v={fmt(reviewed)} sub="Platform merge IDs vs. Salesforce duplicates" sep="" tone="accent" to="/salesforce/merge/merge-id" />
        <Step k="In both" v={fmt(inBoth)} sub="has a merge ID & flagged as a duplicate" sep="→" tone="green" to="/salesforce/merge/merge-id" />
        <Step k="Only in merge IDs" v={fmt(sfOnly)} sub="has a merge ID, not flagged as a duplicate" sep="+" tone="amber" to="/salesforce/merge/merge-id" />
        <Step k="Only in duplicates" v={fmt(onlyOurs)} sub="flagged as a duplicate, no merge ID" sep="+" to="/salesforce/merge/merge-id" />
      </div>
      <p className="funnel-note">
        {fmt(inBoth)} + {fmt(sfOnly)} + {fmt(onlyOurs)} = {fmt(reviewed)} — comparing Membership Platform
        merge IDs against the duplicates detected in Salesforce: in both, only a merge ID (so not flagged as
        a duplicate), or detected with no merge ID.
      </p>
    </>
  );
}
