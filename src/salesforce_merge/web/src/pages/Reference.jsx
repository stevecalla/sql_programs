// Plain-language reference for non-technical reviewers — kept consistent with the Dashboard
// (same funnel, same signal definitions, same merge-ID reconciliation). Static content, no data calls.
export default function Reference() {
  return (
    <div className="reference">
      <h2>Reference — how this works</h2>
      <p className="muted small">A plain-language guide to finding duplicates and merging accounts. No jargon.</p>

      <div className="card ref-card">
        <h3>From accounts to unique duplicates</h3>
        <p>The Dashboard reads the numbers left to right, narrowing from every record down to unique duplicates:</p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">All accounts</span><span className="defs-body">every person record in the data set.</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate accounts</span><span className="defs-body">the records that look like copies of someone (the records inside a cluster).</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate pairs</span><span className="defs-body">each individual match between two of those accounts.</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate clusters</span><span className="defs-body">the groups themselves: one cluster = one unique duplicate with 2+ records.</span></div>
          <div className="defs-gate">A cluster of size 2 is a single pair; bigger clusters hold more records and more pairs.</div>
        </div>
      </div>

      <div className="card ref-card">
        <h3>How matches are found</h3>
        <p>
          An account is only compared once it has the three basics filled in — <strong>gender, birthdate,
          and ZIP</strong>. Only then do we compare names, three ways:
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term exact">Exact</span><span className="defs-body">all five key fields are identical after cleaning (trim + uppercase): last name, first name, gender, birthdate, and ZIP (billing ZIP, or mailing if blank, trimmed to the first 5 digits).</span></div>
          <div className="defs-row"><span className="defs-term fuzzy">Fuzzy</span><span className="defs-body">names are very close but not identical (typos, “Jon” vs “Jonn”). Similarity is scored 0–100 and a pair matches at <strong>90 or above</strong>.</span></div>
          <div className="defs-row"><span className="defs-term nickname">Nickname</span><span className="defs-body">first names are known nicknames of each other (“Bob” ↔ “Robert”), using a curated nickname dataset; the last name must still match.</span></div>
          <div className="defs-row"><span className="defs-term">Multi-signal</span><span className="defs-body">a cluster flagged by more than one of the above.</span></div>
          <div className="defs-gate">Matched accounts are grouped into a cluster (one per unique duplicate), each given a confidence tier so you can trust the strong ones at a glance. This step is <strong>read-only</strong> — results are on the <strong>Duplicates</strong> page.</div>
        </div>
      </div>

      <div className="card ref-card">
        <h3>Merge IDs and reconciliation</h3>
        <p>
          A <strong>merge ID</strong> is assigned by the <strong>Membership Platform</strong> (not by
          Salesforce) as its own marker that one or more accounts are duplicates — accounts that share a
          merge ID are meant to be merged together. The <strong>Merge-ID</strong> page lines those up
          against what the tool found and splits every account three ways:
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">In both</span><span className="defs-body">it has a merge ID <em>and</em> the tool also flagged it as a duplicate (you agree).</span></div>
          <div className="defs-row"><span className="defs-term lg">Only in merge IDs</span><span className="defs-body">it has a merge ID, but the tool did <em>not</em> flag it (the platform marked it; the tool did not).</span></div>
          <div className="defs-row"><span className="defs-term lg">Only in duplicates</span><span className="defs-body">the tool flagged it, but it has <em>no</em> merge ID yet.</span></div>
          <div className="defs-gate">Those three add up to every account reviewed, so you can see exactly where the two views agree and where they don’t — before anything is merged.</div>
        </div>
      </div>

      <div className="card ref-card">
        <h3>Merging accounts</h3>
        <p>
          Merging combines a cluster’s accounts into <strong>one surviving record</strong>, moving all the
          history (gifts, events, cases) onto the survivor so nothing is lost. It runs in clear steps:
        </p>
        <ol>
          <li><strong>Review</strong> — pick the surviving record and the ones merged into it.</li>
          <li><strong>Dry-run</strong> — a safe preview that checks for problems and shows exactly what will move, without changing anything.</li>
          <li><strong>Confirm</strong> — you approve (production needs a typed confirmation).</li>
          <li><strong>Execute</strong> — the merge runs in Salesforce. Losing records go to the Recycle Bin (recoverable for about 15 days).</li>
          <li><strong>Log</strong> — every merge is recorded so it can be reviewed and, if needed, restored.</li>
        </ol>
        <p className="muted small">
          Safety first: merging is <strong>off by default</strong>, always previewed first, tried in a
          sandbox before production, and fully logged. Merging is the only step that changes data —
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
