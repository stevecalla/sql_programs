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

  const sb = d.signal_breakdown || { accounts: {}, pairs: {}, clusters: {} };
  const sigRows = [
    { key: 'exact', label: 'Exact' },
    { key: 'fuzzy', label: 'Fuzzy' },
    { key: 'nickname', label: 'Nickname' },
    { key: 'multi', label: 'Multi-signal' },
  ].map((row) => ({
    ...row,
    accounts: sb.accounts[row.key] ?? null,
    pairs: row.key === 'multi' ? null : (sb.pairs[row.key] ?? null),
    clusters: sb.clusters[row.key] ?? null,
  }));

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
            <th>Signal</th><th>Duplicate accounts</th><th>Duplicate pairs</th><th>Duplicate clusters</th><th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {sigRows.map((r) => (
            <tr key={r.key} className="row-link" onClick={() => nav('/duplicates')}>
              <td><span className="statlink">{r.label}</span></td>
              <td>{fmt(r.accounts)}</td>
              <td>{r.pairs == null ? '—' : fmt(r.pairs)}</td>
              <td>{fmt(r.clusters)}</td>
              <td className="chev">›</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{fmt(d.accounts_in_clusters)}</td>
            <td>{fmt(d.duplicate_pairs)}</td>
            <td>{fmt(d.clusters)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p className="funnel-note" style={{ maxWidth: 720 }}>
        Pairs are single-signal, so they show "—" for multi and sum exactly to the total. Accounts and
        clusters split by composition, so multi-signal is its own row. Click a row to open the Duplicates
        list filtered to that signal.
      </p>

      {/* MERGE-ID FUNNEL (shared with the Merge-ID page) */}
      <h3>Merge-ID review</h3>
      <MergeIdFunnel d={d} />

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
