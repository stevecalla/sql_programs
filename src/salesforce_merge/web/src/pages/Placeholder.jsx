export default function Placeholder({ title, note }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="muted">{note} — not built yet. This page is a placeholder in the Phase 0 shell.</p>
    </>
  );
}
