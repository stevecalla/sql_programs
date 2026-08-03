import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { AccountsFunnel, MergeIdFunnel, FunnelSkeleton } from '../components/Funnels.jsx';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    api.dashboard().then((r) => setD(r.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="err">{err}</p>;
  if (!d) return (
    <>
      <h2>Overview</h2>
      <DatasetStamp />
      <h3>From all accounts to unique duplicates</h3>
      <FunnelSkeleton />
      <h3>By match signal</h3>
      <div className="skel" style={{ display: 'block', height: 170, width: '100%', borderRadius: 14, margin: '6px 0 16px' }} />
      <h3>Merge-ID review</h3>
      <FunnelSkeleton />
    </>
  );

  const sb = d.signal_breakdown || { accounts: {}, pairs: {}, clusters: {}, has_merge_id: {}, no_merge_id: {} };
  const sigRows = [
    { key: 'exact', label: 'Exact' },
    { key: 'fuzzy', label: 'Fuzzy' },
    { key: 'nickname', label: 'Nickname' },
    { key: 'multi', label: 'Multi-signal' },
  ].map((row) => ({
    ...row,
    accounts: sb.accounts[row.key] ?? null,
    has_merge_id: (sb.has_merge_id || {})[row.key] ?? null,
    no_merge_id: (sb.no_merge_id || {})[row.key] ?? null,
    pairs: row.key === 'multi' ? null : (sb.pairs[row.key] ?? null),
    clusters: sb.clusters[row.key] ?? null,
  }));
  const totHasMerge = sigRows.reduce((a, r) => a + (r.has_merge_id || 0), 0);
  const totNoMerge = sigRows.reduce((a, r) => a + (r.no_merge_id || 0), 0);
  const bucketCount = (k) => { const b = (d.buckets || []).find((x) => x.bucket === k); return b ? b.count : null; };

  return (
    <>
      <h2>Overview</h2>
      <DatasetStamp />

      {/* FUNNEL: all accounts -> unique duplicates (shared with the Duplicates page) */}
      <h3>From all accounts to unique duplicates</h3>
      <AccountsFunnel d={d} />

      {/* BY MATCH SIGNAL */}
      <h3>By match signal</h3>
      <table className="sigtable">
        <thead>
          <tr>
            <th className="hdr-tip" data-tip="How the duplicate was detected: exact (all key fields identical), fuzzy (similar name), nickname, or multi (a mix). Click a row to open the Duplicates list filtered to that signal.">Signal<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th className="hdr-tip" data-tip="Individual accounts that are members of a cluster of this signal — the records that would be merged. Sums to the total duplicate accounts.">Duplicate accounts<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th className="hdr-tip" data-tip="Matched PAIRS within this signal's clusters. A pair is a single signal, so multi-signal shows '—'; the three sum to the total pairs.">Duplicate pairs<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th className="hdr-tip" data-tip="Unique duplicate CLUSTERS (groups of accounts) attributed to this signal by their composition.">Duplicate clusters<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th className="hdr-tip" data-tip="Of this signal's duplicate accounts, how many carry their OWN Membership-Platform merge ID — per account, NOT whether the whole cluster has one. Sums to the Merge-ID review's 'In both'.">Has merge ID<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th className="hdr-tip" data-tip="Duplicate accounts in this signal whose account has NO merge ID of its own. Sums to the review's 'Only in duplicates'.">No merge ID<span className="th-info" aria-hidden="true"> ⓘ</span></th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {sigRows.map((r) => (
            <tr key={r.key} className="row-link" onClick={() => nav('/salesforce/merge/duplicates' + (r.key === 'multi' ? '' : '?f_signal=' + r.key))}>
              <td><span className="statlink">{r.label}</span></td>
              <td>{fmt(r.accounts)}</td>
              <td>{r.pairs == null ? '—' : fmt(r.pairs)}</td>
              <td>{fmt(r.clusters)}</td>
              <td>{fmt(r.has_merge_id)}</td>
              <td>{fmt(r.no_merge_id)}</td>
              <td className="chev">›</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{fmt(d.accounts_in_clusters)}</td>
            <td>{fmt(d.duplicate_pairs)}</td>
            <td>{fmt(d.clusters)}</td>
            <td>{fmt(totHasMerge)}</td>
            <td>{fmt(totNoMerge)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p className="funnel-note" style={{ maxWidth: 'none' }}>
        Pairs are single-signal, so they show "—" for multi and sum exactly to the total. Accounts and
        clusters split by composition, so multi-signal is its own row. <strong>Has / No merge ID</strong> split
        each signal's duplicate accounts by whether that <em>account itself</em> carries a Membership-Platform
        merge ID (per account — not whether the whole cluster does); the two columns sum to the Merge-ID
        review's "In both" and "Only in duplicates". Click a row to open the Duplicates list filtered to that signal.
      </p>

      {/* MERGE-ID FUNNEL (shared with the Merge-ID page) */}
      <h3>Merge-ID review</h3>
      <MergeIdFunnel d={d} />
      {(() => {
        const inBoth = bucketCount('in_both') || 0;
        const sfOnly = bucketCount('sf_only') || 0;
        const sum = inBoth + sfOnly;
        const target = d.merge_id_accounts || 0;
        const ok = sum === target;
        const gap = Math.abs(target - sum);
        return (
          <p className="funnel-note" style={{ maxWidth: 'none' }}>
            Merge-ID groups: <strong>{fmt(d.merge_id_groups)}</strong> groups · <strong>{fmt(target)}</strong> accounts
            with a merge ID = {fmt(inBoth)} in both + {fmt(sfOnly)} only in merge IDs{' '}
            <span className="hdr-tip" style={{ color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}
              data-tip={'Live self-check: accounts with a merge ID should equal In both + Only-in-merge-IDs. '
                + (ok ? 'They match, so the merge-ID panel reconciles.' : 'They differ by ' + fmt(gap) + ' — the counts don’t reconcile; re-run the finder or investigate the data.')}>
              {ok ? '✓ reconciles' : '⚠ off by ' + fmt(gap)}</span>. Those accounts group by their merge-ID value into
            the "Merge-id groups" shown on Select Merges → "Accounts with merge ids".
          </p>
        );
      })()}

      {/* DEFINITIONS */}
      <h3>How matches are defined</h3>
      <div className="defs">
        <div className="defs-row">
          <span className="defs-term exact">Exact</span>
          <span className="defs-body">All five key fields are identical after cleaning (trim + uppercase):
            <strong> last name, first name, gender, birthdate, and ZIP</strong> — ZIP uses the billing postal
            code, or mailing if billing is blank, trimmed to the first 5 digits.</span>
        </div>
        <div className="defs-row">
          <span className="defs-term fuzzy">Fuzzy</span>
          <span className="defs-body">Names scored 0–100 by Levenshtein similarity, combined as
            first&nbsp;×&nbsp;0.45&nbsp;+&nbsp;last&nbsp;×&nbsp;0.55. A pair matches when the combined score
            is <strong>≥ 90</strong>.</span>
        </div>
        <div className="defs-row">
          <span className="defs-term nickname">Nickname</span>
          <span className="defs-body">First names treated as interchangeable using the curated
            <code> nicknames-curated</code> dataset (made symmetric, so Bob ↔ Robert ↔ Bobby). The last name
            must still match exactly or score ≥ 90.</span>
        </div>
        <div className="defs-row">
          <span className="defs-term">Multi-signal</span>
          <span className="defs-body">A cluster flagged by more than one of the above.</span>
        </div>
        <div className="defs-gate">
          All three only compare names <em>after</em> gender, birthdate, and ZIP already match — a name match
          alone never creates a duplicate.
        </div>
      </div>

      <p className="muted small">Read-only · source: salesforce_duplicate_* tables · no Salesforce writes.</p>
    </>
  );
}
