// RiskPills — portal / donor risk badges for a staged merge set (queue row).
// Driven by flags the backend computes from the CURRENTLY-STAGED survivor + losers
// (merge_queue.list): *_conflict = a loser carries the flag but the master does NOT.
//  · portal* (red)  = a Customer-Portal account is being merged into a non-portal master.
//                     Salesforce will likely REJECT this — the portal account must be the master.
//  · portal  (blue) = the set contains a portal account and it IS the master (safe).
//  · donor*  (amber)= a Foundation constituent is being merged into a non-donor master —
//                     confirm the donor record is preserved (internal requirement, not an SF block).
//  · donor   (amber)= the set contains a donor account (informational).
// Because the flags come off the stored survivor, re-staging with a different master updates
// them on the next queue refresh — the queue stays in sync with whatever master is staged.
export default function RiskPills({ row, style }) {
  if (!row) return null;
  const base = { fontSize: 10, padding: '1px 6px', marginLeft: 4, flex: '0 0 auto', ...(style || {}) };
  const pc = Number(row.portal_conflict), pi = Number(row.portal_in_set);
  const dc = Number(row.donor_conflict), di = Number(row.donor_in_set);
  return (
    <>
      {pc ? (
        <span className="pill" style={{ ...base, background: 'var(--red-bg, #fdecea)', color: 'var(--red, #c0392b)' }}
          title="A Customer-Portal account is being merged into a non-portal master — Salesforce will likely reject this merge. Make the portal account the master in Select Merges.">portal*</span>
      ) : pi ? (
        <span className="pill" style={{ ...base, background: 'var(--accent-soft)', color: 'var(--accent)' }}
          title="This set contains a Customer-Portal account and it is the master (OK to merge).">portal</span>
      ) : null}
      {dc ? (
        <span className="pill" style={{ ...base, background: 'var(--amber-bg)', color: 'var(--amber, #854f0b)' }}
          title="A Foundation constituent (donor record) is being merged into a non-donor master — confirm the donor record is preserved before merging (internal requirement).">donor*</span>
      ) : di ? (
        <span className="pill" style={{ ...base, background: 'var(--amber-bg)', color: 'var(--amber, #854f0b)' }}
          title="This set contains a Foundation constituent (donor record).">donor</span>
      ) : null}
    </>
  );
}
