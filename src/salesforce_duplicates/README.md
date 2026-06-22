# Salesforce Account Duplicate Detection

## Overview

This process connects to Salesforce from Node.js, pulls records from the `Account` object, and creates CSV files to help review potential duplicate member/person accounts.

The script is designed to mimic source-of-truth duplicate logic as closely as possible while working around Salesforce SOQL limitations.

The process creates three output files (the names below are simplified; the
actual files are written with a date/time stamp at the end, e.g.
`account_duplicates_sf_import_2026-06-04_14-30-05.csv`):

```text
account_duplicates_sf_import.csv
account_fuzzy_name_matches_sf_import.csv
account_fuzzy_name_groups_sf_import.csv
```

When `ENABLE_NICKNAME_MATCHING` is on (the default), the run also produces **three
additional files** — a third name-comparison dimension (nicknames, e.g. Bob/Robert,
Bill/William):

```text
account_nickname_name_matches_sf_import.csv     (c) single-signal nickname view (pairs)
account_nickname_name_groups_sf_import.csv      (c) nickname groups (clusters of those pairs)
account_consolidated_duplicates_sf_import.csv   (d) reconciled, authoritative view
```

The model is three single-signal review views (exact, fuzzy, nickname) plus one
reconciled cluster view that merges exact + fuzzy(90) + nickname. The three baseline
files above are left **byte-for-byte unchanged** (a regression-safe baseline); all
new behavior is additive and review-only (no Salesforce import). See
**`README_NICKNAME.md`** for the full design, the `nicknames-curated` package, and
how cross-list overlap is managed.

## Project Structure

```text
salesforce_duplicates/
  step_1_find_duplicates.js   orchestrator (exact + fuzzy pipeline + run summary)
  step_2_get_duplicate_report.js / step_2a_create_duplicate_message.js   server report + message
  report_service.js         server glue (slash-arg parsing + freshness/force logic; tested)
  config.js                 run-mode flag resolver, thresholds, output file + folder names
  menu.js                   interactive launcher (node menu.js)
  src/
    fmt.js                  duration + timestamp formatting (pure)
    log.js                  console logging + colors
    ids.js                  run id, hashing, external id (pure)
    normalize.js            field cleaning + key builders (pure)
    matcher.js              levenshtein, similarity, rule flags, reasons (pure)
    nicknames.js            symmetric nickname equivalence (Bob~Robert) via the
                            nicknames-curated package (pure-style; injectable namer)
    consolidate.js          additive: complete-pool exact+fuzzy+nickname edge gen,
                            nickname view (c) rows, and UnionFind cluster view (d)
    grouping.js             UnionFind + fuzzy group builder
    step_timer.js           per-step stopwatch: live [STEP] lines + end timeline
    exact.js                exact-duplicate detection (in-memory)
    exact_sql.js            SQL-based exact grouping (GROUP BY; byte-identical)
    fuzzy.js                fuzzy candidate filter + rule blocks + pairwise compare
    zip_trim.js             builds the reviewable raw -> trimmed composite-ZIP map
    sf_rows.js              maps result rows to the Salesforce import schema
    output_files.js         CSV write + output/archive rotation + meta files
    salesforce.js           jsforce connect + Account query (--test=REST/ordered,
                            --prod=Bulk API/unordered)
    sweep.js                criteria tuning engine (expand_grid/run_profile/diff; pure)
    sweep_duplicates.js     duplicate criteria tuning CLI (snapshot/run/detail/diff)
    database_snapshot.js    SQL backbone: stream records into usat_sales_db + read back
    database_results.js     run logbook + the 6 result tables (+ zip-trim/nickname-fire/
                            merge-id-review)
    excel_output.js         one .xlsx workbook, one tab per view, 7 tabs (exceljs)
    merge_id_review.js      merge ID review (QA): compares our flagged accounts to the
                            Salesforce merge IDs; buckets + duplicate-pair counts (pure
                            builders + a DB report path)
    verify_database_snapshot.js  manual DB-loader smoke test (load/show/drop)
  tests/                    node:test unit suites (normalize, matcher, grouping, ids,
                            sf_rows, exact, fuzzy, zip_trim, file output, step_2 report,
                            report_service, step_timer, nicknames, consolidate, sweep,
                            database_snapshot, database_results, excel_output, exact_sql,
                            sql_backbone_parity, merge_id_review, salesforce, config)
  README.md / README_SQL.md / README_TUNING.md / README_NICKNAME.md / README_MERGE.md
  README_MERGE_ID_REVIEW.md / CLAUDE.md / schema.md
```

`main()` in `step_1_find_duplicates.js` is now a thin orchestrator that calls
`detect_exact_duplicates` (exact.js) and `run_fuzzy_matching` (fuzzy.js).

See `CLAUDE.md` for a quick orientation map of the modules.

## Output Location and Archiving

Output is written to the cross-platform `/data` path resolved by
`utilities/determineOSPath.js` (not the code folder):

```text
usat_salesforce_duplicates/          most recent run's files
usat_salesforce_duplicates_archive/  previous run's files
```

