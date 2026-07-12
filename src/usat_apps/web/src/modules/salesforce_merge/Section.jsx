// salesforce_merge module — front-end entry (walking skeleton). Phase 2 replaces this stub with the ported
// merge pages behind a drill-in rail (the platform rail is swapped for merge's own rail with a back link).
// Lazy-loaded by web/src/nav.js so merge ships in its own bundle chunk.
export default function MergeSection({ title }) {
  return (
    <div className="page">
      <h2>{title || 'Merge'}</h2>
      <div className="card" style={{ maxWidth: 560 }}>
        <p className="muted">Salesforce Merge module scaffold is mounted.</p>
        <p className="muted small" style={{ marginTop: 8 }}>
          The full merge app (dashboard, wizard, restore, tuning) ports in here next. Backend health:
          <code> /api/salesforce-merge/ping</code>
        </p>
      </div>
    </div>
  );
}
