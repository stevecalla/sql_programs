// Plain-language reference for non-technical reviewers — kept consistent with the Dashboard
// (same funnel, same signal definitions, same merge-ID reconciliation) and with the Select Merges /
// Process Merges pages (survivor cascade, how a merge runs, what it doesn't touch). Static content,
// no data calls.
import { useState } from 'react';

const SECTIONS = [
  {
    title: "From accounts to unique duplicates",
    text: "from accounts to unique duplicates the dashboard reads the numbers left to right, narrowing from every record down to unique duplicates: all accounts every person record in the data set. duplicate accounts the records that look like copies of someone (the records inside a cluster). duplicate pairs each individual match between two of those accounts. duplicate clusters the groups themselves: one cluster = one unique duplicate with 2+ records. a cluster of size 2 is a single pair; bigger clusters hold more records and more pairs.",
    body: (
      <>
        <p>The Dashboard reads the numbers left to right, narrowing from every record down to unique duplicates:</p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">All accounts</span><span className="defs-body">every person record in the data set.</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate accounts</span><span className="defs-body">the records that look like copies of someone (the records inside a cluster).</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate pairs</span><span className="defs-body">each individual match between two of those accounts.</span></div>
          <div className="defs-row"><span className="defs-term lg">Duplicate clusters</span><span className="defs-body">the groups themselves: one cluster = one unique duplicate with 2+ records.</span></div>
          <div className="defs-gate">A cluster of size 2 is a single pair; bigger clusters hold more records and more pairs.</div>
        </div>
      </>
    ),
  },
  {
    title: "How matches are found",
    text: "how matches are found an account is only compared once it has the three basics filled in — gender, birthdate, and zip . only then do we compare names, three ways: exact all five key fields are identical after cleaning (trim + uppercase): last name, first name, gender, birthdate, and zip (billing zip, or mailing if blank, trimmed to the first 5 digits). fuzzy names are very close but not identical (typos, “jon” vs “jonn”). similarity is scored 0–100 and a pair matches at 90 or above . nickname first names are known nicknames of each other (“bob” ↔ “robert”), using a curated nickname dataset; the last name must still match. multi-signal a cluster flagged by more than one of the above. matched accounts are grouped into a cluster (one per unique duplicate), each given a confidence tier so you can trust the strong ones at a glance. this step is read-only — results are on the duplicates page.",
    body: (
      <>
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
      </>
    ),
  },
  {
    title: "Merge IDs and reconciliation",
    text: "merge ids and reconciliation a merge id is assigned by the membership platform (not by salesforce) as its own marker that one or more accounts are duplicates — accounts that share a merge id are meant to be merged together. the merge-id page lines those up against what the tool found and splits every account three ways: in both it has a merge id and the tool also flagged it as a duplicate (you agree). only in merge ids it has a merge id, but the tool did not flag it (the platform marked it; the tool did not). only in duplicates the tool flagged it, but it has no merge id yet. those three add up to every account reviewed, so you can see exactly where the two views agree and where they don’t — before anything is merged.",
    body: (
      <>
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
      </>
    ),
  },
  {
    title: "Merging accounts — review, queue, approve, process",
    text: "merging accounts — review, queue, approve, process merging combines a cluster’s accounts into one surviving record , reparenting all the history (gifts, events, cases) onto the survivor so nothing is lost. it runs as a reviewed pipeline across two pages — you build a queue on select merges and run it on process merges : review (select merges) — pick the surviving record (the “master”) and the accounts merged into it, and set any per-field overrides. add to merge queue — stages that set with its survivor, losers, overrides, and child-record counts. review only — nothing is written to salesforce. approve selected — moves a queued set to approved (the human go-ahead). the status filter switches the view between queued / approved / done; the ✕ removes a set while it is queued or approved. process (process merges, phase 3) — re-runs the dry-run against fresh salesforce data, backs the records up to a pre-merge snapshot, runs the salesforce merge, records history, and enables best-effort restore from that snapshot. safety first: merge execution is off by default (safe mode) and never runs from the review pages. every set is previewed with a dry-run, tried in a sandbox before production, and checked for environment/org alignment — a set built against sandbox can’t run against production, and vice-versa. production needs a typed confirmation, and every merge is logged. merging is the only step that changes data; everything else here only reads.",
    body: (
      <>
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
      </>
    ),
  },
  {
    title: "Caveats",
    text: "caveats queue, approve, then process. \"add to merge queue\" stages a set with its survivor, losers, per-field overrides, and child counts — review only, no salesforce write. \"approve selected\" moves queued sets to approved (the human go-ahead); the status filter switches the view between queued / approved / done. the ✕ removes a set while it is queued or approved . execution is phase 3: processing an approved set will re-run the dry-run against fresh salesforce data, back the records up to a pre-merge snapshot, run the salesforce merge, record history, and enable best-effort restore from that snapshot. nothing on this page writes to salesforce. marketing cloud (sfmc) and other external systems are not included. auto-discovery only walks child relationships inside the core salesforce crm org — objects that hang off the account or its person contact. marketing cloud is a separate platform connected through marketing cloud connect, which syncs contacts and leads into sfmc and identifies each subscriber by a subscriber key, usually the contact id (or lead id). when a merge deletes the losing contact, its subscriber key is orphaned: subscriber records, list and data-extension rows, journey membership, and send/engagement history that referenced the old id are not automatically repointed to the surviving contact. reconciliation happens in marketing cloud after the merge — re-sync the surviving contact, update or remap the subscriber key, and review any journeys, automations, or data extensions that filter on the old id. the same caution applies to anything else linked by salesforce id outside the org (data warehouse, ams or payment systems, other marketing tools): those references are invisible to this preview and need their own reconciliation. how the surviving master is chosen. the survivor is picked by a cascade: (1) the account whose salesforce id equals the merge id; (2) else the lowest membership number, if any; (3) else the account with the most salesforce child records; (4) else the oldest account. a merge always needs the survivor plus at least one other account, so a group of one is skipped. you can override the master per cluster before queuing. bulk queueing resolves steps 1–2 from the database (no salesforce call); groups that would need the child-count or oldest tie-break are skipped and left for single review. how the merge actually runs. execution (phase 3) would use salesforce native merge via apex database.merge — the same operation as the soap/rest merge() call and the standard ui merge action. it is the only supported way to combine records; there is no alternate merge-by-id mechanism. each call merges at most three records: one surviving master plus up to two losing records. a cluster with n losers therefore needs about ceil(n / 2) calls — the merge-operations estimate shown above — and batching this way keeps every transaction within salesforce apex and dml governor limits. survivorship is applied by writing the chosen values onto the master before the merge: the master keeps its non-blank values, blank fields backfill from a losing record, and any value set in the override column above wins. the native merge then retains the master, reparents all child records to it, and sends the losing accounts to the recycle bin (about 15 days). these are person accounts, so each record is an account paired with a person contact; the merge collapses both sides together, which is why child records that hang off the contact also move. the membership-platform merge id ( usat_salesforce_merge_id__pc ) is only a matching and qa field used to decide which records belong together. it is data, not the action that performs the merge.",
    body: (
      <>
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
      </>
    ),
  },
  {
    title: "Running and undoing merges (how Process Merges will work)",
    text: "running and undoing merges (how process merges will work) approved sets are run from the process merges page. the whole flow is built to be rehearsed safely first, then run for real once — and undone if needed. simulate vs execute a safety switch (default simulate ) runs everything — re-check, backup, and the merge plan — but makes no salesforce changes. a real merge happens only in execute mode with every gate satisfied (execution enabled, typed “merge” confirmation, environment match, sandbox first). backup every run before each run a snapshot captures the records and their child records, so there’s always a current restore point. only the latest snapshot per set is kept — no stale pile-up. how a merge runs salesforce merges a master plus two records at a time, so a big set runs in several steps (a 26-account set takes 13). a live progress bar, elapsed timer, and estimated finish show as it goes. if a step fails the set stops at the failed step and is marked failed — it is not auto-reverted, because the steps that already worked are correct. re-running it safely continues with whatever is left. true rollback uses restore. runs once a successful set is marked done and drops out, so it can’t be merged twice. you can simulate as often as you like beforehand. merge markers salesforce stamps each deleted loser with masterrecordid = the surviving record (that’s how a merge differs from a plain delete, and it’s what the recycle bin panel’s “merged into” column shows). optionally, the tool can also stamp the survivor with was_merged__c + was_merged_date__c — an admin must create those two account fields first; if they’re missing the merge still runs and the stamp is skipped with a notice. restore (later phase) a completed merge can be undone for about 15 days: the removed records are brought back from the recycle bin (with their original ids), their children re-linked, and the master’s overwritten fields reset — from the snapshot. beyond that window restore is approximate. status: this is the planned behavior for execution (phase 3b) and restore (phase 4). today the page runs in simulate only — no salesforce writes happen yet.",
    body: (
      <>
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
          <div className="defs-row"><span className="defs-term lg">Merge markers</span><span className="defs-body">Salesforce stamps each deleted loser with <code>MasterRecordId</code> = the surviving record (that’s how a merge differs from a plain delete, and it’s what the Recycle Bin panel’s “merged into” column shows). Optionally, the tool can also stamp the <em>survivor</em> with <code>was_merged__c</code> + <code>was_merged_date__c</code> — an admin must create those two Account fields first; if they’re missing the merge still runs and the stamp is skipped with a notice.</span></div>
          <div className="defs-row"><span className="defs-term lg">Restore (later phase)</span><span className="defs-body">a completed merge can be undone for about 15 days: the removed records are brought back from the Recycle Bin (with their original IDs), their children re-linked, and the master’s overwritten fields reset — from the snapshot. Beyond that window restore is approximate.</span></div>
          <div className="defs-gate">Status: this is the planned behavior for execution (Phase 3b) and restore (Phase 4). Today the page runs in <strong>Simulate only</strong> — no Salesforce writes happen yet.</div>
        </div>
      </>
    ),
  },
  {
    title: "Switching environments & not merging twice",
    text: "switching environments & not merging twice the tool always works against one environment's data at a time — whichever was last loaded (the “data as of …” line). the sandbox / production label comes from that loaded dataset, and it also decides which salesforce login the run uses, so the place a merge would write always matches the data you’re looking at. sets are stamped with their environment when you add a set to the queue it records the environment it was built in. the queue is never auto-cleared, so it survives switching back and forth between sandbox and production. alignment guard before processing each set, the tool compares the set’s stamped environment and org id (both captured when the set was queued) to the currently loaded one. a mismatch is skipped and logged — never merged. so a sandbox-built set won’t run while production is loaded, and vice-versa; switch the loaded data back and it becomes runnable again. runs once (status) a set that merges successfully is marked done and drops out of the approved list, so it can’t be picked again. simulate never changes status, so you can rehearse a set as many times as you like. drift re-check every run re-reads the cluster first; if a set’s records are already gone (e.g. merged away earlier), it’s skipped as “records changed since queueing.” re-running detection after a merge also no longer sees the removed records, so the cluster isn’t re-flagged. salesforce backstop if a set somehow still pointed at an already-merged record, salesforce rejects the merge — it surfaces as a failed step, not a silent double-merge. the most reliable “don’t merge twice” guard is the done status (set for merges run through this tool) plus refreshing the data after merges. merges done directly in salesforce are caught at run time by salesforce rather than pre-skipped, since the drift check reads the last loaded dataset, not a live per-record lookup.",
    body: (
      <>
        <p>
          The tool always works against <strong>one environment's data at a time</strong> — whichever
          was last loaded (the “Data as of …” line). The <strong>Sandbox / Production</strong> label comes
          from that loaded dataset, and it also decides which Salesforce login the run uses, so the place a
          merge would write always matches the data you’re looking at.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">Sets are stamped with their environment</span><span className="defs-body">when you add a set to the queue it records the environment it was built in. The queue is never auto-cleared, so it survives switching back and forth between Sandbox and Production.</span></div>
          <div className="defs-row"><span className="defs-term lg">Alignment guard</span><span className="defs-body">before processing each set, the tool compares the set’s stamped environment <em>and org id</em> (both captured when the set was queued) to the <em>currently loaded</em> one. A mismatch is <strong>skipped</strong> and logged — never merged. So a Sandbox-built set won’t run while Production is loaded, and vice-versa; switch the loaded data back and it becomes runnable again.</span></div>
          <div className="defs-row"><span className="defs-term lg">Runs once (status)</span><span className="defs-body">a set that merges successfully is marked <em>done</em> and drops out of the approved list, so it can’t be picked again. Simulate never changes status, so you can rehearse a set as many times as you like.</span></div>
          <div className="defs-row"><span className="defs-term lg">Drift re-check</span><span className="defs-body">every run re-reads the cluster first; if a set’s records are already gone (e.g. merged away earlier), it’s skipped as “records changed since queueing.” Re-running detection after a merge also no longer sees the removed records, so the cluster isn’t re-flagged.</span></div>
          <div className="defs-row"><span className="defs-term lg">Salesforce backstop</span><span className="defs-body">if a set somehow still pointed at an already-merged record, Salesforce rejects the merge — it surfaces as a <em>failed</em> step, not a silent double-merge.</span></div>
          <div className="defs-gate">The most reliable “don’t merge twice” guard is the <em>done</em> status (set for merges run through this tool) plus refreshing the data after merges. Merges done <strong>directly in Salesforce</strong> are caught at run time by Salesforce rather than pre-skipped, since the drift check reads the last loaded dataset, not a live per-record lookup.</div>
        </div>
      </>
    ),
  },
  {
    title: "Recycle Bin & restoring a merge",
    text: "recycle bin & restoring a merge a “completed merge” in the restore list is a whole merge set — one surviving record plus every account that was merged into it (the “merged” count) — not a single account. restoring a set brings all of its merged accounts back together. what the recycle bin holds when a merge runs, the losing accounts are soft-deleted to salesforce’s recycle bin for about 15 days , each stamped with masterrecordid = the survivor (that’s the “merged into” column). while they’re there, they can be brought back with their original ids . restore (recycle-bin tier) the only restore path built today. for an eligible set it undelete s the losers (original ids), re-points their children to the original parents from the pre-merge snapshot, and resets the survivor’s overwritten fields from that snapshot. the set flips done → restored . all-or-nothing eligibility a set is flagged ✓ restorable only if every loser in it is still in the recycle bin. if even one is gone (purged or already restored), the whole set shows ✕ expired and is skipped; — unknown means the eligibility check couldn’t reach salesforce. needs a snapshot undelete only brings the records back; the pre-merge snapshot supplies where each child reattaches and the survivor’s pre-merge field values. a set with no saved snapshot is skipped even if its losers are still in the bin. beyond the ~15-day window, or once records are purged, recycle-bin restore is impossible — the records no longer exist to undelete. re-creating them from the backup (with new ids) is a separate, approximate path; see the plan docs for status.",
    body: (
      <>
        <p>
          A “completed merge” in the restore list is a whole <strong>merge set</strong> — one surviving
          record plus every account that was merged into it (the “Merged” count) — not a single account.
          Restoring a set brings <em>all</em> of its merged accounts back together.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">What the Recycle Bin holds</span><span className="defs-body">when a merge runs, the losing accounts are <strong>soft-deleted</strong> to Salesforce’s Recycle Bin for about <strong>15 days</strong>, each stamped with <code>MasterRecordId</code> = the survivor (that’s the “Merged into” column). While they’re there, they can be brought back with their <em>original ids</em>.</span></div>
          <div className="defs-row"><span className="defs-term lg">Restore (Recycle-Bin tier)</span><span className="defs-body">the only restore path built today. For an eligible set it <code>undelete</code>s the losers (original ids), re-points their children to the original parents from the pre-merge snapshot, and resets the survivor’s overwritten fields from that snapshot. The set flips <em>done → restored</em>.</span></div>
          <div className="defs-row"><span className="defs-term lg">All-or-nothing eligibility</span><span className="defs-body">a set is flagged <strong>✓ restorable</strong> only if <em>every</em> loser in it is still in the Recycle Bin. If even one is gone (purged or already restored), the whole set shows <strong>✕ expired</strong> and is skipped; <strong>— unknown</strong> means the eligibility check couldn’t reach Salesforce.</span></div>
          <div className="defs-row"><span className="defs-term lg">Needs a snapshot</span><span className="defs-body">undelete only brings the records back; the pre-merge <strong>snapshot</strong> supplies where each child reattaches and the survivor’s pre-merge field values. A set with no saved snapshot is skipped even if its losers are still in the bin.</span></div>
          <div className="defs-gate">Beyond the ~15-day window, or once records are purged, Recycle-Bin restore is impossible — the records no longer exist to undelete. Re-creating them from the backup (with <em>new</em> ids) is a separate, approximate path; see the plan docs for status.</div>
        </div>
      </>
    ),
  },
  {
    title: "Tuning — testing the match criteria",
    text: "tuning — testing the match criteria the tuning page answers \"how many duplicates would we get if we changed the rules?\" — without changing anything in production. a sweep replays detection over the current data using many criteria combinations and shows the results side by side. fuzzy threshold how close two names must score to count as a fuzzy match (88 / 90 / 92; 90 is today's). nicknames whether nickname matching is on or off. required fields which of gender, birthdate, and zip must match — including a \"no zip\" experiment that loosens matching. zip trim how many zip digits are compared (first 5). each combination is a \"profile\"; baseline = today's production. the page shows the baseline funnel, the selected profile's funnel (with differences vs. today), and a table of every profile's clusters split by signal. read-only: the sweep replays over the snapshot already loaded — no salesforce fetch — and never changes production detection. run it from the get duplicates page (run tuning sweep); results appear on the tuning page.",
    body: (
      <>
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
      </>
    ),
  },
  {
    title: "Refreshing the data",
    text: "refreshing the data the pages show the most recent detection run (see the “data as of …” line on each page). when new data is needed, the get duplicates page re-runs detection and rebuilds these lists. you choose sandbox or production and sample or full ; production runs ask for confirmation.",
    body: (
      <>
        <p>
          The pages show the most recent detection run (see the “Data as of …” line on each page). When
          new data is needed, the <strong>Get Duplicates</strong> page re-runs detection and rebuilds these
          lists. You choose <strong>Sandbox or Production</strong> and <strong>Sample or Full</strong>;
          production runs ask for confirmation.
        </p>
      </>
    ),
  },
  {
    title: "Salesforce API usage & the pre-flight check",
    text: "salesforce api usage & the pre-flight check every read, merge, and restore this tool makes is one salesforce api call , and they all draw from the org's single daily api requests budget — a rolling 24-hour limit shared by every integration on that org. the sf api page (under help in the rail) shows how much of that budget is left, and process merges warns you before a run that would blow it. which limit applies the merge-time work — cluster reads, merging (a master plus two records per call), restoring, and recreating — is synchronous rest/soap against daily api requests (the main gauge). the full / production data pull (detection at scale) is different: it streams accounts through the bulk api (bulk api 2.0 query jobs), which draw on the separate bulk api job limits shown under other limits on a live reading — not daily api requests. small / test pulls use a capped rest query instead. no call unless you ask the sf api page opens showing the last captured reading (a database lookup — no salesforce call). only refresh (live) makes a real call, and that reading is saved so the next person sees it without spending one. sandbox vs production the two orgs have separate budgets. tabs let you check either; each remembers its last reading so you can compare. pre-flight before a run on process merges, once you select sets in execute mode a line shows the estimated cost (merge calls + per-set overhead) against the remaining budget. if it would exceed what's left it turns red and warns you to split the run or wait for the daily reset. the check reads the cached budget — it does not spend a call. measured cost & trend each merge run records its start/end usage, so the sf api page shows a recent runs table with the actual calls each run consumed, an intraday usage trend, and a by-activity breakdown — the real numbers that refine the estimate over time. budgets are per-org and reset on a rolling 24-hour basis. the captured trend and per-run cost track daily api requests (merges, restores, cluster reads); the full data pull runs as a separate job, so its bulk-api usage shows under other limits on a live reading rather than in the trend. a live reading needs that environment's salesforce credentials configured.",
    body: (
      <>
        <p>
          Every read, merge, and restore this tool makes is one Salesforce <strong>API call</strong>, and
          they all draw from the org's single <strong>Daily API Requests</strong> budget — a rolling
          24-hour limit shared by every integration on that org. The <strong>SF API</strong> page (under
          <em>Help</em> in the rail) shows how much of that budget is left, and <strong>Process Merges</strong>
          warns you before a run that would blow it.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">Which limit applies</span><span className="defs-body">the merge-time work — cluster reads, merging (a master plus two records per call), restoring, and recreating — is synchronous REST/SOAP against <strong>Daily API Requests</strong> (the main gauge). The <em>full / production data pull</em> (detection at scale) is different: it streams accounts through the <strong>Bulk API</strong> (Bulk API 2.0 query jobs), which draw on the separate <strong>Bulk API</strong> job limits shown under <em>Other limits</em> on a live reading — not Daily API Requests. Small / test pulls use a capped REST query instead.</span></div>
          <div className="defs-row"><span className="defs-term lg">No call unless you ask</span><span className="defs-body">the SF API page opens showing the <em>last captured reading</em> (a database lookup — no Salesforce call). Only <strong>Refresh (live)</strong> makes a real call, and that reading is saved so the next person sees it without spending one.</span></div>
          <div className="defs-row"><span className="defs-term lg">Sandbox vs Production</span><span className="defs-body">the two orgs have separate budgets. Tabs let you check either; each remembers its last reading so you can compare.</span></div>
          <div className="defs-row"><span className="defs-term lg">Pre-flight before a run</span><span className="defs-body">on Process Merges, once you select sets in <strong>Execute</strong> mode a line shows the estimated cost (merge calls + per-set overhead) against the remaining budget. If it would exceed what's left it turns red and warns you to split the run or wait for the daily reset. The check reads the cached budget — it does <strong>not</strong> spend a call.</span></div>
          <div className="defs-row"><span className="defs-term lg">Measured cost &amp; trend</span><span className="defs-body">each merge run records its start/end usage, so the SF API page shows a <em>Recent runs</em> table with the actual calls each run consumed, an intraday usage trend, and a by-activity breakdown — the real numbers that refine the estimate over time.</span></div>
          <div className="defs-gate">Budgets are per-org and reset on a rolling 24-hour basis. The captured trend and per-run cost track <strong>Daily API Requests</strong> (merges, restores, cluster reads); the full data pull runs as a separate job, so its Bulk-API usage shows under <em>Other limits</em> on a live reading rather than in the trend. A live reading needs that environment's Salesforce credentials configured.</div>
        </div>
      </>
    ),
  },
  {
    title: "Staying signed in",
    text: "staying signed in your session stays active as long as you're using the app and expires only after a stretch of inactivity, so a long merge session won't log you out mid-run. if it does lapse, the app sends you back to the login screen rather than failing silently. rolling window every action slides the clock forward; the session ends about 48 hours after your last activity — not 48 hours after you logged in. expired vs not allowed an expired session redirects you to login. being blocked from a specific panel (access denied) is different — that keeps you in the app and just shows the restricted notice.",
    body: (
      <>
        <p>
          Your session stays active as long as you're using the app and expires only after a stretch of
          inactivity, so a long merge session won't log you out mid-run. If it does lapse, the app sends you
          back to the login screen rather than failing silently.
        </p>
        <div className="defs">
          <div className="defs-row"><span className="defs-term lg">Rolling window</span><span className="defs-body">every action slides the clock forward; the session ends about <strong>48 hours</strong> after your last activity — not 48 hours after you logged in.</span></div>
          <div className="defs-row"><span className="defs-term lg">Expired vs not allowed</span><span className="defs-body">an <em>expired</em> session redirects you to login. Being blocked from a specific panel (access denied) is different — that keeps you in the app and just shows the restricted notice.</span></div>
        </div>
      </>
    ),
  },
];

export default function Reference() {
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (sec) => !terms.length || terms.every((t) => (sec.title + ' ' + sec.text).toLowerCase().includes(t));
  const shown = SECTIONS.filter(match);
  return (
    <div className="reference">
      <h2>Reference — how this works</h2>
      <p className="muted small">A plain-language guide to finding duplicates and merging accounts. No jargon.</p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the reference…"
        aria-label="Search the reference"
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', margin: '4px 0 12px', border: '1px solid var(--line, #e4e7ec)', borderRadius: 8, fontSize: 14, background: 'transparent', color: 'inherit' }}
      />
      <div className="ref-scroll" style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', paddingRight: 6 }}>
        {shown.map((sec, i) => (
          <div className="card ref-card" key={i}>
            <h3>{sec.title}</h3>
            {sec.body}
          </div>
        ))}
        {shown.length === 0 && <p className="muted small" style={{ padding: '12px 4px' }}>No sections match “{q}”.</p>}
      </div>
    </div>
  );
}