On each run the tool clears the archive, moves the prior run's CSVs into it, then
writes the new timestamped files into `usat_salesforce_duplicates`.

## Output Files

### 1. `account_duplicates.csv`

This file contains exact duplicate groups.

Records are grouped together when all of the following fields match exactly:

```text
FirstName
LastName
Gender
Birthdate
Composite ZIP
```

One row in this file can represent multiple Salesforce Account records.

Example:

```text
John Smith | Male | 1980-01-01 | 80919 | duplicate_count = 3
```

That means three Account records share the exact same duplicate key.

### 2. `account_fuzzy_name_matches.csv`

This file contains pair-level fuzzy matches.

Each row compares two Salesforce Account records.

A pair is included when the records have:

```text
Similar first/last name
Same gender
Same birthdate
Same composite ZIP
Not already included in the exact duplicate file
Not exact same cleaned first and last name
```

This file is useful for understanding why two records were considered a fuzzy duplicate candidate.

### 3. `account_fuzzy_name_groups.csv`

This file groups connected fuzzy pairs together.

For example, if the pair file finds:

```text
Record A <-> Record B
Record B <-> Record C
```

The group file combines them into one group:

```text
Record A; Record B; Record C
```

This makes fuzzy output easier to review because it behaves more like the exact duplicate group file.

### 4. `account_nickname_name_matches_sf_import.csv` (nickname view)

Pair-level matches where the first names are **nickname-equivalent** (Bob ~ Robert,
Bill ~ William) via the `nicknames-curated` dataset, with the same strict gate as
fuzzy (same gender + birthdate + composite ZIP) and the last name still agreeing
(exact or fuzzy). Each row carries `Also_Clears_Fuzzy_Flag__c` (the pair would also
pass the spelling threshold) and `In_Exact_Group_Flag__c` (one record is also an
exact duplicate), so this single-signal lens is self-describing.

### 5. `account_nickname_name_groups_sf_import.csv` (nickname groups)

