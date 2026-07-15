# Merge execution — Node-primary (with Apex as an alternative)

Reference for *how a merge actually runs*. **Node is the primary path**; the Apex REST class in
`apex/` is an optional alternative kept ready-to-deploy. Status: reference / planning — not wired
into a running app yet.

## Master / loser selection rule (deterministic, from the data)

We do **not** pick the master by hand. The `salesforce_merge_id` field holds the **surviving
account's id**, so within a group of accounts that share the same `merge_id`:

- **Winner / master** = the account whose `Id` **equals** the `merge_id` (it points at itself).
- **Loser(s)** = the accounts that share that `merge_id` but whose `Id` **does not equal** it.

```
group accounts by salesforce_merge_id   (ignore blank merge_id)
for each group:
    master = the account where normalize18(Id) == normalize18(merge_id)
    losers = every other account in the group
    merge losers into master
```

**Edge cases to enforce (skip + flag for manual review, never guess):**
- `merge_id` is blank → not a merge target.
- No account in the group has `Id == merge_id` (the master isn't in our data / typo) → flag
  `master_not_found`, do not merge.
- 15- vs 18-char ids → normalize to 18 chars before comparing.
- A group with a master but no losers → nothing to do.
- More than 2 losers → chain: Salesforce merges 1 master + at most 2 per call, so loop the same
  master over the losers in batches of 2.

This rule is applied in Node (it's just grouping + an id comparison), so it works the same
whether the actual merge runs via Node SOAP or via the Apex endpoint.

## Primary path — merge from Node (no Apex)

Salesforce's native merge auto-reparents **all** child objects (standard + custom) to the
master; we call it over SOAP from Node using the existing jsforce session.

```js
// merge one master + up to 2 losers via the native SOAP merge() (no Apex deployed).
async function soap_merge(conn, master_id, loser_ids) {
  const losers = loser_ids.slice(0, 2)
    .map(id => `<urn:recordToMergeIds>${id}</urn:recordToMergeIds>`).join('');
  const body =
`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
   xmlns:urn="urn:partner.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <soapenv:Header><urn:SessionHeader><urn:sessionId>${conn.accessToken}</urn:sessionId></urn:SessionHeader></soapenv:Header>
 <soapenv:Body><urn:merge><urn:request>
   <urn:masterRecord xsi:type="urn:sObject"><urn:type>Account</urn:type><urn:Id>${master_id}</urn:Id></urn:masterRecord>
   ${losers}
 </urn:request></urn:merge></soapenv:Body></soapenv:Envelope>`;
  const res = await fetch(`${conn.instanceUrl}/services/Soap/u/60.0`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': 'merge' },
    body,
  });
  return res.text(); // parse for <success>true</success> / errors
}
```

Driver (selection + chaining + snapshot for restore):

```js
async function merge_group(conn, group) {           // group = accounts sharing one merge_id
  const merge_id = norm18(group[0].salesforce_merge_id);
  const master = group.find(a => norm18(a.Id) === merge_id);
  if (!master) return { status: 'master_not_found', merge_id };
  const losers = group.filter(a => norm18(a.Id) !== merge_id);

  await capture_premerge_snapshot(conn, master, losers); // deep snapshot -> MySQL (for restore)

  for (let i = 0; i < losers.length; i += 2) {           // 2 losers per native call
    await soap_merge(conn, master.Id, losers.slice(i, i + 2).map(a => a.Id));
  }
  return { status: 'merged', master: master.Id, losers: losers.map(a => a.Id) };
}
```

The only thing this gives up vs Apex is that the snapshot and the merge are two steps rather than
one transaction — acceptable because the snapshot is also our backup (see Restore).

## Environment alignment & not merging twice

The tool runs against one loaded dataset; its environment label both identifies the org and selects
the SF login used to write, so the write target always matches the data on screen. Queue entries are
stamped with their environment at add time and the queue persists across Sandbox⇄Production switches.
Re-merges are prevented by four layers: (1) the **alignment guard** skips any set whose stamped
environment/org doesn't match the loaded one (so a Sandbox set can't run against Production, and
vice-versa) — the `org_id` is captured server-side at add time (cached per env, best-effort), so the
org pin is always-on, not just the label; (2) a merged set becomes `done` and isn't reselectable (simulate never changes status);
(3) the per-run **drift re-fetch** skips sets whose records are already gone, and on retry continues
with only the unmerged remainder; (4) Salesforce itself rejects merging a deleted record (recorded
`failed`, never a silent double-merge). The drift check reads the loaded dataset rather than a live
per-record query, so `done` status + refreshing data after merges are the dependable guards for
tool-driven merges; direct-in-Salesforce merges are caught by layer 4 at run time. Full detail +
the `org_id`-capture hardening note live in `../README_MERGE_TOOL.md`.

## Worker reliability — stale-claim reaper

Merges/restores run in the isolated worker, which claims a `salesforce_merge_run` row (flips it to
`running`). If that worker process **dies mid-run** (crash / OOM / reboot / deploy), the row would sit
`running` forever — the in-loop `try/catch` only catches an executor *throw*, not a dead process — and
the UI's progress poll would hang. Guard: every progress update stamps `heartbeat_at`, and the worker
loop calls `merge_run.reap_stale(secs)` each tick. Any run stuck `running` with a heartbeat older than
the threshold is **failed** (label: "stale — worker stopped before finishing; re-select the sets to
retry").

- **Threshold:** `MERGE_WORKER_STALE_SECONDS`, **default 600 s (10 min)**, clamped to a **30 s floor**.
  A live run refreshes its heartbeat on every op (seconds apart), so 10 min of silence unambiguously
  means the worker is gone — wide margin against reaping a slow-but-alive run.
- **Safety:** reaping only fails the *run row* (unsticks the UI). The queued sets stay `approved` and
  can be re-selected; the add-dedup + drift checks prevent double-processing — so it never auto-retries
  a half-written merge. Multi-worker safe (a live run's heartbeat is always fresh).

## Restore — two tiers, both from Node

Salesforce has **no native un-merge** (`undelete` restores one record only). Restore composes an
un-merge from update + undelete + update using the pre-merge snapshot — so the **order matters**.

1. **Within ~15 days (high fidelity):** in this order — **(a) reapply the master's overwritten fields
   FIRST** (frees any unique value survivorship moved onto the survivor, e.g. `cfg_Member_Number__c`,
   so Salesforce won't reject the undelete with "duplicate value found"), **(b) `undelete` each loser**
   from the Recycle Bin (keeps its **original id**; the undelete result is checked), **(c) re-parent
   the snapshotted children** back to it. All Node calls, best-effort per record (a deleted child is
   undeleted-then-re-pointed; unfixable ones are skipped with a note; failures report SF's own reason).
2. **Beyond 15 days, from backup (approximate):** the loser is permanently gone, so recreate it
   from the MySQL deep snapshot (our backup). Recreated records get **new ids**, so external
   references won't reconnect and children are recreated/re-pointed from the snapshot.

**Pre-flight diff + selective restore.** Before confirming, an operator can expand any completed merge
to see a field-by-field diff of the survivor's **current live** values vs the **pre-merge snapshot** —
`store/restore_diff.js` (`diff_for_entry`) via `GET /api/salesforce-merge/merge/restore/diff?id=`,
rendered by `RestoreDiffDetail.jsx`. "In sync" means step (a) would change nothing; differences show
exactly which fields a restore resets, and flag any edited **after** the merge that a blind restore
would overwrite. Equality is normalized (case/whitespace, ZIP→first 5); one live record read per view.
**Selective restore:** each differing field has a **Keep current** checkbox — ticked fields are left at
their live value instead of being reset. The choices flow as `keep_fields` = `{ [queueId]: [fields] }`
into the run; `master_reset_fields(fields, id, keep)` omits kept fields from the survivor patch, and
`restore()` reports `reset_fields` / `kept_fields`. This per-field review is the restore analogue of the
merge drift acknowledgment. Full spec + as-built in `../README_RESTORE_DIFF.md`.

## Merge drift check (staged → live)

Adding a set to the queue captures a **stage-time baseline** — the field values the reviewer saw —
into `salesforce_merge_stage_baseline` (`store/merge_stage_baseline.js`, keyed by `queue_id`,
populated by the single-add route from the payload the frontend sends). At process time (both
simulate and execute) `merge_execute.runQueue` loads that baseline and diffs it against the freshly
fetched live records (`compute_drift` → reuses `restore_diff.build_master_diff`, normalized equality).
Any changed field is **drift**: surfaced live in the progress `current_label`
("⚠ N field(s) changed since staged"), on the run result (`out.drift`, per-set `drift_fields` /
`drift_detail`), in history reasons, and as an amber per-set badge on Process Merges.

**Canonical comparison.** Records arrive in two shapes — the local snapshot (`first_name`, `email`,
`member_number` …) or a live SF fetch (`FirstName`, `PersonEmail`, `cfg_Member_Number__pc` …). Drift
maps both sides to a fixed canonical identity field set before diffing (`compute_drift` → `canonical`),
so a shape difference never reads as a false change. This is what lets the baseline be captured cheaply
from the local snapshot. **Scope:** the check covers the core identity fields only — first/last name,
email, phone, member number, gender, birthdate, ZIP, city/state/street, merge id (the keys in `CANON`).
It is intentionally NOT every field: the two shapes only share these, the bulk baseline (local snapshot)
only stores these, and these are the fields that determine whether the merge target is still correct.
Editing a non-identity field reads as "no drift". Widening it means extending `CANON` (and, for bulk,
the snapshot columns).

**Baseline capture — single and bulk.** Single-add stores the exact reviewed values (frontend payload).
Bulk-add captures the baseline server-side from the local snapshot for every newly-queued set
(`add_many` returns the new ids; the bulk route batches one `accounts_by_ids` read and saves a baseline
per set). So both paths get a drift check.

**Acknowledgment gate (execute).** By default, Execute **skips** any set whose reviewed fields drifted
(`result: skipped`, `out.drift_blocked`, left *approved* so it can be re-run) — only clean sets merge.
After a Simulate reveals drift, the operator ticks a "I've reviewed the changes — merge anyway" box on
Process Merges, which passes `ack_drift` and lets drifted sets through. Clean sets are unaffected either
way. Bulk-added sets have a baseline too, so the gate applies to them. (Simulate never gates; it only
reports.)

**Not restored — managed-package byproducts.** A merge can trigger a managed package (namespace
`em4sf`) to create + delete its own **"Queue Item" (`QI-…`) job records**, which appear in the Recycle
Bin. They have no Account relationship, aren't in the snapshot, and are neither restored nor touched —
same category as the SFMC caveat.

The **deep pre-merge snapshot** powers both: before merging, Node `describe`s the Account child
relationships, queries each child's id + parent for the losers, and stores it (plus full loser
fields + master field values) in `salesforce_merge_premerge_snapshot`.

## Preserving loser contact info (Person Account alternates → Contact Points)

These are Person Accounts, so the winner can't hold extra Contact records. To avoid losing a
loser's email / phone / address that differs from the winner's, we preserve it as **Contact
Point** records on the surviving account — the standard objects built for multiple values per
party: `ContactPointEmail`, `ContactPointPhone`, `ContactPointAddress`.

This is **not** part of the native merge — our tool does it as a post-merge step from the
pre-merge snapshot (all Node/jsforce, no Apex):

1. Native merge runs (winner keeps its primary fields; all related records reparent).
2. From the snapshot, for each loser contact value the winner does **not** already have (as its
   primary value or an existing Contact Point), `insert` a Contact Point on the surviving account.
3. De-dupe — never create a Contact Point that duplicates a value the winner already has.

### Conditional preservation by flag (e.g. donor)

Preservation can be gated by **high-value flags**, so we only keep alternates when they matter.
Rather than hard-coding "donor," use a small **configurable list** of high-value flags (e.g.
donor, major member, board member, …):

- `preserve_contact_points`: `always` | `conditional` | `never`
- `high_value_flags`: the list of account flag fields that trigger preservation (donor, major
  member, …) — easy to extend.
- when `conditional`, preserve if **any** high-value flag is set on the loser (or winner, or
  either — configurable side).

Example default policy:

> Preserve a loser's differing email / phone / address as Contact Points **whenever the loser or
> the winner has any high-value flag set** (donor, major member, …); otherwise discard
> loser-only contact values. Always de-dupe against values the winner already has.

```js
// post-merge, from the snapshot (illustrative)
const HIGH_VALUE_FLAGS = ['donor', 'major_member'];   // extend as needed
const has_high_value = (rec) => HIGH_VALUE_FLAGS.some(f => is_set(rec, f));

function should_preserve(winner, loser) {
  if (POLICY === 'always') return true;
  if (POLICY === 'never')  return false;
  return has_high_value(loser) || has_high_value(winner);   // conditional: any flag, either side
}
// for each loser email/phone/address not already on the winner -> insert ContactPoint*
```

Shown in the preview: each loser contact value gets an outcome — *already on winner (skip)*,
*preserve as Contact Point* (with the reason, e.g. "loser is a donor"), or *discard*.

### Decisions
- Storage target: **Contact Point objects** (decided).
- Donor flag — confirm the field's API name and which side triggers preservation
  (loser / winner / either).
- Default when no flag matches: discard loser-only contact values, or always preserve?

## Alternative path — Apex REST wrapper

If we later want snapshot + merge to be atomic in one Salesforce transaction, deploy the class in
`apex/` and call it instead of `soap_merge`. Same selection rule, same native merge underneath.
See `apex/DEPLOY.md` for how to add it to a sandbox and production.

## To confirm

- That `salesforce_merge_id` stores the surviving **Account** id (Person-Account `__pc` view),
  so `Id == merge_id` is an apples-to-apples comparison.
- 15/18-char handling (we normalize to 18 before comparing).
