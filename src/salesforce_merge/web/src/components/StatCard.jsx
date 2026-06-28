export default function StatCard({ label, value, help, sub }) {
  return (
    <div className="card stat" title={help || undefined}>
      <div className="stat-label">{label}{help ? <span className="th-info" aria-hidden="true"> ⓘ</span> : ''}</div>
      <div className="stat-value">{value == null ? '—' : value}</div>
      {sub ? <div className="stat-sub muted small">{sub}</div> : null}
    </div>
  );
}
