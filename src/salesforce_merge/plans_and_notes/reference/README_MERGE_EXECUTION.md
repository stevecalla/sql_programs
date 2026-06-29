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
vice-versa); (2) a merged set becomes `done` and isn't reselectable (simulate never changes status);
(3) the per-run **drift re-fetch** skips sets whose records are already gone, and on retry continues
with only the unmerged remainder; (4) Salesforce itself rejects merging a deleted record (recorded
`failed`, never a silent double-merge). The drift check reads the loaded dataset rather than a live
per-record query, so `done` status + refreshing data after merges are the dependable guards for
tool-driven merges; direct-in-Salesforce merges are caught by layer 4 at run time. Full detail +
the `org_id`-capture hardening note live in `../README_MERGE_TOOL.md`.

## Restore — two tiers, both from Node

1. **Within ~15 days (high fidelity):** `undelete` each loser from the Recycle Bin (keeps its
   **original id**), then re-parent the snapshotted children back to it and reapply overwritten
   master fields. All Node calls.
2. **Beyond 15 days, from backup (approximate):** the loser is permanently gone, so recreate it
   from the MySQL deep snapshot (our backup). Recreated records get **new ids**, so external
   references won't reconnect and children are recreated/re-pointed from the snapshot.

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
