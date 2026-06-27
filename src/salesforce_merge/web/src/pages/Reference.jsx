// Plain-language reference for non-technical reviewers: how duplicates are found and how a
// merge works. Static content — no data calls.
export default function Reference() {
  return (
    <div className="reference">
      <h2>Reference — how this works</h2>
      <p className="muted small">A plain-language guide to finding duplicates and merging accounts. No jargon.</p>

      <div className="card ref-card">
        <h3>Finding duplicates</h3>
        <p>
          Goal: spot accounts that are really the <strong>same person</strong> entered more than once.
        </p>
        <p>
          Every account is only compared when it has the three basics filled in — <strong>gender,
          birthdate, and ZIP code</strong>. Among those, we look for matches three ways:
        </p>
        <ol>
          <li><strong>Exact</strong> — the names match exactly (after tidying spacing and capitalization).</li>
          <li><strong>Fuzzy</strong> — the names are very close but not identical (typos, “Jon” vs “Jonn”). We score similarity 0–100 and keep the strong ones.</li>
          <li><strong>Nickname</strong> — the names are known nicknames of each other (“Bob” ↔ “Robert”).</li>
        </ol>
        <p>
          Matched accounts get grouped into a <strong>cluster</strong> — one cluster per real person.
          A cluster of size 2 is a simple pair; larger clusters mean more copies. Each cluster gets a
          <strong> confidence tier</strong> so you can trust the strong ones at a glance.
        </p>
        <p className="muted small">
          This whole step is <strong>read-only</strong> — it looks at Salesforce, it never changes it.
          You see the results on the <strong>Duplicates</strong> page.
        </p>
      </div>

      <div className="card ref-card">
        <h3>Merge IDs and reconciliation</h3>
        <p>
          Separately, Salesforce can tag accounts with a <strong>merge ID</strong> — its own marker that
          “these belong together.” The <strong>Merge-ID</strong> page lines those up against what our
          tool found, and sorts each account into a bucket:
        </p>
        <ul>
          <li><strong>in_both</strong> — Salesforce and our tool agree it’s a duplicate.</li>
          <li><strong>sf_only</strong> — Salesforce tagged it, but our tool didn’t flag it.</li>
          <li><strong>exact / fuzzy / nickname / multi</strong> — our tool flagged it; this names which signal did.</li>
        </ul>
        <p>That tells you where the two views agree and where they don’t — before anything is merged.</p>
      </div>

      <div className="card ref-card">
        <h3>Merging accounts</h3>
        <p>
          Merging combines a cluster’s accounts into <strong>one surviving record</strong>, moving all the
          history (gifts, events, cases) onto the survivor so nothing is lost. It runs in clear steps:
        </p>
        <ol>
          <li><strong>Review</strong> — pick the winner and losers. The <strong>winner</strong> is the account whose ID equals the merge ID; the others are merged into it.</li>
          <li><strong>Dry-run</strong> — a safe preview that checks for problems and shows exactly what will move, without changing anything.</li>
          <li><strong>Confirm</strong> — you approve (production needs a typed confirmation).</li>
          <li><strong>Execute</strong> — Salesforce performs the merge. Losing records go to the Recycle Bin (recoverable for about 15 days).</li>
          <li><strong>Log</strong> — every merge is recorded so it can be reviewed and, if needed, restored.</li>
        </ol>
        <p>
          If a losing account has something worth keeping (for example a <strong>donor flag</strong>), its
          contact details are preserved on the survivor so nothing important is dropped.
        </p>
        <p className="muted small">
          Safety first: merging is <strong>off by default</strong>, always previewed first, tried in a
          sandbox before production, and fully logged. Merging is the only step that changes Salesforce —
          everything else here only reads.
        </p>
      </div>

      <div className="card ref-card">
        <h3>Refreshing the data</h3>
        <p>
          The pages show the most recent detection run (see the “Data as of …” line on each page). When
          new data is needed, the <strong>Process</strong> page re-runs detection and rebuilds these lists.
          You choose <strong>Sandbox or Production</strong> and <strong>Sample or Full</strong>; production
          runs ask for confirmation.
        </p>
      </div>
    </div>
  );
}
