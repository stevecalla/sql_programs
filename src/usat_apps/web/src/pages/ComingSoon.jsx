import { useLocation } from 'react-router-dom';

// Placeholder for panels that are in the rail but not wired up yet (the platform build-out fills these
// in one at a time). Keeps the whole nav clickable so you can see the target structure.
export default function ComingSoon({ title }) {
  const { pathname } = useLocation();
  return (
    <div className="page">
      <h2>{title || 'Coming soon'}</h2>
      <div className="card" style={{ maxWidth: 560 }}>
        <p className="muted">This panel isn't wired up yet — it's part of the platform build-out.</p>
        <p className="muted small" style={{ marginTop: 8 }}>Route: <code>{pathname}</code></p>
      </div>
    </div>
  );
}
