// Shared count formatting for the review panels + dashboard, so the "groups/clusters · accounts" dual
// count is rendered ONE way everywhere (no per-panel copies). Keeps units consistent across Dashboard,
// Duplicates, Merge-ID, Select Merges, and Merge Ops.

export const nfmt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString());

// Inline dual count: "1,928 groups · 3,689 accounts". Pass the primary unit first (what the list rows
// are), then the companion. Either side may be null (renders just the available one). `muted` wraps it
// in the standard muted-small styling used in list headers.
export function CountPair({ a, aLabel, b, bLabel, muted = true, className }) {
  const parts = [];
  if (a != null) parts.push(nfmt(a) + (aLabel ? ' ' + aLabel : ''));
  if (b != null) parts.push(nfmt(b) + (bLabel ? ' ' + bLabel : ''));
  const text = parts.join(' · ');
  return <span className={className || (muted ? 'muted small' : undefined)}>{text}</span>;
}