Connected groups of nickname pairs — if Bob, Bobby, and Robert share a DOB + ZIP,
their pair rows collapse into one group row (`Bob;Bobby;Robert`). The single-signal
companion to the nickname view (#4), mirroring the fuzzy pair → group pattern. Columns
match the fuzzy group file (`Nickname_Group_Key__c`, `Group_Record_Count__c`, etc.).

### 6. `account_consolidated_duplicates_sf_import.csv` (consolidated view)

The reconciled, authoritative file. It generates exact + fuzzy(90) + nickname edges
over the **complete** rule-eligible pool (exact records are *not* removed) and unions
them into one cluster per person. Each row is a cluster with `Confidence_Tier__c`
(exact > fuzzy > nickname), a one-glance `Match_Composition__c` label (e.g. `exact + nickname`),
provenance flags `Has_Exact/Fuzzy/Nickname_Flag__c`, per-signal `*_Link_Count__c`, a
`Representative_Pair__c` (strongest pair side-by-side with scores), and `Match_Link_Reasons__c`
(one line per connected pair, with scores). This is the file to review/act on; (a)/(b)/(c)
are the per-signal lenses behind it. (Column names use the same "group" vocabulary as the
other group files; a "link" = a matched pair inside the cluster.)

### Also written each run: an Excel workbook + database tables

Alongside the CSVs, every run writes **one Excel workbook** (`account_duplicates_all_views_<timestamp>.xlsx`)
with **one tab per view** (`exact`, `fuzzy_pair`, `fuzzy_group`, `nickname_pair`,
`nickname_group`, `consolidated`) — handy for a reviewer who'd rather open one file.
This is on by default (`ENABLE_EXCEL_OUTPUT` in `config.js`).

When the SQL backbone is on (the default — see below), the run also persists each of the
six views into its own **database table** in `usat_sales_db`
(`salesforce_duplicate_exact_group`, `_fuzzy_pair`, `_fuzzy_group`, `_nickname_pair`,
`_nickname_group`, `_consolidated_cluster`), refreshed each run, plus a row in the run
"logbook" (`salesforce_duplicate_detection_run`). See `README_SQL.md`.

## Salesforce Object Used

The script queries the Salesforce `Account` object.

This assumes the Salesforce org stores member/person records on `Account`, such as with Person Accounts.

## Salesforce Fields Used

The script currently queries these fields:

```sql
Id,
LastName,
FirstName,
cfg_Member_Number__pc,
cfg_Gender_Identity__pc,
usat_Salesforce_Merge_Id__pc,
PersonBirthdate,
BillingPostalCode,
PersonMailingPostalCode
```

If any of these fields do not exist, or if your Salesforce user does not have access to them, the query will fail — **except** `usat_Salesforce_Merge_Id__pc`, which is **optional**: the run DESCRIBEs Account and includes it only if the org has it, so an org without the field still runs (the merge columns just come out blank, and the field is picked up automatically once an admin adds it).

## SOQL Query

The script uses this Salesforce query:

```sql
SELECT Id,
    LastName,
    FirstName,
    cfg_Member_Number__pc,
    cfg_Gender_Identity__pc,
    usat_Salesforce_Merge_Id__pc,
    PersonBirthdate,
    BillingPostalCode,
    PersonMailingPostalCode
FROM Account
WHERE FirstName != null
AND LastName != null
-- ORDER BY LastName, FirstName, Id   (added only for the --test pull)
```

**`ORDER BY` is applied to the `--test` pull only.** The duplicate detection never
needs sorted input — exact matching uses a hash Map, fuzzy matching uses rule-block
buckets, and all three output files are sorted in code afterward. So:

- **`--test`** uses the **ordered** query (`ACCOUNT_SOQL_ORDERED`). With
  `MAX_FETCH = 5000`, the script pulls the first 5,000 records ordered by
  `LastName, FirstName, Id` — a stable, deterministic sample (not random), so repeat
  test runs see the same rows.
- **`--prod`** uses the **unordered** query (`ACCOUNT_SOQL_BASE`). On the full
  ~700k-record extract, forcing Salesforce to sort the entire result set before
  sending it is the slowest part of the fetch; dropping `ORDER BY` lets Salesforce
  stream records as it finds them. Output ordering is unaffected (sorted in code).

## Fetch Method (REST vs. Bulk API)

The download method depends on the run mode (see `src/salesforce.js`):

```text
--test (dev sandbox)  REST autoFetch, capped at MAX_FETCH (5,000). Fast for a
                      small pull; Bulk's job-startup overhead would be slower here.
--prod (full run)     Bulk API query (conn.bulk2.query). Pulls the whole result
                      set in a few large transfers instead of REST paging 2,000 at
                      a time (~350 round-trips for ~700k records) — much faster.
```

Both paths return the same shape to the rest of the pipeline, so nothing
downstream changes. Bulk jobs run asynchronously server-side, so the poll timeout
is set generously (20 min) to allow a large extract to finish.

**Bulk CSV header rows are dropped.** The Bulk API 2.0 returns CSV, and jsforce can
leak the CSV header row into the record stream as a fake record where every field
equals its own column name (`Id === 'Id'`, `LastName === 'LastName'`, …) — once per
result chunk on a large extract. `bulk_query` filters these out at the source
(`is_bulk_header_row`), so they never reach detection. (REST autoFetch does not have
this issue.) Without the filter, the identical header rows would otherwise form a
bogus "LastName/FirstName" exact-duplicate group in the output.

## Composite ZIP Logic

Salesforce has a formula field similar to:

```text
usat_Composite_zip__c
```

The logic appears to be:

```text
If BillingPostalCode is populated:
    use BillingPostalCode
else:
    use PersonMailingPostalCode
```

The chosen value is then **trimmed to its first five digits** (US ZIP
normalization), so a ZIP+4 like `80919-1234` and the plain `80919` are treated
as the same ZIP and no longer block an otherwise-matching duplicate. The trim is
deliberately conservative: it only fires when the value **begins with exactly
five digits** (optionally followed by a ZIP+4 suffix such as `-1234` or `1234`).
Anything that does not start with five digits — e.g. a Canadian postal code like
`K1A 0B1` or a UK postcode — is left untouched, so international codes are never
mangled or collapsed together.

The script recreates that logic in Node.js (`src/normalize.js`):

```js
// First 5 digits only when the value starts with 5 digits; else unchanged.
function trim_zip5(value) {
    const trimmed = (value || "").trim();
    const match = trimmed.match(/^(\d{5})/);
    return match ? match[1] : trimmed;
}

function composite_zip_raw(row) {
    const billing = (row.BillingPostalCode || "").trim();
    const mailing = (row.PersonMailingPostalCode || "").trim();
    return billing !== "" ? billing : mailing;
}

function composite_zip(row) {
    return trim_zip5(composite_zip_raw(row));
}
```

`composite_zip()` is the single place ZIP normalization happens; every consumer
(the exact key, the fuzzy rule-block key, the required-field check, the matcher
flags, and all output rows) goes through it, so the trim propagates everywhere.

This is done in Node.js because Salesforce formula fields may not be usable in
SOQL `GROUP BY` queries.

### Reviewing the ZIP trim

Because trimming loosens matching, each run writes a **reviewable raw → trimmed
mapping** so the normalization can be audited. It lists every distinct composite
ZIP that changed, what it became, and how many records had it:

```text
raw_composite_zip, trimmed_composite_zip, record_count
80919-1234,        80919,                 312
90210-0001,        90210,                 7
```

The file (`zip_trim_mapping.csv`) is written to the **meta folder**
(`usat_salesforce_duplicates_meta`) — a sibling of the output folder, so it is
never swept into the Slack file uploads — and is overwritten each run. The run
also prints a short summary to the console (records trimmed + the top mappings),
and the menu's **Open review folder** item (OUTPUT section) opens the meta folder
for inspection.

## Exact Duplicate Logic

The exact duplicate logic builds a key using:

```text
LastName
FirstName
Gender
Birthdate
Composite ZIP
```

In code:

```js
function makeExactDuplicateKey(row) {
    return [
        norm(row.LastName),
        norm(row.FirstName),
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}
```

If more than one Account record has the same key, the group is written to:

```text
account_duplicates.csv
```

Important columns in the exact duplicate output include:

```text
row_number
duplicate_logic
LastName
FirstName
cfg_Gender_Identity__pc
PersonBirthdate
CompositeZip
duplicate_count
record_ids
member_numbers
```

## Expressing the Exact Rule as a SOQL Query

The exact rule (and only the exact rule) can be expressed directly in SOQL using
`GROUP BY ... HAVING COUNT(Id) > 1`. The query below is tested and runs as-is — every
group it returns is a suspected exact duplicate set (same last name, first name,
gender, birthdate, and ZIP):

```sql
SELECT LastName,
    FirstName,
    cfg_Gender_Identity__pc,
    PersonBirthdate,
    BillingPostalCode,
    PersonMailingPostalCode,
    COUNT(Id) duplicate_count
FROM Account
WHERE FirstName != null AND LastName != null
GROUP BY
    LastName,
    FirstName,
    cfg_Gender_Identity__pc,
    PersonBirthdate,
    BillingPostalCode,
    PersonMailingPostalCode
HAVING COUNT(Id) > 1
ORDER BY LastName, FirstName DESC
LIMIT 2000
```

This is great for a quick in-platform list (the `LIMIT 2000` keeps it within SOQL
query limits). It is **not** a full match for the code, because SOQL has no string
functions and `GROUP BY` accepts only real fields, not expressions. So it:

1. **Does not trim the ZIP.** There is no `LEFT()` / `SUBSTRING()` in SOQL, so
   `80919` and `80919-1234` are treated as different ZIPs and won't group together.
2. **Groups billing and mailing separately.** Both ZIP fields are grouping keys, so
   two records match only when their billing ZIPs agree *and* their mailing ZIPs
   agree — unlike the code's single "use billing, else mailing" composite ZIP.
3. **Normalizes nothing.** It can't uppercase/trim names, so `" bob "` and `"Bob"`
   can land in different groups (case/whitespace sensitivity). It also returns
   counts, not the Account IDs in each set — you'd pull those with a follow-up query.

### Native workaround: a `Zip5__c` formula field

To also collapse ZIP+4 and use a single billing-else-mailing ZIP (closer to the
code), add a **formula field** on Account, e.g. `Zip5__c`:

```text
LEFT(BLANKVALUE(BillingPostalCode, PersonMailingPostalCode), 5)
```

Once the formula field exists you can group on it (formula fields *are* allowed in
`GROUP BY`, raw expressions are not):

```sql
SELECT LastName, FirstName, cfg_Gender_Identity__pc,
       PersonBirthdate, Zip5__c, COUNT(Id) dup_count
FROM Account
WHERE FirstName != null AND LastName != null
  AND cfg_Gender_Identity__pc != null
  AND PersonBirthdate != null
  AND Zip5__c != null
GROUP BY LastName, FirstName, cfg_Gender_Identity__pc,
         PersonBirthdate, Zip5__c
HAVING COUNT(Id) > 1
```

That is why the tool recreates the ZIP/name logic in Node instead of relying on SOQL
grouping: it already has the records in memory and can trim, fall back to mailing
ZIP, and normalize names in one pass without adding org metadata. The **fuzzy** and
**nickname** passes have no SOQL equivalent at all — they need per-pair Levenshtein
scoring and a nickname dictionary.

## Fuzzy Match Logic

The fuzzy match logic is intentionally strict.

It does not simply compare everyone with a similar name. It only compares records that already match on the strongest rule-based identity fields.

A fuzzy match must meet all of these conditions:

```text
1. The records are not already in the exact duplicate output.
2. Gender matches.
3. Birthdate matches.
4. Composite ZIP matches.
5. First/last name similarity score is greater than or equal to the fuzzy threshold.
6. Cleaned first and last names are not both exact matches.
```

The difference between exact and fuzzy is:

```text
Exact duplicate:
    Exact name + same gender + same birthdate + same composite ZIP

Fuzzy duplicate:
    Similar name + same gender + same birthdate + same composite ZIP
```

So the fuzzy file is intended to catch records like:

```text
Alfred Aguado vs Alfredo Aguado
Hunteer Abissi vs Hunter Abissi
Sam Adams vs Sam Adams V
Martin Aguilera vs Martín Aguilera
```

These records match on gender, birthdate, and ZIP, but the name has a typo, suffix, spelling difference, or character variation.

## Name Cleaning

Before comparing names, the script normalizes them.

The cleaning process:

```text
1. Trim spaces
2. Convert to uppercase
3. Remove non-alphanumeric characters
```

In code:

```js
function cleanName(value) {
    return norm(value)
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}
```

This helps compare names consistently.

Examples:

```text
Martin
MARTIN
Martin.
Martín
```

After cleaning, these become easier to compare.

## Fuzzy Scoring

The script uses a Levenshtein-distance similarity score.

Each fuzzy pair receives three scores:

```text
match_score_first_name
match_score_last_name
match_score_combined_name
```

The combined score is weighted:

```js
const combinedNameScore = Math.round(
    firstNameScore * 0.45 + lastNameScore * 0.55
);
```

This gives slightly more weight to last name than first name.

Current threshold:

```js
const FUZZY_THRESHOLD = 90;
```

That means a pair must have:

```text
combined name score >= 90
```

to be included in the fuzzy output.

A higher threshold means fewer, stricter matches.

A lower threshold means more, looser matches.

## Why Exact Duplicate Records Are Excluded From Fuzzy

After the exact duplicate groups are created, the script collects all record IDs already found in the exact duplicate file.

Those records are removed from fuzzy matching.

This prevents the same records from appearing in both:

```text
account_duplicates.csv
account_fuzzy_name_matches.csv
account_fuzzy_name_groups.csv
```

Example:

```text
Base records fetched: 5,000
Exact duplicate record IDs excluded: 138
Records after exact duplicate exclusion: 4,862
```

The fuzzy process starts from the remaining records.

## Required Fields for Fuzzy Matching

Fuzzy matching requires all three rule-based fields:

```text
Gender
Birthdate
Composite ZIP
```

Records missing any of these fields are excluded from fuzzy matching.

Example:

```text
Base records fetched: 5,000
Exact duplicate record IDs excluded: 138
Records after exact duplicate exclusion: 4,862
Records excluded missing gender/birthdate/ZIP: 618
Final fuzzy candidate records: 4,244
```

This means:

```text
5,000 base records
- 138 exact duplicate records
= 4,862 records available for fuzzy
- 618 records missing gender, birthdate, or ZIP
= 4,244 final fuzzy candidates
```

## Fuzzy Rule Blocks

The script does not compare every record to every other record.

Instead, it groups fuzzy candidates into rule blocks using:

```text
Gender + Birthdate + Composite ZIP
```

In code:

```js
function makeRuleKey(row) {
    return [
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}
```

Only records in the same rule block are compared.

Example rule block:

```text
MALE|1985-03-13|43613
```

This means only records with the same gender, birthdate, and composite ZIP are compared for fuzzy name similarity.

This keeps fuzzy matching aligned with the rule-based duplicate logic.

## Pair-Level Fuzzy Output

The pair-level fuzzy output file is:

```text
account_fuzzy_name_matches.csv
```

Each row represents one fuzzy pair.

Important columns include:

```text
row_number
fuzzy_match_reason
name_difference_reason
first_name_difference_reason
last_name_difference_reason
rule_match_reason
match_score_combined_name
match_score_first_name
match_score_last_name
same_gender_flag
same_birthdate_flag
same_composite_zip_flag
strict_rule_match_flag
record_id_1
record_id_2
full_name_1
full_name_2
clean_full_name_1
clean_full_name_2
gender_1
gender_2
birthdate_1
birthdate_2
composite_zip_1
composite_zip_2
```

The explanation fields help explain why the pair was found.

Example explanation:

```text
Fuzzy match because the combined name score 95 is >= threshold 90.
First names differ after cleaning: "ALFRED" vs "ALFREDO" with score 86.
Strict rule match: same gender "MALE", same birthdate "1970-01-01", and same composite ZIP "80919".
This pair was not included in the exact duplicate file because the cleaned first and/or last name was not an exact match.
```

## Group-Level Fuzzy Output

The group-level fuzzy output file is:

```text
account_fuzzy_name_groups.csv
```

This file combines connected fuzzy pairs into groups.

For example:

```text
Record A <-> Record B
Record B <-> Record C
```

becomes:

```text
Record A; Record B; Record C
```

Important columns include:

```text
row_number
group_record_count
shared_gender
shared_birthdate
shared_composite_zip
names_in_group
clean_names_in_group
record_ids
member_numbers
best_pair_score
lowest_pair_score
fuzzy_pair_count_in_group
fuzzy_pair_summary
fuzzy_group_logic
```

## Why Fuzzy Pairs Can Be Greater Than Records

Fuzzy pairs are comparisons, not records.

If one rule block has 5 records, the number of possible pairs is:

```text
5 * 4 / 2 = 10
```

Formula:

```js
n * (n - 1) / 2
```

So pair counts can be greater than record counts.

However, because this script blocks by:

```text
Gender + Birthdate + Composite ZIP
```

pair counts should usually stay manageable.

## Settings

All tunable constants live in `config.js`:

```js
const FUZZY_THRESHOLD = 90;
const PROGRESS_LOG_EVERY_RECORDS = 1000;
const PROGRESS_LOG_EVERY_PAIRS = 250000;
```

### Test vs. production mode (`MAX_FETCH`)

The run mode is chosen with a **cross-platform command-line flag** (it works the
same in PowerShell, cmd, and bash because it's a normal process argument — no
shell-specific environment-variable syntax). `config.js` resolves it and the
result is passed into `main(is_test)`:

```js
// config.js — --test => true, --prod/--production => false, default false (prod)
function resolve_is_test(argv = process.argv) {
    if (argv.includes("--test")) return true;
    if (argv.includes("--prod") || argv.includes("--production")) return false;
    return false;
}
```

`is_test` selects the Salesforce credentials (dev sandbox vs. production) and the
fetch limit (`MAX_FETCH` = 5,000 test / 1,000,000 prod; `--test --full` and
`--prod --partial` use their own caps in `config.js`). Set it per run:

```bash
node step_1_find_duplicates.js --test         # dev sandbox, 5,000 cap
node step_1_find_duplicates.js --test --full  # dev sandbox, ALL records (Bulk API)
node step_1_find_duplicates.js --prod --partial  # production, capped sample (try before full)
node step_1_find_duplicates.js --prod         # production, full fetch
```

### FUZZY_THRESHOLD

Controls how similar the names must be.

```text
Higher threshold = fewer, stricter fuzzy matches
Lower threshold = more, looser fuzzy matches
```

Recommended starting value:

```js
const FUZZY_THRESHOLD = 90;
```

## Environment Setup

Create or update the `.env` file used by the script.

The script currently loads:

```js
dotenv.config({ path: "../../.env" });
```

So the `.env` file must exist two folders above the script location.

Example `.env`:

```bash
SF_LOGIN_URL=https://test.salesforce.com
SF_USERNAME=your_sandbox_username
SF_PASSWORD=your_password
SF_SECURITY_TOKEN=your_security_token
```

For sandbox access, use:

```text
https://test.salesforce.com
```

For production access, use:

```text
https://login.salesforce.com
```

## Required Node Packages

Install dependencies:

```bash
npm install dotenv jsforce fast-csv nicknames-curated
```

(`nicknames-curated` powers the nickname view + consolidated output. If you disable
nickname matching in `config.js`, it is still required at load time.)

## Run the Script

From the script folder, either use the interactive menu (recommended):

```bash
node menu.js
```

The menu can run the tests, do a syntax check, run the finder in TEST or
PRODUCTION mode, and open the output/archive folders.

Or run the script directly:

```bash
node step_1_find_duplicates.js --test         # test (dev sandbox, 5,000 cap)
node step_1_find_duplicates.js --test --full  # dev sandbox, ALL records (Bulk API)
node step_1_find_duplicates.js --prod --partial  # production, capped sample (try before full)
node step_1_find_duplicates.js --prod         # production (full fetch)
node step_1_find_duplicates.js                # defaults to production
```

### SQL backbone (default ON; `--in-memory` to bypass)

By default (`ENABLE_SQL_BACKBONE = true` in `config.js`) the finder streams the fetched
records into the local `usat_sales_db` snapshot table and reads them back **in fetch
order** (via a `load_sequence` ordinal), then runs the same detection off the database —
so every run (menu items 7-10 included) loads MySQL. The output is byte-for-byte
identical to the in-memory path — `tests/sql_backbone_parity.test.js` proves the
order-sensitive exact output survives the round-trip. Pass `--in-memory` to force the
legacy in-memory path (no DB). This is the same table the tuning sweep uses, so one
backbone serves both. See `README_SQL.md`.

```bash
node step_1_find_duplicates.js --prod              # production, detection off the DB (default)
node step_1_find_duplicates.js --prod --in-memory  # force the legacy in-memory path
```

## Testing

The `src/` modules are pure and unit-tested with Node's built-in test runner.
Tests never log into Salesforce or touch the production output folders.

```bash
node --test tests/                 # run every suite
node --test tests/matcher.test.js  # run one suite
```

Or use menu item 1 (all tests) / 2 (file output tests).

## Duplicate Criteria Tuning (sweep)

A separate, review-only CLI (`sweep_duplicates.js`) answers "how many duplicates
would we get under different criteria?" It fetches the records **once** (a snapshot),
then replays the matching over a grid of criteria — fuzzy threshold, nickname on/off,
which of gender/birthdate/zip are required, ZIP trim, name weights — and prints the
counts side by side, broken out by exact / fuzzy / nickname / consolidated, with the
criteria and a per-stage funnel shown, plus a delta vs. the current logic (baseline).

```bash
node src/sweep_duplicates.js snapshot --test    # fetch once (or --prod / --full / --partial)
node src/sweep_duplicates.js run                 # replay config.js DEFAULT_SWEEP_GRID over the snapshot
node src/sweep_duplicates.js diff "baseline" "t88_nickON_z5_gbz"
```

From the menu, the **DUPLICATE TUNING** section (items 15–19) runs the snapshot, the
sweep, and opens the tuning folder. Production code is never touched — the matching
runs through the self-contained engine in `src/sweep.js`. Output goes to a
`usat_salesforce_duplicates_tuning` folder, a sibling of the output folder under the
same external `/data` root (so it stays out of the Slack uploads and archive
rotation). Full detail in **`README_TUNING.md`**.

## Slack Server

`server_salesforce_duplicates_8017.js` (at the repo root, alongside the other
`server_*.js`, port 8017) exposes the duplicate output over Slack slash commands.
It mirrors `server_slack_events.js` and reuses the shared Slack upload utilities.

Run it from the repo root (or menu item 24):

```bash
node server_salesforce_duplicates_8017.js
```

Endpoints (hit directly from the CLI, or wire to Slack slash commands):

```text
GET  /salesforce-duplicates-test          health check
POST /salesforce-duplicates-stats         posts the latest run's counts (+ total records scanned)
GET  /scheduled-salesforce-duplicates     cron: regenerate + post files to a channel
POST /salesforce-duplicates-reporting     /reporting: DM the CSV file(s) + stats
```

The returned stats include the **total records scanned** from the latest run (read
from a small per-run summary file the finder writes to a meta folder).

Slash arguments (passed in the command `text` as `key=value`):

```text
mode=latest|run                 latest (default) returns existing files; run regenerates
force=true                      with mode=run, bypass the freshness window (always regenerate)
file=all|exact|fuzzy_pair|fuzzy_group   which file(s) to return (default all)
```

`mode=run` (slash commands) regenerates against **production** — but only if the
most recent output file is older than `FRESH_OUTPUT_WINDOW_MINUTES` (config,
default 30). **Within that window `mode=run` returns the latest files instead** of
re-querying Salesforce (so rapid repeat calls don't hammer it). When that happens
the Slack reply says so and points you to the override.

To regenerate anyway, add **`force=true`**:

```text
/duplicates mode=run              -> regenerate only if older than 30 min, else latest
/duplicates mode=run force=true   -> always regenerate (ignores the window)
```

The `/scheduled` endpoint additionally accepts `?is_test=true|false` (and `?full=true`
for a FULL fetch / all records) (default
`false` = production), so you can drive a full server → Slack run against the dev
sandbox without touching production:

```text
GET /scheduled-salesforce-duplicates?is_test=true              # dev sandbox (capped)
GET /scheduled-salesforce-duplicates?is_test=true&full=true    # dev sandbox, ALL records
GET /scheduled-salesforce-duplicates?is_test=false             # production (default)
```

CLI examples:

```bash
curl http://localhost:8017/salesforce-duplicates-test
curl "http://localhost:8017/scheduled-salesforce-duplicates?is_test=true"   # sandbox regenerate + post
curl "http://localhost:8017/scheduled-salesforce-duplicates?is_test=false"  # production
curl -X POST http://localhost:8017/salesforce-duplicates-reporting -d "text=mode=latest file=exact"
curl -X POST http://localhost:8017/salesforce-duplicates-reporting -d "text=mode=run force=true"  # force a regenerate
```

## Console Logging

### Step timing (live + end-of-run timeline)

As each major step finishes, the script prints a live one-line marker so you can
watch progress and see exactly when each stage completes:

```text
[STEP] archive prior outputs           0.1s
[STEP] fetch from Salesforce           107.0s
[STEP] exact duplicates                3.2s
[STEP] fuzzy matching                  6.8s
[STEP] fuzzy groups                    0.4s
[STEP] nickname matching               7.1s
[STEP] nickname groups                 0.3s
[STEP] consolidation                   0.6s
```

(The last two lines appear only when `ENABLE_NICKNAME_MATCHING` is on.)

Just before the run summary, it prints a timeline sorted largest-first (with bars)
so the slow stage is obvious at a glance:

```text
──────────────────────────────────────────────────────
Run timing (largest first):
  fetch from Salesforce            107.00s  ████████████████████████████
  fuzzy matching                     6.80s  ██
  exact duplicates                   3.20s  █
  fuzzy groups                       0.40s
  ────────────────────────────── ────────
  TOTAL                            117.40s
──────────────────────────────────────────────────────
```

This mirrors the stage timer in `event_analysis/build_all.js`. Implemented in
`src/step_timer.js` (`create_step_timer`).

### Composite ZIP trim summary

Just before the run summary, the script prints how many composite ZIPs were
trimmed to five digits, plus the most common raw → trimmed mappings, and the
path to the full mapping file for review:

```text
Composite ZIP trim (first 5 digits)
-----------------------------------
Records with a composite ZIP: 4,901
Records trimmed to 5 digits: 312
Distinct raw -> trimmed mappings: 48
  80919-1234  ->  80919   (312 records)
  ...and 47 more (full list in the mapping file).
Full mapping for review written to: .../usat_salesforce_duplicates_meta/zip_trim_mapping.csv
```

### Run summary

The script also logs the full run summary, including:

```text
Script start time
Script end time
Script duration
Query start time
Query end time
Query duration
Salesforce total matching records
Records actually fetched
Composite ZIPs trimmed to 5 digits (+ distinct raw -> trimmed mappings)
Exact duplicate groups found
Exact duplicate record IDs excluded from fuzzy
Fuzzy candidate records
Fuzzy rule blocks
Fuzzy pairs compared
Fuzzy pair matches found
Fuzzy groups found
Output file names
```

Example summary:

```text
Summary
-------
Script start time: 2026-06-04 01:32:45.301 UTC
Script end time: 2026-06-04 01:32:49.282 UTC
Script duration: 3s
Query start time: 2026-06-04 01:32:45.839 UTC
Query end time: 2026-06-04 01:32:49.133 UTC
Query duration: 3s
Total records scanned: 5000
Salesforce total matching records: 695827
Hardcoded MAX_FETCH: 5000
Hardcoded FUZZY_THRESHOLD: 90
Composite ZIPs trimmed to 5 digits: 312 (48 distinct raw -> trimmed mappings)
Exact duplicate groups found: 47
Exact duplicate record IDs excluded from fuzzy files: 138
Fuzzy candidate records scanned after exact exclusion and required-rule filters: 4244
Fuzzy pairs compared: 40
Fuzzy pair matches found: 5
Fuzzy groups found: 5

Nickname + consolidated (additive views)
Nickname pair matches found: 9
  pairs matched nickname only: 7
  pairs matched both nickname + fuzzy: 2
  pairs matched fuzzy spelling only: 5
Nickname groups found: 6
Consolidated clusters found: 14
```

## Recommended Review Order

Review the files in this order:

```text
1. account_consolidated_duplicates_sf_import.csv   (the reconciled, authoritative view)
2. account_duplicates.csv
3. account_fuzzy_name_groups.csv
4. account_fuzzy_name_matches.csv
5. account_nickname_name_groups_sf_import.csv
6. account_nickname_name_matches_sf_import.csv
```

Start with the consolidated file (d) — it merges exact, fuzzy, and nickname into one
cluster per person, with `Confidence_Tier__c` and `Has_*_Flag__c` provenance. Use the
single-signal files (a/b/c) to explain or audit why a specific link exists.

## Common Questions

### Did the exact and fuzzy logic process the same base records?

Yes.

Both start from the same Salesforce fetch.

The exact logic processes all fetched records.

The fuzzy logic starts with those same records, then removes:

```text
1. Records already found in exact duplicate groups
2. Records missing gender, birthdate, or composite ZIP
```

### Why are there fewer fuzzy candidates than total records?

Because fuzzy only uses records that:

```text
1. Were not already caught as exact duplicates
2. Have gender
3. Have birthdate
4. Have composite ZIP
```

### Why do fuzzy matches look like they should have been rule-based matches?

They are rule-based matches on:

```text
Gender + Birthdate + Composite ZIP
```

But they are not exact duplicate matches because the name differs.

For example:

```text
Alfred Aguado
Alfredo Aguado
```

These share the rule fields but not the exact first name.

So they correctly belong in the fuzzy output.

### Does fuzzy return only the highest probability match?

No.

The pair file returns every qualifying fuzzy pair.

The group file then combines related pairs into connected groups.

### Why keep both pair and group fuzzy files?

The pair file explains the specific match.

The group file helps with cleanup and review because it combines related records.

## Production Notes

For a full run across 600K+ records:

```text
1. Increase MAX_FETCH.
2. Run during off-hours.
3. Make sure the machine has enough memory.
4. Consider writing large outputs to a timestamped output folder.
5. Consider moving the fetched Salesforce records into MySQL or BigQuery for repeat analysis.
```

Recommended full-run setting:

```js
const MAX_FETCH = 1000000;
```

## Known Limitations

### The `--test` sample is deterministic, not random

The `--test` pull applies `ORDER BY LastName, FirstName, Id`, so with:

```js
const MAX_FETCH = 5000;
```

it gets the first 5,000 records alphabetically by last name, first name, and ID —
the same rows on every test run. (The `--prod` pull is unordered for speed; on a full
run every record is fetched, so order doesn't matter.)

### Formula fields are handled in Node.js

The composite ZIP formula is recreated in Node.js because SOQL has no string
functions and `GROUP BY` accepts only real fields, not expressions like
`LEFT(BillingPostalCode, 5)`. The exact rule *can* be approximated natively if you
add a `Zip5__c` formula field and group on it — see **"Expressing the Exact Rule as
a SOQL Query"** above. The tool keeps the logic in Node so it can also fall back to
mailing ZIP and normalize names in the same pass, and so fuzzy/nickname (which have
no SOQL equivalent) run on the same normalized values.

### Fuzzy logic requires gender, birthdate, and ZIP

Records missing any of those fields are excluded from fuzzy matching.

### Fuzzy group logic is based on connected pairs

If A matches B and B matches C, all three are placed in the same group, even if A and C are not directly matched.

This is usually helpful, but reviewers should still inspect groups before taking action.

## Suggested Future Enhancements

Potential improvements:

```text
1. [done] Timestamped output files written to /data with archive rotation.
2. Add a raw Salesforce export CSV.
3. [partial] MAX_FETCH is now env-driven (SF_DUP_IS_TEST); FUZZY_THRESHOLD still in config.js.
4. Add separate rule-based-only output:
   same gender + birthdate + ZIP, regardless of name score.
5. [done] ZIP normalization: composite ZIP is trimmed to the first 5 digits
   (US-pattern only; non-US codes left intact), with a reviewable raw->trimmed
   mapping written to the meta folder.
6. [done] Nickname handling (Bill/William, Bob/Robert, Mike/Michael, etc.) via the
   `nicknames-curated` package, surfaced as a single-signal nickname view (c) plus a
   reconciled consolidated output (d) that unifies exact, fuzzy(90), and nickname
   matches into clusters. Baseline files unchanged. See `README_NICKNAME.md`.
7. Load results into MySQL for deeper review.
8. Add Salesforce update logic only after manual review.
```

## Safety Note

This script only reads Salesforce data and writes CSV files locally.

It does not update, merge, delete, or modify Salesforce records.
