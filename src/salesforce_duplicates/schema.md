# Salesforce Duplicate Detection Import Schema Inventory

## Purpose

This document inventories the Salesforce-compatible output files produced by the duplicate detection Node.js process.

The process creates **one Salesforce-import-compatible version** of each output file. These CSV headers are written using Salesforce-style custom field API names, such as `Run_Id__c`, `Match_Type__c`, and `Created_At_Utc__c`.

The files are intended to be loaded into Salesforce custom objects for duplicate review, reporting, and workflow management.

## Source data fetch

The `Account` records the detection runs on are read from Salesforce by
`src/salesforce.js`. The method depends on run mode: `--test` uses a REST
`autoFetch` query (capped at `MAX_FETCH`, for a quick dev-sandbox pull), and
`--prod` uses the **Bulk API** (`conn.bulk2.query`) to pull the full ~700k-record
set in a few large transfers rather than REST paging 2,000 at a time.

The `--test` query is **ordered** (`ORDER BY LastName, FirstName, Id`) so the capped
sample is deterministic; the `--prod` query is **unordered** so Salesforce streams
records without sorting the whole result set first (the slowest part of a full
fetch). Detection needs no particular input order — exact matching uses a hash Map,
fuzzy matching uses rule-block buckets, and outputs are sorted in code.

The fetch is read-only — it never updates, merges, or deletes anything in Salesforce.

### Approximating the exact rule in SOQL

