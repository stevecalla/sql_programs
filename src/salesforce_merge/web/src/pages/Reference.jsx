// Plain-language reference for non-technical reviewers — kept consistent with the Dashboard
// (same funnel, same signal definitions, same merge-ID reconciliation) and with the Select Merges /
// Process Merges pages (survivor cascade, how a merge runs, what it doesn't touch). Static content,
// no data calls.
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
        <h3>Merging accounts — review, queue, approve, process</h3>
        <p>
          Merging combines a cluster’s accounts into <strong>one surviving record</strong>, reparenting all
          the history (gifts, events, cases) onto the survivor so nothing is lost. It runs as a reviewed
          pipeline across two pages — you build a queue on <strong>Select Merges</strong> and run it on
          <strong> Process Merges</strong>:
        </p>
        <ol>
          <li><strong>Review</strong> (Select Merges) — pick the surviving record (the “master”) and the accounts merged into it, and set any per-field overrides.</li>
          <li><strong>Add to merge queue</strong> — stages that set with its survivor, losers, overrides, and child-record counts. Review only — nothing is written to Salesforce.</li>
          <li><strong>Approve selected</strong> — moves a queued set to <em>approved</em> (the human go-ahead). The status filter switches the view between queued / approved / done; the ✕ removes a set while it is queued or approved.</li>
          <li><strong>Process</strong> (Process Merges, Phase 3) — re-runs the dry-run against fresh Salesforce data, backs the records up to a pre-merge snapshot, runs the Salesforce merge, records history, and enables best-effort restore from that snapshot.</li>
        </ol>
        <p className="muted small">
          Safety first: merge execution is <strong>off by default</strong> (safe mode) and never runs from
          the review pages. Every set is previewed with a dry-run, tried in a sandbox before production, and
          checked for <strong>environment/org alignment</strong> — a set built against Sandbox can’t run
          against Production, and vice-versa. Production needs a typed confirmation, and every merge is
          logged. Merging is the only step that changes data; everything else here only reads.
        </p>
      </div>

      <div className="card ref-card">
        <h3>Caveats</h3>
        <ul>
          <li><strong>Queue, approve, then process.</strong> "Add to merge queue" stages a set with its survivor, losers, per-field overrides, and child counts — review only, no Salesforce write. "Approve selected" moves queued sets to <em>approved</em> (the human go-ahead); the status filter switches the view between queued / approved / done. The ✕ removes a set while it is <em>queued</em> or <em>approved</em>. Execution is Phase 3: processing an approved set will re-run the dry-run against fresh Salesforce data, back the records up to a pre-merge snapshot, run the Salesforce merge, record history, and enable best-effort restore from that snapshot. Nothing on this page writes to Salesforce.</li>
          <li><strong>Marketing Cloud (SFMC) and other external systems are not included.</strong> Auto-discovery only walks child relationships inside the core Salesforce CRM org — objects that hang off the Account or its Person Contact. Marketing Cloud is a separate platform connected through Marketing Cloud Connect, which syncs Contacts and Leads into SFMC and identifies each subscriber by a Subscriber Key, usually the Contact Id (or Lead Id).
            <ul>
              <li>When a merge deletes the losing Contact, its Subscriber Key is orphaned: subscriber records, list and data-extension rows, journey membership, and send/engagement history that referenced the old Id are not automatically repointed to the surviving Contact.</li>
              <li>Reconciliation happens in Marketing Cloud after the merge — re-sync the surviving Contact, update or remap the Subscriber Key, and review any journeys, automations, or data extensions that filter on the old Id.</li>
              <li>The same caution applies to anything else linked by Salesforce Id outside the org (data warehouse, AMS or payment systems, other marketing tools): those references are invisible to this preview and need their own reconciliation.</li>
            </ul>
          </li>
          <li><strong>How the surviving master is chosen.</strong> The survivor is picked by a cascade: (1) the account whose Salesforce Id equals the merge id; (2) else the lowest membership number, if any; (3) else the account with the most Salesforce child records; (4) else the oldest account. A merge always needs the survivor plus at least one other account, so a group of one is skipped. You can override the master per cluster before queuing. Bulk queueing resolves steps 1–2 from the database (no Salesforce call); groups that would need the child-count or oldest tie-break are skipped and left for single review.</li>
          <li><strong>How the merge actually runs.</strong> Execution (Phase 3) would use Salesforce native merge via Apex <code>Database.merge</code> — the same operation as the SOAP/REST <code>merge()</code> call and the standard UI Merge action. It is the only supported way to combine records; there is no alternate merge-by-id mechanism.
            <ul>
              <li>Each call merges at most three records: one surviving master plus up to two losing records. A cluster with N losers therefore needs about ceil(N / 2) calls — the merge-operations estimate shown above — and batching this way keeps every transaction within Salesforce Apex and DML governor limits.</li>
              <li>Survivorship is applied by writing the chosen values onto the master before the merge: the master keeps its non-blank values, blank fields backfill from a losing record, and any value set in the override column above wins. The native merge then retains the master, reparents all child records to it, and sends the losing accounts to the Recycle Bin (about 15 days).</li>
              <li>These are Person Accounts, so each record is an Account paired with a Person Contact; the merge collapses both sides together, which is why child records that hang off the Contact also move.</li>
              <li>The membership-platform merge id (<code>usat_Salesforce_Merge_Id__pc</code>) is only a matching and QA field used to decide which records belong together. It is data, not the action that performs the merge.</li>
            </ul>
          </li>
        </ul>
      </div>

      <div className="card ref-card">
        <h3>Running and undoing merges (how Process Merges will work)</h3>
        <p>
          Approved sets are run from the <strong>Process Merges</strong> page. The whole flow is built to be
          rehearsed safely first, then run for real once — and undone if needed.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">Simulate vs Execute</span><span className="defs-body">a safety switch (default <strong>Simulate</strong>) runs everything — re-check, backup, and the merge plan — but makes no Salesforce changes. A real merge happens only in <strong>Execute</strong> mode with every gate satisfied (execution enabled, typed “MERGE” confirmation, environment match, sandbox first).</span></div>
          <div className="defs-row"><span className="defs-term lg">Backup every run</span><span className="defs-body">before each run a snapshot captures the records and their child records, so there’s always a current restore point. Only the latest snapshot per set is kept — no stale pile-up.</span></div>
          <div className="defs-row"><span className="defs-term lg">How a merge runs</span><span className="defs-body">Salesforce merges a master plus two records at a time, so a big set runs in several steps (a 26-account set takes 13). A live progress bar, elapsed timer, and estimated finish show as it goes.</span></div>
          <div className="defs-row"><span className="defs-term lg">If a step fails</span><span className="defs-body">the set <strong>stops</strong> at the failed step and is marked <em>failed</em> — it is <strong>not</strong> auto-reverted, because the steps that already worked are correct. Re-running it safely continues with whatever is left. True rollback uses Restore.</span></div>
          <div className="defs-row"><span className="defs-term lg">Runs once</span><span className="defs-body">a successful set is marked <em>done</em> and drops out, so it can’t be merged twice. You can simulate as often as you like beforehand.</span></div>
          <div className="defs-row"><span className="defs-term lg">Restore (later phase)</span><span className="defs-body">a completed merge can be undone for about 15 days: the removed records are brought back from the Recycle Bin (with their original IDs), their children re-linked, and the master’s overwritten fields reset — from the snapshot. Beyond that window restore is approximate.</span></div>
          <div className="defs-gate">Status: this is the planned behavior for execution (Phase 3b) and restore (Phase 4). Today the page runs in <strong>Simulate only</strong> — no Salesforce writes happen yet.</div>
        </div>
      </div>

      <div className="card ref-card">
        <h3>Tuning — testing the match criteria</h3>
        <p>
          The <strong>Tuning</strong> page answers "how many duplicates would we get if we changed the
          rules?" — without changing anything in production. A <strong>sweep</strong> replays detection over
          the current data using many criteria combinations and shows the results side by side.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">Fuzzy threshold</span><span className="defs-body">how close two names must score to count as a fuzzy match (88 / 90 / 92; 90 is today's).</span></div>
          <div className="defs-row"><span className="defs-term lg">Nicknames</span><span className="defs-body">whether nickname matching is on or off.</span></div>
          <div className="defs-row"><span className="defs-term lg">Required fields</span><span className="defs-body">which of gender, birthdate, and ZIP must match — including a "no ZIP" experiment that loosens matching.</span></div>
          <div className="defs-row"><span className="defs-term lg">ZIP trim</span><span className="defs-body">how many ZIP digits are compared (first 5).</span></div>
          <div className="defs-gate">Each combination is a "profile"; <strong>baseline</strong> = today's production. The page shows the baseline funnel, the selected profile's funnel (with differences vs. today), and a table of every profile's clusters split by signal.</div>
        </div>
        <p className="muted small">
          Read-only: the sweep replays over the snapshot already loaded — no Salesforce fetch — and never
          changes production detection. Run it from the <strong>Get Duplicates</strong> page (Run tuning
          sweep); results appear on the <strong>Tuning</strong> page.
        </p>
      </div>

      <div className="card ref-card">
        <h3>Refreshing the data</h3>
        <p>
          The pages show the most recent detection run (see the “Data as of …” line on each page). When
          new data is needed, the <strong>Get Duplicates</strong> page re-runs detection and rebuilds these
          lists. You choose <strong>Sandbox or Production</strong> and <strong>Sample or Full</strong>;
          production runs ask for confirmation.
        </p>
      </div>
    </div>
  );
}
