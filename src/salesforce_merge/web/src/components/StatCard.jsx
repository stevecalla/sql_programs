export default function StatCard({ label, value }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value == null ? '—' : value}</div>
    </div>
  );
}