The **exact** rule can be approximated natively in SOQL with
`GROUP BY ... HAVING COUNT(Id) > 1` over last name, first name, gender, birthdate,
and ZIP — useful for a quick in-platform count. SOQL has no string functions, so it
cannot trim the ZIP to 5 digits (`LEFT()`/`SUBSTRING()` are unavailable and
`GROUP BY` rejects expressions), fall back to mailing ZIP, or uppercase/trim names.
To get the ZIP trim natively, add an Account **formula field** `Zip5__c` =
`LEFT(BLANKVALUE(BillingPostalCode, PersonMailingPostalCode), 5)` and group on it
(formula fields are allowed in `GROUP BY`). The Node tool recreates this logic in
code so it can also normalize names and run the **fuzzy**/**nickname** passes (which
have no SOQL equivalent) on the same normalized values. Full query examples are in
`README.md` → "Expressing the Exact Rule as a SOQL Query".

## Output Files

| File | Purpose | Suggested Salesforce Use |
|---|---|---|
| `account_duplicates_sf_import.csv` | Exact duplicate groups | Load to duplicate result/review object |
| `account_fuzzy_name_matches_sf_import.csv` | Pair-level fuzzy matches | Load to duplicate result/review object or keep as detailed support file |
| `account_fuzzy_name_groups_sf_import.csv` | Grouped fuzzy duplicate clusters | Load to duplicate result/review object for review workflow |
| `account_nickname_name_matches_sf_import.csv` | Pair-level nickname matches (Bob~Robert) | Single-signal review lens. Review-only today; SF-ready columns |
| `account_nickname_name_groups_sf_import.csv` | Grouped nickname clusters (Bob;Bobby;Robert) | Single-signal group lens, mirrors the fuzzy group file. Review-only |
| `account_consolidated_duplicates_sf_import.csv` | Reconciled clusters (exact + fuzzy + nickname) | The authoritative review/action file. Review-only today; SF-ready columns |

> **Review-only today, SF-ready.** The nickname (c) and consolidated (d) files are
> not currently imported into Salesforce — they are analysis CSVs. Their columns
> still use the `__c` naming convention so a future import needs no rework. Produced
> only when `ENABLE_NICKNAME_MATCHING` is on (default).
>
> **Merge id.** Every output now carries the Account merge field
> `usat_Salesforce_Merge_Id__pc` as `Merge_Id_1__c`/`Merge_Id_2__c` (pair files) or
> `Merge_Ids__c` (group/cluster files). It is a Person-Account field: created on
> Contact as `usat_Salesforce_Merge_Id__c`, surfaced on Account as `__pc`. The
> pipeline queries Account, so it uses the `__pc` name. The field is **optional** —
> the query DESCRIBEs Account and includes it only if the org has it, so an org
> without it still runs (merge columns blank). It is picked up automatically once an
> admin adds it, and fills as Salesforce populates values.

> **Positional list columns.** In the group/cluster files the per-record list
> columns — `Member_Numbers__c`, `Merge_Ids__c`, `Foundation_Constituent_Values__c`
> (and `Foundation_Constituents__c`) — carry **exactly one entry per record, blank
> when empty**, in the **same order as `Record_Ids__c`**. So position *i* across all
> of them is the same record. (They are not de-duplicated.)

## Recommended Salesforce Objects

A practical Salesforce model would use two custom objects:

### `Duplicate_Run__c`

One record per script run.

This object stores run-level summary information, such as run ID, start time, status, total records scanned, exact duplicate counts, fuzzy match counts, and links to attached output files.

### `Duplicate_Result__c`

One record per duplicate candidate row.

This object stores the rows from the three output files. The `Match_Type__c` field identifies whether each row is an exact group, fuzzy pair, or fuzzy group.

Recommended `Match_Type__c` values:

| Value | Meaning |
|---|---|
| `exact_group` | Exact duplicate group |
| `fuzzy_pair` | Pair-level fuzzy name match |
| `fuzzy_group` | Grouped fuzzy cluster |
| `nickname_pair` | Pair-level nickname match (file c) |
| `nickname_group` | Grouped nickname cluster (file c-group) |
| `consolidated_cluster` | Reconciled cluster across all signals (file d) |

## Common Import Fields

These fields appear in all three Salesforce-compatible output files.

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Run_Id__c` | Text, External ID optional | Identifies the script run that produced the row. All rows from the same run share the same value. |
| `External_Id__c` | Text, External ID, Unique recommended | Stable unique key for upsert. Built from run ID, match type, and a hashed unique value. |
| `Match_Type__c` | Picklist | Identifies the output category: `exact_group`, `fuzzy_pair`, or `fuzzy_group`. |
| `Source_File_Name__c` | Text | Name of the CSV file that produced the row. |
| `Review_Status__c` | Picklist | Workflow status for duplicate review. Default is `New`. |
| `Row_Number__c` | Number | Row number within the output file. |
| `Run_Start_Time__c` | Date/Time or Text | Script start timestamp in UTC. |
| `Query_Start_Time__c` | Date/Time or Text | Salesforce query start timestamp in UTC. |
| `Query_End_Time__c` | Date/Time or Text | Salesforce query end timestamp in UTC. |
| `Query_Duration__c` | Text | Human-readable query duration, such as `3s` or `2m 14s`. |
| `Created_At_Mtn__c` | Text | Run-created timestamp in Mountain Time. Uses `America/Denver`, so daylight saving time is handled as MST/MDT. |
| `Created_At_Utc__c` | Date/Time or Text | Run-created timestamp in UTC. This is intentionally the final column in each output file. |

## Recommended Review Status Values

For `Review_Status__c`, use a picklist such as:

| Value | Purpose |
|---|---|
| `New` | Newly generated duplicate candidate |
| `Needs Review` | Requires manual review |
| `Confirmed Duplicate` | Reviewer confirmed it is likely a duplicate |
| `Not Duplicate` | Reviewer determined it is not a duplicate |
| `Merged` | Duplicate has been resolved/merged |
| `Ignored` | Reviewer intentionally ignored the candidate |
| `Error` | Candidate has a data or process issue |

## File 1: `account_duplicates_sf_import.csv`

This file contains exact duplicate groups.

A group is included when multiple Account records share the same exact duplicate key:

```text
Exact First Name
+ Exact Last Name
+ Exact Gender
+ Exact Birthdate
+ Exact Composite ZIP
```

### Exact Duplicate Schema

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Run_Id__c` | Text | Run identifier shared by all rows in the run. |
| `External_Id__c` | Text, External ID, Unique | Upsert key for this exact duplicate group. |
| `Match_Type__c` | Picklist | Always `exact_group` for this file. |
| `Source_File_Name__c` | Text | Always `account_duplicates_sf_import.csv`. |
| `Review_Status__c` | Picklist | Default review status, usually `New`. |
| `Row_Number__c` | Number | Row number in the exact duplicate output. |
| `Run_Start_Time__c` | Date/Time or Text | Script run start timestamp. |
| `Query_Start_Time__c` | Date/Time or Text | Salesforce query start timestamp. |
| `Query_End_Time__c` | Date/Time or Text | Salesforce query end timestamp. |
| `Query_Duration__c` | Text | Human-readable query duration. |
| `Duplicate_Logic__c` | Long Text Area | Description of the exact duplicate logic used. |
| `Last_Name__c` | Text | Shared last name for the exact duplicate group. |
| `First_Name__c` | Text | Shared first name for the exact duplicate group. |
| `Gender__c` | Text or Picklist | Shared gender value for the group. |
| `Birthdate__c` | Date | Shared birthdate for the group. |
| `Composite_Zip__c` | Text | Shared composite ZIP for the group. Composite ZIP uses Billing ZIP when present, otherwise Person Mailing ZIP, then trims US ZIPs to the first 5 digits (e.g. `80919-1234` -> `80919`; non-US codes left intact). |
| `Duplicate_Count__c` | Number | Number of Account records in the exact duplicate group. |
| `Record_Ids__c` | Long Text Area | Semicolon-delimited Salesforce Account IDs in the group. |
| `Member_Numbers__c` | Long Text Area | Semicolon-delimited member numbers in the group. |
| `Created_At_Mtn__c` | Text | Created timestamp in Mountain Time. |
| `Created_At_Utc__c` | Date/Time or Text | Created timestamp in UTC. |

## File 2: `account_fuzzy_name_matches_sf_import.csv`

This file contains pair-level fuzzy matches.

Each row compares two Account records.

A pair qualifies when:

```text
Name similarity score >= threshold
AND same gender
AND same birthdate
AND same composite ZIP
AND both records are not already included in the exact duplicate file
AND cleaned first and last names are not both exact matches
```

### Fuzzy Pair Schema

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Run_Id__c` | Text | Run identifier shared by all rows in the run. |
| `External_Id__c` | Text, External ID, Unique | Upsert key for this fuzzy pair. |
| `Match_Type__c` | Picklist | Always `fuzzy_pair` for this file. |
| `Source_File_Name__c` | Text | Always `account_fuzzy_name_matches_sf_import.csv`. |
| `Review_Status__c` | Picklist | Default review status, usually `New`. |
| `Row_Number__c` | Number | Row number in the fuzzy pair output. |
| `Run_Start_Time__c` | Date/Time or Text | Script run start timestamp. |
| `Query_Start_Time__c` | Date/Time or Text | Salesforce query start timestamp. |
| `Query_End_Time__c` | Date/Time or Text | Salesforce query end timestamp. |
| `Query_Duration__c` | Text | Human-readable query duration. |
| `Fuzzy_Start_Time__c` | Date/Time or Text | Fuzzy matching start timestamp. |
| `Fuzzy_End_Time__c` | Date/Time or Text | Fuzzy matching end timestamp. |
| `Fuzzy_Duration__c` | Text | Human-readable fuzzy matching duration. |
| `Rule_Key__c` | Text | Blocking key used for fuzzy comparison. Built from gender, birthdate, and composite ZIP. |
| `Fuzzy_Threshold__c` | Number | Minimum combined name score required to qualify as a fuzzy match. |
| `Fuzzy_Match_Reason__c` | Long Text Area | Human-readable explanation of why the pair matched. |
| `Name_Difference_Reason__c` | Long Text Area | Explanation of name differences after cleaning. |
| `First_Name_Difference_Reason__c` | Long Text Area | Explanation of first-name difference. |
| `Last_Name_Difference_Reason__c` | Long Text Area | Explanation of last-name difference. |
| `Rule_Match_Reason__c` | Long Text Area | Explanation of the matching rule fields. |
| `Match_Score_Combined_Name__c` | Number | Weighted combined fuzzy score for first and last name. |
| `Match_Score_First_Name__c` | Number | Fuzzy score for first name only. |
| `Match_Score_Last_Name__c` | Number | Fuzzy score for last name only. |
| `Exact_Clean_First_Name_Match_Flag__c` | Checkbox or Number | Indicates whether cleaned first names matched exactly. |
| `Exact_Clean_Last_Name_Match_Flag__c` | Checkbox or Number | Indicates whether cleaned last names matched exactly. |
| `Same_Gender_Flag__c` | Checkbox or Number | Indicates whether gender matched. |
| `Same_Birthdate_Flag__c` | Checkbox or Number | Indicates whether birthdate matched. |
| `Same_Composite_Zip_Flag__c` | Checkbox or Number | Indicates whether composite ZIP matched. |
| `Strict_Rule_Match_Flag__c` | Checkbox or Number | Indicates whether gender, birthdate, and composite ZIP all matched. |
| `Rule_Match_Count__c` | Number | Count of matched rule fields. Maximum is 3. |
| `Account_1__c` | Lookup(Account) or Text | Salesforce Account ID for first record. Use Lookup(Account) if importing into Salesforce. |
| `Member_Number_1__c` | Text | Member number for first record. |
| `First_Name_1__c` | Text | First name for first record. |
| `Last_Name_1__c` | Text | Last name for first record. |
| `Full_Name_1__c` | Text | Full name for first record. |
| `Clean_Full_Name_1__c` | Text | Cleaned full name for first record. |
| `Gender_1__c` | Text or Picklist | Gender for first record. |
| `Birthdate_1__c` | Date | Birthdate for first record. |
| `Composite_Zip_1__c` | Text | Composite ZIP for first record. |
| `Billing_Zip_1__c` | Text | Billing ZIP for first record. |
| `Mailing_Zip_1__c` | Text | Person Mailing ZIP for first record. |
| `Account_2__c` | Lookup(Account) or Text | Salesforce Account ID for second record. Use Lookup(Account) if importing into Salesforce. |
| `Member_Number_2__c` | Text | Member number for second record. |
| `First_Name_2__c` | Text | First name for second record. |
| `Last_Name_2__c` | Text | Last name for second record. |
| `Full_Name_2__c` | Text | Full name for second record. |
| `Clean_Full_Name_2__c` | Text | Cleaned full name for second record. |
| `Gender_2__c` | Text or Picklist | Gender for second record. |
| `Birthdate_2__c` | Date | Birthdate for second record. |
| `Composite_Zip_2__c` | Text | Composite ZIP for second record. |
| `Billing_Zip_2__c` | Text | Billing ZIP for second record. |
| `Mailing_Zip_2__c` | Text | Person Mailing ZIP for second record. |
| `Not_In_Exact_Duplicate_File_Flag__c` | Checkbox or Number | Indicates the pair was not already included in the exact duplicate output. |
| `Fuzzy_Match_Logic__c` | Long Text Area | Description of the fuzzy matching logic. |
| `Created_At_Mtn__c` | Text | Created timestamp in Mountain Time. |
| `Created_At_Utc__c` | Date/Time or Text | Created timestamp in UTC. |

## File 3: `account_fuzzy_name_groups_sf_import.csv`

This file contains grouped fuzzy clusters.

The fuzzy group output is built from connected fuzzy pairs. If Account A matches Account B, and Account B matches Account C, then A, B, and C are placed in the same fuzzy group.

### Fuzzy Group Schema

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Run_Id__c` | Text | Run identifier shared by all rows in the run. |
| `External_Id__c` | Text, External ID, Unique | Upsert key for this fuzzy group. |
| `Match_Type__c` | Picklist | Always `fuzzy_group` for this file. |
| `Source_File_Name__c` | Text | Always `account_fuzzy_name_groups_sf_import.csv`. |
| `Review_Status__c` | Picklist | Default review status, usually `New`. |
| `Row_Number__c` | Number | Row number in the fuzzy group output. |
| `Run_Start_Time__c` | Date/Time or Text | Script run start timestamp. |
| `Query_Start_Time__c` | Date/Time or Text | Salesforce query start timestamp. |
| `Query_End_Time__c` | Date/Time or Text | Salesforce query end timestamp. |
| `Query_Duration__c` | Text | Human-readable query duration. |
| `Fuzzy_Start_Time__c` | Date/Time or Text | Fuzzy matching start timestamp. |
| `Fuzzy_End_Time__c` | Date/Time or Text | Fuzzy matching end timestamp. |
| `Fuzzy_Duration__c` | Text | Human-readable fuzzy matching duration. |
| `Fuzzy_Group_Key__c` | Long Text Area or Text | Group key made from sorted connected Account IDs. |
| `Group_Record_Count__c` | Number | Number of Account records in the fuzzy group. |
| `Shared_Gender__c` | Text or Picklist | Shared gender value for the fuzzy group. |
| `Shared_Birthdate__c` | Date | Shared birthdate for the fuzzy group. |
| `Shared_Composite_Zip__c` | Text | Shared composite ZIP for the fuzzy group. |
| `Names_In_Group__c` | Long Text Area | Semicolon-delimited full names in the group. |
| `Clean_Names_In_Group__c` | Long Text Area | Semicolon-delimited cleaned full names in the group. |
| `Record_Ids__c` | Long Text Area | Semicolon-delimited Account IDs in the group. |
| `Member_Numbers__c` | Long Text Area | Semicolon-delimited member numbers in the group. |
| `Best_Pair_Score__c` | Number | Highest fuzzy pair score within the group. |
| `Lowest_Pair_Score__c` | Number | Lowest fuzzy pair score within the group. |
| `Fuzzy_Pair_Count_In_Group__c` | Number | Number of fuzzy pair links inside the group. |
| `Fuzzy_Pair_Summary__c` | Long Text Area | Summary of pair links and scores inside the group. |
| `Fuzzy_Group_Logic__c` | Long Text Area | Description of how the fuzzy group was built. |
| `Created_At_Mtn__c` | Text | Created timestamp in Mountain Time. |
| `Created_At_Utc__c` | Date/Time or Text | Created timestamp in UTC. |

## File 4: `account_nickname_name_matches_sf_import.csv`

Single-signal nickname view. Pair-level rows where the first names are
nickname-equivalent (Bob ~ Robert) per the `nicknames-curated` dataset, the last
name still agrees (exact cleaned, or fuzzy score >= `NICKNAME_LAST_NAME_MIN_SCORE`),
and the strict gender + birthdate + composite ZIP gate holds. Generated over the
**complete** rule-eligible pool (exact-duplicate records are not removed), so a row
may involve a record that is also an exact duplicate — flagged below.

### Nickname Pair Schema (selected fields)

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Match_Type__c` | Picklist | Always `nickname_pair` for this file. |
| `Match_Path__c` | Picklist/Text | `nickname` (primary label; if the pair also clears spelling, that is recorded in the flags below). |
| `Nickname_Match_Reason__c` | Long Text Area | Why the first names are nickname-equivalent (curated list / shared canonical). |
| `Match_Score_First_Name__c` / `Match_Score_Last_Name__c` / `Match_Score_Combined_Name__c` | Number | Levenshtein scores for context. |
| `Nickname_Match_Flag__c` | Checkbox/Number | Always 1 in this file. |
| `Spelling_Match_Flag__c` / `Also_Clears_Fuzzy_Flag__c` | Checkbox/Number | Whether the pair would also pass the fuzzy(90) spelling threshold. |
| `In_Exact_Group_Flag__c` | Checkbox/Number | Whether one of the two records is also an exact duplicate. |
| `Account_1__c` … `Foundation_Constituent_2__c` | — | Same per-record columns as the fuzzy pair file. |
| `Nickname_Logic__c` | Long Text Area | Description of the nickname rule. |

## File 5: `account_consolidated_duplicates_sf_import.csv`

Reconciled, authoritative view: one row per connected **cluster**, built by unioning
exact + fuzzy(90) + nickname edges generated over the complete rule-eligible pool.
This is the file to review/act on.

A "link" here is a matched pair of records inside the cluster; the cluster is those
records joined up by all their links.

### Consolidated Cluster Schema

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Match_Type__c` | Picklist | Always `consolidated_cluster` for this file. |
| `Consolidated_Group_Key__c` | Long Text Area | Sorted Account IDs in the cluster. |
| `Group_Record_Count__c` | Number | Records in the cluster (named to match the other group files). |
| `Confidence_Tier__c` | Picklist | Strongest signal present: `exact` > `fuzzy` > `nickname`. |
| `Match_Composition__c` | Picklist/Text | One readable label of the signal mix: `exact only`, `fuzzy only`, `nickname only`, `exact + fuzzy`, `exact + nickname`, `fuzzy + nickname`, or `exact + fuzzy + nickname`. |
| `Has_Exact_Flag__c` / `Has_Fuzzy_Flag__c` / `Has_Nickname_Flag__c` | Checkbox/Number | Which signals contributed any link (non-exclusive booleans). |
| `Exact_Link_Count__c` / `Fuzzy_Link_Count__c` / `Nickname_Link_Count__c` | Number | Matched-pair (link) counts by signal. |
| `Match_Link_Count__c` | Number | Total matched pairs (links) in the cluster. |
| `Shared_Gender__c` / `Shared_Birthdate__c` / `Shared_Composite_Zip__c` | — | Shared rule fields for the cluster. |
| `Names_In_Group__c` / `Clean_Names_In_Group__c` | Long Text Area | Semicolon-delimited names (positional). |
| `Record_Ids__c` / `Member_Numbers__c` / `Merge_Ids__c` / `Foundation_Constituents__c` | Long Text Area | Semicolon-delimited member data (positional, one per record). |
| `Best_Pair_Score__c` / `Lowest_Pair_Score__c` | Number | Score range across fuzzy/nickname links (blank for a pure-exact cluster). |
| `Representative_Pair__c` | Long Text Area | The single strongest pair, side-by-side: `Name A <-> Name B: <signal> (first/last/combined scores)`. |
| `Match_Link_Reasons__c` | Long Text Area | One line per link explaining why each pair is connected, with scores. (Was `Edge_Reasons__c`.) |
| `Consolidated_Logic__c` | Long Text Area | Description of the consolidation logic. |

## File 6: `account_nickname_name_groups_sf_import.csv`

Single-signal grouping of nickname pairs — connected groups so Bob/Bobby/Robert at one
DOB+ZIP collapse from N pair-rows into one group row. Mirrors the fuzzy-group schema.

### Nickname Group Schema (selected fields)

| Field | Type Recommendation | Purpose |
|---|---|---|
| `Match_Type__c` | Picklist | Always `nickname_group` for this file. |
| `Nickname_Group_Key__c` | Long Text Area | Sorted Account IDs in the group. |
| `Group_Record_Count__c` | Number | Records in the group. |
| `Shared_Gender__c` / `Shared_Birthdate__c` / `Shared_Composite_Zip__c` | — | Shared rule fields. |
| `Names_In_Group__c` / `Clean_Names_In_Group__c` | Long Text Area | Semicolon-delimited names. |
| `Record_Ids__c` / `Member_Numbers__c` / `Merge_Ids__c` / `Foundation_Constituents__c` | Long Text Area | Semicolon-delimited member data. |
| `Best_Pair_Score__c` / `Lowest_Pair_Score__c` | Number | Score range across the nickname pairs. |
| `Nickname_Pair_Count_In_Group__c` | Number | Nickname pair links inside the group. |
| `Nickname_Pair_Summary__c` | Long Text Area | Summary of the pair links + scores. |
| `Nickname_Group_Logic__c` | Long Text Area | Description of how the group was built. |

## Important Import Notes

### Use `External_Id__c` for Upsert

`External_Id__c` should be marked as an External ID and Unique field in Salesforce if you want to upsert instead of insert.

The script builds it from:

```text
Run ID + Match Type + SHA1 hash of the unique row/group key
```

This keeps the value shorter and safer for Salesforce field length limits.

### Use Account Lookups Where Possible

For pair-level fuzzy output, these fields can be configured as Lookup(Account):

```text
Account_1__c
Account_2__c
```

If they are Lookup(Account) fields, Salesforce Data Loader can import the Salesforce Account IDs directly.

### Long Text Area Fields

Use Long Text Area fields for explanation and multi-ID fields, especially:

```text
Fuzzy_Match_Reason__c
Name_Difference_Reason__c
Rule_Match_Reason__c
Record_Ids__c
Member_Numbers__c
Fuzzy_Pair_Summary__c
Match_Link_Reasons__c
```

### Date/Time Fields

`Created_At_Utc__c`, `Run_Start_Time__c`, `Query_Start_Time__c`, `Query_End_Time__c`, `Fuzzy_Start_Time__c`, and `Fuzzy_End_Time__c` can be Date/Time fields.

`Created_At_Mtn__c` is best stored as Text because it includes the timezone abbreviation, such as `MST` or `MDT`.

## Field Ordering Convention

The final two columns in every output file are intentionally:

```text
Created_At_Mtn__c
Created_At_Utc__c
```

This makes timestamp auditing consistent across all outputs.
