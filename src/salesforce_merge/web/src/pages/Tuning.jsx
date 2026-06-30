import { Fragment, useEffect, useMemo, useState } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import DataTable from '../components/DataTable.jsx';
import { api, exportUrl } from '../lib/api.js';

const fmtAsOf = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString(); };

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtDelta = (d) => (d === 0 ? '±0' : d > 0 ? '▲ +' + Number(d).toLocaleString() : '▼ −' + Number(Math.abs(d)).toLocaleString());
const deltaColor = (d) => (d > 0 ? '#185fa5' : d < 0 ? '#854f0b' : 'var(--dim)');

// "gender+birthdate+zip" -> "G+B+ZIP"
const ruleAbbrev = (rf) => String(rf || '').split('+').map((p) => (p === 'zip' ? 'ZIP' : p ? p[0].toUpperCase() : '')).filter(Boolean).join('+');
const profileName = (p) => (p.is_baseline ? 'baseline · ' : '') + `t${p.fuzzy_threshold} · nick ${p.nickname_enabled ? 'on' : 'off'} · ${ruleAbbrev(p.rule_fields)}`;

function Funnel({ cards }) {
  return (
    <div className="funnel">
      {cards.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="funnel-arrow">→</span>}
          <div className={'funnel-card' + (c.tone ? ' ' + c.tone : '')}>
            <div className="funnel-k">{c.k}</div>
            <div className="funnel-v">{c.v}</div>
            {c.sub != null && <div className="funnel-sub" style={c.subStyle}>{c.sub}</div>}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

const funnelCards = (p, base) => {
  const d = (key) => (base && !p.is_baseline ? p[key] - base[key] : null);
  const sub = (key, fallback) => (d(key) == null ? fallback : fmtDelta(d(key)));
  const subStyle = (key) => (d(key) == null ? undefined : { color: deltaColor(d(key)) });
  return [
    { k: 'All accounts', v: fmt(p.total_records), sub: sub('total_records', 'every person record'), subStyle: subStyle('total_records') },
    { k: 'Duplicate accounts', v: fmt(p.accounts_in_clusters), tone: 'accent', sub: sub('accounts_in_clusters', 'records in a cluster'), subStyle: subStyle('accounts_in_clusters') },
    { k: 'Duplicate pairs', v: fmt(p.duplicate_pairs), sub: sub('duplicate_pairs', 'matches between two'), subStyle: subStyle('duplicate_pairs') },
    { k: 'Duplicate clusters', v: fmt(p.consolidated_clusters), sub: sub('consolidated_clusters', 'one unique duplicate'), subStyle: subStyle('consolidated_clusters') },
  ];
};

// Profiles table columns — by-signal cluster counts, Δ vs baseline, and total duplicate accounts (last).
const COLUMNS = [
  { key: 'profile_name', label: 'Profile', sort: true, wrap: true, help: 'The criteria combination (threshold · nickname · required fields).' },
  { key: 'comp_exact', label: 'Exact', sort: true, help: 'Clusters formed only by exact matches.', render: (r) => fmt(r.comp_exact) },
  { key: 'comp_fuzzy', label: 'Fuzzy', sort: true, help: 'Clusters formed only by fuzzy matches.', render: (r) => fmt(r.comp_fuzzy) },
  { key: 'comp_nickname', label: 'Nickname', sort: true, help: 'Clusters formed only by nickname matches.', render: (r) => fmt(r.comp_nickname) },
  { key: 'comp_multi', label: 'Multi', sort: true, help: 'Clusters formed by more than one signal.', render: (r) => fmt(r.comp_multi) },
  { key: 'consolidated_clusters', label: 'Total clusters', sort: true, help: 'All consolidated clusters for this profile.', render: (r) => fmt(r.consolidated_clusters) },
  { key: 'delta', label: 'Δ clusters vs baseline', sort: true, help: 'Difference in total clusters from the baseline.', render: (r) => (r.is_baseline ? '—' : <span style={{ color: deltaColor(r.delta) }}>{fmtDelta(r.delta)}</span>) },
  { key: 'accounts_in_clusters', label: 'Duplicate accounts', sort: true, help: 'Total account records that fall into a cluster (sum of cluster sizes).', render: (r) => fmt(r.accounts_in_clusters) },
  { key: 'delta_accounts', label: 'Δ accounts vs baseline', sort: true, help: 'Difference in duplicate accounts from the baseline.', render: (r) => (r.is_baseline ? '—' : <span style={{ color: deltaColor(r.delta_accounts) }}>{fmtDelta(r.delta_accounts)}</span>) },
];

export default function Tuning() {
  const [profiles, setProfiles] = useState(null);
  const [runAt, setRunAt] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  useEffect(() => {
    api.tuning().then((r) => { setProfiles(r.profiles || []); setRunAt(r.run_at || null); if (r.profiles && r.profiles[0]) setSel(r.profiles[0].label); })
      .catch((e) => setErr(e.message));
  }, []);

  const baseline = useMemo(() => (profiles || []).find((p) => p.is_baseline) || (profiles || [])[0], [profiles]);
  const selected = useMemo(() => (profiles || []).find((p) => p.label === sel) || baseline, [profiles, sel, baseline]);
  const rows = useMemo(() => (profiles || []).map((p) => ({
    ...p,
    profile_name: profileName(p),
    delta: baseline ? p.consolidated_clusters - baseline.consolidated_clusters : 0,
    delta_accounts: baseline ? p.accounts_in_clusters - baseline.accounts_in_clusters : 0,
  })), [profiles, baseline]);

  if (err) return (<><h2>Tuning</h2><p className="err">{err}</p></>);
  if (!profiles) return (<><h2>Tuning</h2><p className="muted">Loading…</p></>);
  if (!profiles.length) return (
    <>
      <h2>Duplicate criteria tuning</h2>
      <p className="muted small">What-if analysis comparing detection criteria — read-only.</p>
      <DatasetStamp />
      <p className="muted">No tuning run yet. Run a sweep from the <strong>Process</strong> page to populate this panel.</p>
    </>
  );

  const rowClass = (r) => `${r.is_baseline ? 'row-base ' : ''}${selected && r.label === selected.label ? 'row-sel' : ''}`.trim() || undefined;

  return (
    <>
      <h2>Duplicate criteria tuning</h2>
      <p className="muted small">What-if analysis — replays detection under different criteria. Read-only; does not change production.</p>
      <DatasetStamp />

      <h3>Baseline <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>({baseline ? profileName(baseline) : '—'})</span></h3>
      {baseline && <Funnel cards={funnelCards(baseline, null)} />}

      <h3>Selected profile <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>({selected ? profileName(selected) : '—'}) · vs. baseline</span></h3>
      <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', background: 'rgba(127,127,127,.05)' }}>
        {selected && <Funnel cards={funnelCards(selected, baseline)} />}
      </div>

      <h3>Profiles — duplicate clusters by signal <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>(click a row to load it into the funnel)</span></h3>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="muted small">Tuning sweep as of <strong>{fmtAsOf(runAt)}</strong> <span style={{ opacity: .7 }}>(runs separately from the dataset above)</span></span>
        <span className="dl-group" style={{ marginLeft: 'auto' }}>
          <span className="muted small">Export</span>
          <a className="dl-link" href={exportUrl('/api/tuning/export', { format: 'csv' })}>CSV</a>
          <a className="dl-link" href={exportUrl('/api/tuning/export', { format: 'xlsx' })}>Excel</a>
        </span>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        searchCols="profile, signal counts"
        maxHeight={420}
        onRowClick={(r) => setSel(r.label)}
        rowClass={rowClass}
      />
      <h3>How to read this table</h3>
      <div className="defs">
        <div className="defs-row"><span className="defs-term lg">Profile</span><span className="defs-body"><code>t90</code> = fuzzy threshold · <code>nick on/off</code> = nickname matching · fields: <strong>G</strong> gender, <strong>B</strong> birthdate, <strong>ZIP</strong> postal code (so <code>G+B</code> = no ZIP).</span></div>
        <div className="defs-row"><span className="defs-term lg exact">Exact</span><span className="defs-body">consolidated clusters formed only by exact matches.</span></div>
        <div className="defs-row"><span className="defs-term lg fuzzy">Fuzzy</span><span className="defs-body">consolidated clusters formed only by fuzzy matches.</span></div>
        <div className="defs-row"><span className="defs-term lg nickname">Nickname</span><span className="defs-body">consolidated clusters formed only by nickname matches.</span></div>
        <div className="defs-row"><span className="defs-term lg">Multi</span><span className="defs-body">clusters formed by more than one signal. Exact + Fuzzy + Nickname + Multi sum to Total clusters.</span></div>
        <div className="defs-row"><span className="defs-term lg">Δ vs baseline</span><span className="defs-body">difference in total clusters and in duplicate accounts from the baseline.</span></div>
        <div className="defs-row"><span className="defs-term lg">Duplicate accounts</span><span className="defs-body">total account records inside clusters (sum of cluster sizes).</span></div>
        <div className="defs-gate">
          Rows: <span style={{ background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 4 }}>baseline</span> = the production-criteria run ·
          <span style={{ background: 'rgba(127,127,127,.16)', padding: '1px 6px', borderRadius: 4, marginLeft: 6 }}>selected</span> = the row loaded into the funnel above.
          Loosening criteria (e.g. dropping ZIP) raises counts — and false-positive risk.
        </div>
      </div>
    </>
  );
}
