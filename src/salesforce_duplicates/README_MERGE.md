# Salesforce Duplicate Merge and Unmerge Planning

## Summary

Salesforce Account merges are not natively reversible in a clean “undo” way. When Accounts are merged, the master Account survives, the duplicate or losing Account is deleted, and related records are generally re-parented to the master Account.

Because of that, any automated or bulk dedupe/merge process should be designed with unmerge or reversal in mind from the beginning. This is especially important if upstream systems may later send corrected data, recreate records, or require the original Account structure to be restored and synced back downstream.

The key design point is that unmerge should not rely on guesswork. The dedupe/merge process should intentionally capture the pre-merge state so that a reversal script can know exactly which records belonged to which Account before the merge.

## Reference

[ChatGPT conversation: Salesforce duplicate merge and unmerge planning](https://chatgpt.com/c/6a210e4e-e174-83e8-b016-91ad9109fb4b)


---

## Recommended Process

### 1. Use Node to Identify Duplicate Candidates

Use Node or another external process to identify duplicate candidates before anything is merged.

The Node process can:

* Apply custom duplicate scoring logic
* Group likely duplicates
* Select a proposed master or surviving Account
* Assign confidence scores
* Record merge reasons
* Flag high-risk matches for human review

High-risk matches should not be merged automatically without review.

---

### 2. Create a Full Pre-Merge Backup Package

Before any merge occurs, create a full backup package.

The backup should include:

* Master Account
* Losing Account or Accounts
* Account History
* Contact relationships
* Opportunity relationships
* Case relationships
* Task relationships
* Event relationships
* File and Note links
* Campaign Members, if relevant
* Custom objects related to Account

The backup should capture both record values and relationship ownership before the merge.

The most important file is the child relationship map, because it tells the reversal process which records belonged to which Account before the merge.

Example backup files:

```text
merge_run_2026_06_03_001/
  account_merge_plan.csv
  account_before_snapshot.csv
  account_history_before_snapshot.csv
  child_relationships_before_merge.csv
  contacts_before_merge.csv
  opportunities_before_merge.csv
  cases_before_merge.csv
  tasks_events_before_merge.csv
  files_notes_before_merge.csv
  custom_child_objects_before_merge.csv
  merge_results.csv
  manifest.json
```

---

### 3. Store Backup Files Outside Salesforce

Raw backup files should usually be stored outside Salesforce.

Recommended storage options:

* Amazon S3
* Azure Blob Storage
* Google Cloud Storage
* Box
* Secure server folder

Salesforce can store audit metadata and optional backup attachments, but Salesforce should not be the only backup location.

A good split is:

```text
Raw backup files:
S3 / Azure Blob / GCS / Box / secure server folder

Salesforce audit records:
Account_Merge_Audit__c
Account_Merge_Audit_Item__c

Optional Salesforce attachment:
manifest.json or zipped backup package attached as a Salesforce File
```

---

## Salesforce Audit Objects

### Account_Merge_Audit__c

Create a parent audit object to track the merge event.

Suggested fields:

```text
Merge_Run_Id__c
Duplicate_Group_Id__c
Master_Account__c
Losing_Account_Id__c
Losing_Account_Name__c
Match_Score__c
Match_Method__c
Merge_Reason__c
Backup_File_Url__c
Backup_File_Checksum__c
Backup_Storage_Location__c
Merge_Status__c
Merge_Error__c
Merged_At__c
Merged_By_Process__c
Reversal_Status__c
Reversed_At__c
```

---

### Account_Merge_Audit_Item__c

Create child audit rows for each related record that may need to be restored during an unmerge.

Suggested fields:

```text
Merge_Run_Id__c
Duplicate_Group_Id__c
Object_API_Name__c
Record_Id__c
Relationship_Field__c
Original_Account_Id__c
Post_Merge_Account_Id__c
Restore_Action__c
Restore_Status__c
Restore_Error__c
```

Example relationship map rows:

```text
merge_run_id,duplicate_group_id,object_api_name,record_id,relationship_field,original_account_id,post_merge_account_id,restore_required_flag
run_2026_06_03_001,group_55,Contact,003xxx,AccountId,losing_account_id,master_account_id,true
run_2026_06_03_001,group_55,Opportunity,006xxx,AccountId,losing_account_id,master_account_id,true
run_2026_06_03_001,group_55,Case,500xxx,AccountId,losing_account_id,master_account_id,true
```

---

## Recommended Code Architecture

A good technical architecture would be:

```text
Node duplicate detection
  → merge candidate table
  → human review / approval if needed
  → pre-merge backup export
  → Salesforce merge audit records
  → Apex merge execution
  → merge result logging
  → downstream sync notification
  → optional unmerge / reversal script if needed
```

---

## Role of Node

Use Node for:

* Duplicate detection
* Duplicate scoring
* Backup generation
* Audit orchestration
* External file storage
* Integration sync logic
* Reversal/unmerge scripting

Node is a good fit because it can produce transparent files, run repeatable logic, and integrate with external storage and upstream/downstream systems.

---

## Role of Apex

Use Apex for the actual Salesforce merge.

Recommended approach:

* Node identifies and approves the merge plan
* Node creates the backup package
* Node creates Salesforce audit records
* Node calls a custom Apex REST endpoint
* Apex performs the Salesforce-native merge
* Apex returns merge results
* Node updates the audit records

Example endpoint concept:

```text
/services/apexrest/account-merge
```

The Apex endpoint would receive:

```json
{
  "merge_run_id": "run_2026_06_03_001",
  "duplicate_group_id": "group_55",
  "master_account_id": "001MASTER",
  "losing_account_ids": ["001LOSING1", "001LOSING2"]
}
```

Important rule:

```text
If the backup or audit record creation fails, the merge should not happen.
```

---

## Unmerge / Reversal Process

An unmerge should be treated as a scripted recovery process, not a simple Salesforce undo.

A reversal process would generally do the following:

```text
1. Locate the original merge_run_id.
2. Read the pre-merge backup package.
3. Restore or recreate the losing Account.
4. Restore losing Account field values.
5. Move child records back from the master Account to the restored losing Account using the saved child relationship map.
6. Update audit records with reversal status.
7. Trigger or queue sync updates for upstream and downstream systems.
```

The reversal script should use the saved relationship map to know exactly which records belonged to the losing Account before the merge.

Without that relationship map, unmerge becomes manual, difficult, and potentially incomplete.

---

## Upstream and Downstream System Sync

If upstream systems may later send corrected data or refer to the old Account structure, the merge process should maintain a durable ID mapping table.

Suggested mapping fields:

```text
Old_Losing_Account_Id__c
Surviving_Master_Account_Id__c
Merge_Run_Id__c
External_System_Id__c
External_Record_Id__c
Merge_Status__c
Reversal_Status__c
Restored_Account_Id__c
Sync_Status__c
Last_Sync_At__c
```

This mapping is critical because after Salesforce merges Accounts, the losing Salesforce Account ID may no longer behave like an active record.

If an upstream system later sends data tied to the old Account ID or external ID, the integration needs to know whether to:

* Route the update to the surviving master Account
* Reject it for manual review
* Recreate or restore the losing Account
* Trigger an unmerge/recovery workflow

---

## Practical Rules for Merge Safety

Before performing any automated merge, the process should confirm:

* Backup package was created successfully
* Backup checksum was recorded
* Salesforce audit records were created
* Child relationship map was captured
* Merge candidate was approved or met auto-merge confidence threshold
* Master Account was selected according to agreed rules
* Losing Account IDs were mapped to the surviving Account
* Upstream/downstream sync impact was recorded

Recommended safety rule:

```text
No backup → no merge.
No child relationship map → no merge.
No audit record → no merge.
```

---

## Tool Considerations

Apsona appears to support duplicate identification and merging, but it should not be assumed to support true reverse merge or unmerge.

If unmerge is a hard requirement, evaluate tools such as:

* Traction Complete / Complete Clean
* DemandTools
* ZaapIT
* Insycle

The proof of concept should test both merge and unmerge using realistic Salesforce Account records with:

* Contacts
* Opportunities
* Cases
* Tasks
* Events
* Files
* Notes
* Campaign Members
* Custom Account-related objects

The POC should confirm whether the tool can restore the losing Account, restore field values, and move related records back correctly.

---

## Recommended Final Approach

For a custom Node-based dedupe process, the recommended approach is:

```text
Use Node for duplicate detection, backup, audit orchestration, and reversal scripting.

Use Apex for the actual Salesforce merge.

Store raw backup files outside Salesforce.

Store searchable audit records inside Salesforce.

Maintain an ID mapping table for upstream and downstream integrations.

Build the unmerge process before allowing automated or bulk merges.
```

This approach gives the organization a controlled merge process while preserving the ability to recover if an upstream system, business process, or user later determines that the merge was incorrect.

---

## Merge id on the dedupe outputs (implemented)

The duplicate-detection outputs now carry the Account merge field
`usat_Salesforce_Merge_Id__pc` (created on Contact as `usat_Salesforce_Merge_Id__c`,
surfaced on Account as `__pc`; the pipeline queries Account so it uses `__pc`). It
appears as `Merge_Id_1__c`/`Merge_Id_2__c` in the pair files and `Merge_Ids__c` in the
group/cluster files. The field is optional in the query — the run DESCRIBEs Account and includes it only
if the org has it (so a sandbox-before-prod rollout still runs, with blank merge
columns until the field exists). It is blank until Salesforce populates the field, then fills
automatically — giving the merge/unmerge workflow described above a stable id to key
on. Confirm the exact API name with `discover_account_fields.js` (menu item 29).
